use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke_signed, system_instruction, system_program};
use anchor_lang::Discriminator;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::events::{
    AuthorDisputeSlashingFinalized, AuthorDisputeVouchLinked, VoucherSlashed,
};
use crate::instructions::claim_voucher_revenue::accrue_author_rewards;
use crate::instructions::unlink_vouch_from_listing::accrue_position_rewards;
use crate::state::{
    AgentProfile, AuthorDispute, AuthorDisputeStatus, AuthorDisputeVouchLink,
    ListingSettlement, ListingVouchPosition, ListingVouchPositionStatus, ReputationConfig,
    SkillListing, Vouch, VouchStatus, AUTHOR_DISPUTE_VOUCH_LINK_SEED,
    MAX_DISPUTE_POSITIONS_PER_TX,
};

/// Remaining accounts per position, in order:
/// `[listing_vouch_position, vouch, vouch_vault, vouch_vault_authority, dispute_vouch_link]`
pub const ACCOUNTS_PER_SLASH_POSITION: usize = 5;

#[derive(Accounts)]
pub struct SlashDisputeVouches<'info> {
    #[account(
        mut,
        constraint = author_dispute.status == AuthorDisputeStatus::SlashingVouchers
            @ SlashError::DisputeNotSlashing,
        constraint = author_dispute.author == author_profile.authority
            @ SlashError::AuthorMismatch,
    )]
    pub author_dispute: Box<Account<'info, AuthorDispute>>,

    #[account(
        mut,
        seeds = [b"agent", author_profile.authority.as_ref()],
        bump = author_profile.bump,
    )]
    pub author_profile: Box<Account<'info, AgentProfile>>,

    #[account(
        mut,
        constraint = skill_listing.key() == author_dispute.skill_listing
            @ SlashError::SkillListingMismatch,
    )]
    pub skill_listing: Box<Account<'info, SkillListing>>,

    #[account(
        mut,
        constraint = listing_settlement.skill_listing == skill_listing.key()
            @ SlashError::SettlementMismatch,
        constraint = listing_settlement.locked_by_dispute == Some(author_dispute.key())
            @ SlashError::SettlementNotLockedByDispute,
    )]
    pub listing_settlement: Box<Account<'info, ListingSettlement>>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ReputationConfig>>,

    #[account(address = config.usdc_mint @ SlashError::InvalidUsdcMint)]
    pub usdc_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        address = listing_settlement.author_proceeds_vault
            @ SlashError::AuthorProceedsVaultMismatch,
        constraint = author_proceeds_vault.mint == config.usdc_mint
            @ SlashError::InvalidTokenMint,
    )]
    pub author_proceeds_vault: Box<Account<'info, TokenAccount>>,

    /// Permissionless: anyone may crank a recorded ruling. The cranker only
    /// pays rent for the dispute-vouch-link accounts.
    #[account(mut)]
    pub cranker: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, SlashDisputeVouches<'info>>,
) -> Result<()> {
    let remaining = ctx.remaining_accounts;
    require!(!remaining.is_empty(), SlashError::NoPositionsProvided);
    require!(
        remaining.len() % ACCOUNTS_PER_SLASH_POSITION == 0,
        SlashError::MalformedPositionAccounts
    );
    let position_count = remaining.len() / ACCOUNTS_PER_SLASH_POSITION;
    require!(
        position_count <= MAX_DISPUTE_POSITIONS_PER_TX,
        SlashError::TooManyPositionsPerPage
    );

    let clock = Clock::get()?;
    let dispute_key = ctx.accounts.author_dispute.key();
    let listing_key = ctx.accounts.skill_listing.key();
    let author_profile_key = ctx.accounts.author_profile.key();
    let slash_percentage = ctx.accounts.config.slash_percentage as u64;

    let mut page_slashed_usdc_micros: u64 = 0;
    let mut page_processed: u32 = 0;

    for group in remaining.chunks_exact(ACCOUNTS_PER_SLASH_POSITION) {
        let position_info = &group[0];
        let vouch_info = &group[1];
        let vouch_vault_info = &group[2];
        let vouch_vault_authority_info = &group[3];
        let link_info = &group[4];

        let mut position: Account<ListingVouchPosition> = Account::try_from(position_info)?;
        require!(
            position.skill_listing == listing_key,
            SlashError::PositionListingMismatch
        );
        require!(
            position.status == ListingVouchPositionStatus::Active,
            SlashError::PositionNotActive
        );
        require!(
            position.vouch == vouch_info.key(),
            SlashError::PositionVouchMismatch
        );

        let mut vouch: Account<Vouch> = Account::try_from(vouch_info)?;
        require!(
            vouch.vouchee == author_profile_key,
            SlashError::VouchAuthorMismatch
        );

        // The (dispute, vouch) link PDA is the double-slash guard: it can be
        // created exactly once, so a position cannot be settled twice.
        create_dispute_vouch_link(
            &ctx,
            link_info,
            &dispute_key,
            &vouch_info.key(),
            &position.key(),
            clock.unix_timestamp,
        )?;

        // Settle the position itself (mirrors unlink): preserve earned
        // listing rewards, then remove it from the listing aggregates.
        accrue_position_rewards(&ctx.accounts.skill_listing, &mut position)?;
        let position_stake = position.reward_stake_usdc_micros;
        position.reward_stake_usdc_micros = 0;
        position.status = ListingVouchPositionStatus::Slashed;
        position.updated_at = clock.unix_timestamp;

        let listing = &mut ctx.accounts.skill_listing;
        listing.active_reward_stake_usdc_micros = listing
            .active_reward_stake_usdc_micros
            .checked_sub(position_stake)
            .ok_or(SlashError::RewardStakeUnderflow)?;
        listing.active_reward_position_count = listing
            .active_reward_position_count
            .checked_sub(1)
            .ok_or(SlashError::RewardPositionCountUnderflow)?;

        let mut slash_usdc_micros: u64 = 0;
        let mut residual_stake_usdc_micros: u64 = vouch.stake_usdc_micros;
        if vouch.status == VouchStatus::Active {
            // Settle the author-wide reward index before mutating stake,
            // mirroring revoke_vouch. Earned pre-slash rewards stay claimable.
            accrue_author_rewards(&ctx.accounts.author_profile, &mut vouch)?;

            let pre_slash_stake = vouch.stake_usdc_micros;
            slash_usdc_micros = pre_slash_stake
                .saturating_mul(slash_percentage)
                .saturating_div(100);

            if slash_usdc_micros > 0 {
                require!(
                    vouch_vault_info.key() == vouch.vault,
                    SlashError::VouchVaultMismatch
                );
                let (expected_vault_authority, vault_authority_bump) =
                    Pubkey::find_program_address(
                        &[
                            b"vouch_vault_authority",
                            vouch.voucher.as_ref(),
                            vouch.vouchee.as_ref(),
                        ],
                        ctx.program_id,
                    );
                require!(
                    vouch_vault_authority_info.key() == expected_vault_authority,
                    SlashError::VouchVaultAuthorityMismatch
                );
                let signer_bump = [vault_authority_bump];
                let signer_seeds: &[&[u8]] = &[
                    b"vouch_vault_authority",
                    vouch.voucher.as_ref(),
                    vouch.vouchee.as_ref(),
                    &signer_bump,
                ];
                token::transfer_checked(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        TransferChecked {
                            from: vouch_vault_info.to_account_info(),
                            mint: ctx.accounts.usdc_mint.to_account_info(),
                            to: ctx.accounts.author_proceeds_vault.to_account_info(),
                            authority: vouch_vault_authority_info.to_account_info(),
                        },
                        &[signer_seeds],
                    ),
                    slash_usdc_micros,
                    ctx.accounts.usdc_mint.decimals,
                )?;
            }

            vouch.stake_usdc_micros = pre_slash_stake
                .checked_sub(slash_usdc_micros)
                .ok_or(SlashError::VouchStakeUnderflow)?;
            vouch.status = VouchStatus::Slashed;
            residual_stake_usdc_micros = vouch.stake_usdc_micros;

            // A Slashed vouch no longer counts toward backing at all: remove
            // the full pre-slash stake (and the vouch itself) from the
            // profile aggregates that drive reputation and reward indexing.
            let author_profile = &mut ctx.accounts.author_profile;
            author_profile.total_vouch_stake_usdc_micros = author_profile
                .total_vouch_stake_usdc_micros
                .checked_sub(pre_slash_stake)
                .ok_or(SlashError::VouchStakeUnderflow)?;
            author_profile.total_vouches_received =
                author_profile.total_vouches_received.saturating_sub(1);

            vouch.exit(ctx.program_id)?;
        }
        // else: stale position (vouch revoked before the dispute opened, or
        // slashed by a concurrent dispute on another listing) — skip-settle:
        // the link records it as processed, the position dies, no transfer.

        position.exit(ctx.program_id)?;

        page_slashed_usdc_micros = page_slashed_usdc_micros
            .checked_add(slash_usdc_micros)
            .ok_or(SlashError::SlashOverflow)?;
        page_processed += 1;

        emit!(VoucherSlashed {
            author_dispute: dispute_key,
            vouch: vouch_info.key(),
            voucher: vouch.voucher,
            vouchee: vouch.vouchee,
            listing_vouch_position: position_info.key(),
            slash_usdc_micros,
            residual_stake_usdc_micros,
            timestamp: clock.unix_timestamp,
        });
    }

    let author_dispute = &mut ctx.accounts.author_dispute;
    author_dispute.processed_vouch_count = author_dispute
        .processed_vouch_count
        .checked_add(page_processed)
        .ok_or(SlashError::ProcessedCountOverflow)?;
    require!(
        author_dispute.processed_vouch_count <= author_dispute.linked_vouch_count,
        SlashError::ProcessedCountOverflow
    );
    author_dispute.voucher_slashed_usdc_micros = author_dispute
        .voucher_slashed_usdc_micros
        .checked_add(page_slashed_usdc_micros)
        .ok_or(SlashError::SlashOverflow)?;

    let settlement = &mut ctx.accounts.listing_settlement;
    settlement.slashed_deposit_usdc_micros = settlement
        .slashed_deposit_usdc_micros
        .checked_add(page_slashed_usdc_micros)
        .ok_or(SlashError::SlashOverflow)?;
    settlement.updated_at = clock.unix_timestamp;

    if author_dispute.processed_vouch_count == author_dispute.linked_vouch_count {
        // Final page: the dispute is now fully settled. The settlement and
        // listing stay dispute-locked (matching the pre-existing Upheld
        // behavior); create_refund_pool clears both.
        author_dispute.status = AuthorDisputeStatus::Resolved;
        author_dispute.resolved_at = Some(clock.unix_timestamp);

        let author_profile = &mut ctx.accounts.author_profile;
        author_profile.open_author_disputes = author_profile
            .open_author_disputes
            .checked_sub(1)
            .ok_or(SlashError::OpenAuthorDisputeCountUnderflow)?;
        author_profile.reputation_score =
            author_profile.compute_reputation(&ctx.accounts.config);

        emit!(AuthorDisputeSlashingFinalized {
            author_dispute: dispute_key,
            author: author_dispute.author,
            processed_vouch_count: author_dispute.processed_vouch_count,
            voucher_slashed_usdc_micros: author_dispute.voucher_slashed_usdc_micros,
            timestamp: clock.unix_timestamp,
        });
    }

    Ok(())
}

/// Creates the `(dispute, vouch)` link PDA, paying rent from the cranker.
/// Fails if the account already exists — the double-slash guard. Handles
/// pre-funded addresses (lamport-griefing) via the allocate+assign path.
fn create_dispute_vouch_link<'info>(
    ctx: &Context<'_, '_, 'info, 'info, SlashDisputeVouches<'info>>,
    link_info: &AccountInfo<'info>,
    dispute_key: &Pubkey,
    vouch_key: &Pubkey,
    position_key: &Pubkey,
    now: i64,
) -> Result<()> {
    let (expected_link, link_bump) = Pubkey::find_program_address(
        &[
            AUTHOR_DISPUTE_VOUCH_LINK_SEED,
            dispute_key.as_ref(),
            vouch_key.as_ref(),
        ],
        ctx.program_id,
    );
    require!(
        link_info.key() == expected_link,
        SlashError::DisputeVouchLinkMismatch
    );
    require!(
        link_info.owner == &system_program::ID && link_info.data_is_empty(),
        SlashError::VouchAlreadySlashed
    );

    let rent = Rent::get()?;
    let required_lamports = rent.minimum_balance(AuthorDisputeVouchLink::LEN);
    let bump_seed = [link_bump];
    let link_seeds: &[&[u8]] = &[
        AUTHOR_DISPUTE_VOUCH_LINK_SEED,
        dispute_key.as_ref(),
        vouch_key.as_ref(),
        &bump_seed,
    ];

    if link_info.lamports() == 0 {
        invoke_signed(
            &system_instruction::create_account(
                &ctx.accounts.cranker.key(),
                &link_info.key(),
                required_lamports,
                AuthorDisputeVouchLink::LEN as u64,
                ctx.program_id,
            ),
            &[
                ctx.accounts.cranker.to_account_info(),
                link_info.clone(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[link_seeds],
        )?;
    } else {
        // The address was pre-funded (possibly to grief the crank):
        // top up, allocate, and assign instead of create_account.
        let top_up = required_lamports.saturating_sub(link_info.lamports());
        if top_up > 0 {
            invoke_signed(
                &system_instruction::transfer(
                    &ctx.accounts.cranker.key(),
                    &link_info.key(),
                    top_up,
                ),
                &[
                    ctx.accounts.cranker.to_account_info(),
                    link_info.clone(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                &[],
            )?;
        }
        invoke_signed(
            &system_instruction::allocate(
                &link_info.key(),
                AuthorDisputeVouchLink::LEN as u64,
            ),
            &[
                link_info.clone(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[link_seeds],
        )?;
        invoke_signed(
            &system_instruction::assign(&link_info.key(), ctx.program_id),
            &[
                link_info.clone(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[link_seeds],
        )?;
    }

    let link = AuthorDisputeVouchLink {
        author_dispute: *dispute_key,
        vouch: *vouch_key,
        listing_vouch_position: *position_key,
        settled: true,
        rent_payer: ctx.accounts.cranker.key(),
        added_at: now,
        bump: link_bump,
    };
    {
        let mut data = link_info.try_borrow_mut_data()?;
        data[0..8].copy_from_slice(AuthorDisputeVouchLink::DISCRIMINATOR);
        let mut writer: &mut [u8] = &mut data[8..];
        link.serialize(&mut writer)?;
    }

    emit!(AuthorDisputeVouchLinked {
        author_dispute: *dispute_key,
        vouch: *vouch_key,
        timestamp: now,
    });

    Ok(())
}

#[error_code]
pub enum SlashError {
    #[msg("Author dispute is not in the slashing phase")]
    DisputeNotSlashing,
    #[msg("Author profile does not match dispute")]
    AuthorMismatch,
    #[msg("Skill listing does not match dispute")]
    SkillListingMismatch,
    #[msg("Listing settlement does not match the disputed listing")]
    SettlementMismatch,
    #[msg("Listing settlement is not locked by this dispute")]
    SettlementNotLockedByDispute,
    #[msg("No positions provided to slash")]
    NoPositionsProvided,
    #[msg("Remaining accounts are not position groups of five")]
    MalformedPositionAccounts,
    #[msg("Too many positions in one page")]
    TooManyPositionsPerPage,
    #[msg("Position does not belong to the disputed listing")]
    PositionListingMismatch,
    #[msg("Position is not active")]
    PositionNotActive,
    #[msg("Position does not match the provided vouch")]
    PositionVouchMismatch,
    #[msg("Vouch does not back the disputed author")]
    VouchAuthorMismatch,
    #[msg("Vouch vault does not match vouch state")]
    VouchVaultMismatch,
    #[msg("Vouch vault authority does not match expected PDA")]
    VouchVaultAuthorityMismatch,
    #[msg("Dispute vouch link does not match expected PDA")]
    DisputeVouchLinkMismatch,
    #[msg("Vouch was already slashed for this dispute")]
    VouchAlreadySlashed,
    #[msg("Vouch stake underflowed")]
    VouchStakeUnderflow,
    #[msg("Reward stake underflowed")]
    RewardStakeUnderflow,
    #[msg("Reward position count underflowed")]
    RewardPositionCountUnderflow,
    #[msg("Slashed amount overflowed")]
    SlashOverflow,
    #[msg("Processed position count exceeded the linked count")]
    ProcessedCountOverflow,
    #[msg("Open author dispute count underflowed")]
    OpenAuthorDisputeCountUnderflow,
    #[msg("USDC mint does not match config")]
    InvalidUsdcMint,
    #[msg("Token account mint does not match config")]
    InvalidTokenMint,
    #[msg("Author proceeds vault does not match settlement state")]
    AuthorProceedsVaultMismatch,
}
