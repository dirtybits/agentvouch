use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::events::AuthorDisputeResolved as AuthorDisputeResolvedEvent;
use crate::state::{
    AgentProfile, AuthorBond, AuthorDispute, AuthorDisputeLiabilityScope, AuthorDisputeRuling,
    AuthorDisputeStatus, ListingSettlement, ReputationConfig, SkillListing, AUTHOR_BOND_SEED,
};

#[derive(Accounts)]
#[instruction(dispute_id: u64)]
pub struct ResolveAuthorDispute<'info> {
    #[account(mut)]
    pub author_dispute: Box<Account<'info, AuthorDispute>>,

    #[account(mut)]
    pub author_profile: Box<Account<'info, AgentProfile>>,

    #[account(
        mut,
        constraint = skill_listing.key() == author_dispute.skill_listing @ ErrorCode::SkillListingMismatch,
    )]
    pub skill_listing: Box<Account<'info, SkillListing>>,

    #[account()]
    pub config: Box<Account<'info, ReputationConfig>>,

    pub authority: Signer<'info>,

    #[account()]
    pub usdc_mint: Box<Account<'info, Mint>>,

    /// CHECK: PDA authority for the dispute bond vault.
    #[account()]
    pub dispute_bond_vault_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub dispute_bond_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub protocol_treasury_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub listing_settlement: Option<Box<Account<'info, ListingSettlement>>>,

    /// CHECK: PDA authority for the author bond vault.
    #[account()]
    pub author_bond_vault_authority: UncheckedAccount<'info>,

    /// CHECK: This account is validated against the stored challenger pubkey in the handler.
    pub challenger: AccountInfo<'info>,

    #[account(mut)]
    pub challenger_usdc_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, ResolveAuthorDispute<'info>>,
    dispute_id: u64,
    ruling: AuthorDisputeRuling,
) -> Result<()> {
    let clock = Clock::get()?;
    require!(
        ctx.accounts.author_dispute.status == AuthorDisputeStatus::Open,
        ErrorCode::AuthorDisputeNotOpen
    );
    require_keys_eq!(
        ctx.accounts.author_dispute.author,
        ctx.accounts.author_profile.authority,
        ErrorCode::AuthorMismatch
    );
    let (expected_config, _) = Pubkey::find_program_address(&[b"config"], ctx.program_id);
    require_keys_eq!(
        ctx.accounts.config.key(),
        expected_config,
        ErrorCode::ConfigMismatch
    );
    require_keys_eq!(
        ctx.accounts.config.config_authority,
        ctx.accounts.authority.key(),
        ErrorCode::UnauthorizedResolver
    );
    require_keys_eq!(
        ctx.accounts.usdc_mint.key(),
        ctx.accounts.config.usdc_mint,
        ErrorCode::InvalidUsdcMint
    );
    let dispute_id_bytes = dispute_id.to_le_bytes();
    let (expected_author_dispute, _) = Pubkey::find_program_address(
        &[
            b"author_dispute",
            ctx.accounts.author_profile.authority.as_ref(),
            &dispute_id_bytes,
        ],
        ctx.program_id,
    );
    require_keys_eq!(
        ctx.accounts.author_dispute.key(),
        expected_author_dispute,
        ErrorCode::AuthorDisputeMismatch
    );
    let (expected_dispute_bond_vault_authority, dispute_bond_vault_authority_bump) =
        Pubkey::find_program_address(
            &[
                b"dispute_bond_vault_authority",
                ctx.accounts.author_profile.authority.as_ref(),
                &dispute_id_bytes,
            ],
            ctx.program_id,
        );
    require_keys_eq!(
        ctx.accounts.dispute_bond_vault_authority.key(),
        expected_dispute_bond_vault_authority,
        ErrorCode::DisputeBondVaultMismatch
    );
    let (expected_author_bond_vault_authority, _) = Pubkey::find_program_address(
        &[
            b"author_bond_vault_authority",
            ctx.accounts.author_profile.authority.as_ref(),
        ],
        ctx.program_id,
    );
    require_keys_eq!(
        ctx.accounts.author_bond_vault_authority.key(),
        expected_author_bond_vault_authority,
        ErrorCode::AuthorBondVaultMismatch
    );
    require_keys_eq!(
        ctx.accounts.dispute_bond_vault.key(),
        ctx.accounts.author_dispute.dispute_bond_vault,
        ErrorCode::DisputeBondVaultMismatch
    );
    require_keys_eq!(
        ctx.accounts.dispute_bond_vault.mint,
        ctx.accounts.config.usdc_mint,
        ErrorCode::InvalidTokenMint
    );
    require_keys_eq!(
        ctx.accounts.dispute_bond_vault.owner,
        ctx.accounts.dispute_bond_vault_authority.key(),
        ErrorCode::InvalidTokenOwner
    );
    require_keys_eq!(
        ctx.accounts.protocol_treasury_vault.key(),
        ctx.accounts.config.protocol_treasury_vault,
        ErrorCode::TreasuryVaultMismatch
    );
    require_keys_eq!(
        ctx.accounts.protocol_treasury_vault.mint,
        ctx.accounts.config.usdc_mint,
        ErrorCode::InvalidTokenMint
    );
    require_keys_eq!(
        ctx.accounts.challenger.key(),
        ctx.accounts.author_dispute.challenger,
        ErrorCode::ChallengerMismatch
    );
    require_keys_eq!(
        ctx.accounts.challenger_usdc_account.mint,
        ctx.accounts.config.usdc_mint,
        ErrorCode::InvalidTokenMint
    );
    require_keys_eq!(
        ctx.accounts.challenger_usdc_account.owner,
        ctx.accounts.challenger.key(),
        ErrorCode::InvalidTokenOwner
    );
    let bond_amount_usdc_micros = ctx.accounts.author_dispute.bond_amount_usdc_micros;
    let author_bond_slashed_usdc_micros = match ruling {
        AuthorDisputeRuling::Upheld => slash_author_bond_if_present(&ctx)?,
        AuthorDisputeRuling::Dismissed => 0,
    };

    let author_key = ctx.accounts.author_profile.authority;
    let signer_bump = [dispute_bond_vault_authority_bump];
    let signer_seeds: &[&[u8]] = &[
        b"dispute_bond_vault_authority",
        author_key.as_ref(),
        &dispute_id_bytes,
        &signer_bump,
    ];

    let bond_destination = match ruling {
        AuthorDisputeRuling::Upheld => ctx.accounts.challenger_usdc_account.to_account_info(),
        AuthorDisputeRuling::Dismissed => ctx.accounts.protocol_treasury_vault.to_account_info(),
    };
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.dispute_bond_vault.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: bond_destination,
                authority: ctx.accounts.dispute_bond_vault_authority.to_account_info(),
            },
            &[signer_seeds],
        ),
        bond_amount_usdc_micros,
        ctx.accounts.usdc_mint.decimals,
    )?;

    // Upheld paid disputes with linked vouch positions park in
    // SlashingVouchers: the ruling is recorded and the bond is slashed now,
    // but the dispute stays open (open_author_disputes, settlement + listing
    // locks) until `slash_dispute_vouches` processes the final page.
    let linked_vouch_count = if ruling == AuthorDisputeRuling::Upheld
        && ctx.accounts.author_dispute.liability_scope
            == AuthorDisputeLiabilityScope::AuthorBondThenVouchers
    {
        ctx.accounts.skill_listing.active_reward_position_count
    } else {
        0
    };
    let parked_for_slashing = linked_vouch_count > 0;

    if !parked_for_slashing {
        ctx.accounts.author_profile.open_author_disputes = ctx
            .accounts
            .author_profile
            .open_author_disputes
            .checked_sub(1)
            .ok_or(ErrorCode::OpenAuthorDisputeCountUnderflow)?;
    }
    match ruling {
        AuthorDisputeRuling::Upheld => {
            ctx.accounts.author_profile.author_bond_usdc_micros = ctx
                .accounts
                .author_profile
                .author_bond_usdc_micros
                .checked_sub(author_bond_slashed_usdc_micros)
                .ok_or(ErrorCode::AuthorBondUnderflow)?;
            ctx.accounts.author_profile.upheld_author_disputes = ctx
                .accounts
                .author_profile
                .upheld_author_disputes
                .checked_add(1)
                .ok_or(ErrorCode::DisputeCountOverflow)?;
        }
        AuthorDisputeRuling::Dismissed => {
            ctx.accounts.author_profile.dismissed_author_disputes = ctx
                .accounts
                .author_profile
                .dismissed_author_disputes
                .checked_add(1)
                .ok_or(ErrorCode::DisputeCountOverflow)?;
        }
    }
    ctx.accounts.author_profile.reputation_score = ctx
        .accounts
        .author_profile
        .compute_reputation(&ctx.accounts.config);

    let author_dispute = &mut ctx.accounts.author_dispute;
    author_dispute.ruling = Some(ruling);
    author_dispute.author_bond_slashed_usdc_micros = author_bond_slashed_usdc_micros;
    author_dispute.linked_vouch_count = linked_vouch_count;
    if parked_for_slashing {
        author_dispute.status = AuthorDisputeStatus::SlashingVouchers;
    } else {
        author_dispute.status = AuthorDisputeStatus::Resolved;
        author_dispute.resolved_at = Some(clock.unix_timestamp);
    }

    if let Some(settlement) = ctx.accounts.listing_settlement.as_deref_mut() {
        require!(
            settlement.skill_listing == author_dispute.skill_listing,
            ErrorCode::ListingSettlementMismatch
        );
        require!(
            settlement.locked_by_dispute == Some(author_dispute.key()),
            ErrorCode::ListingSettlementMismatch
        );
        if ruling == AuthorDisputeRuling::Dismissed {
            settlement.locked_by_dispute = None;
            settlement.updated_at = clock.unix_timestamp;
        }
    }
    if ruling == AuthorDisputeRuling::Dismissed
        && ctx.accounts.skill_listing.locked_by_dispute == Some(author_dispute.key())
    {
        ctx.accounts.skill_listing.locked_by_dispute = None;
        ctx.accounts.skill_listing.updated_at = clock.unix_timestamp;
    }

    emit!(AuthorDisputeResolvedEvent {
        author_dispute: author_dispute.key(),
        author: author_dispute.author,
        ruling: ruling_label(ruling).to_string(),
        liability_scope: liability_scope_label(author_dispute.liability_scope).to_string(),
        linked_vouch_count: author_dispute.linked_vouch_count,
        author_bond_slashed_usdc_micros: author_dispute.author_bond_slashed_usdc_micros,
        voucher_slashed_usdc_micros: author_dispute.voucher_slashed_usdc_micros,
        slashed_usdc_micros: author_dispute
            .author_bond_slashed_usdc_micros
            .saturating_add(author_dispute.voucher_slashed_usdc_micros),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

fn slash_author_bond_if_present<'info>(
    ctx: &Context<'_, '_, 'info, 'info, ResolveAuthorDispute<'info>>,
) -> Result<u64> {
    let profile_bond = ctx.accounts.author_profile.author_bond_usdc_micros;
    if profile_bond == 0 {
        return Ok(0);
    }
    require!(
        ctx.remaining_accounts.len() >= 2,
        ErrorCode::MissingAuthorBondSettlementAccounts
    );
    let author_bond_account = &ctx.remaining_accounts[0];
    let author_bond_vault_account = &ctx.remaining_accounts[1];
    let author_key = ctx.accounts.author_profile.authority;
    let (expected_author_bond, _) =
        Pubkey::find_program_address(&[AUTHOR_BOND_SEED, author_key.as_ref()], ctx.program_id);
    require_keys_eq!(
        author_bond_account.key(),
        expected_author_bond,
        ErrorCode::AuthorBondAccountMismatch
    );

    require!(
        author_bond_account.owner == ctx.program_id,
        ErrorCode::AuthorBondAccountMismatch
    );
    let mut author_bond = {
        let author_bond_data = author_bond_account.try_borrow_data()?;
        let mut author_bond_data_reader: &[u8] = &author_bond_data;
        AuthorBond::try_deserialize(&mut author_bond_data_reader)?
    };
    require_keys_eq!(
        author_bond.author,
        author_key,
        ErrorCode::AuthorBondAccountMismatch
    );
    require!(
        author_bond.amount_usdc_micros == profile_bond,
        ErrorCode::AuthorBondProfileMismatch
    );

    require!(
        author_bond_vault_account.owner == &ctx.accounts.token_program.key(),
        ErrorCode::AuthorBondVaultMismatch
    );
    let author_bond_vault = {
        let author_bond_vault_data = author_bond_vault_account.try_borrow_data()?;
        let mut author_bond_vault_data_reader: &[u8] = &author_bond_vault_data;
        TokenAccount::try_deserialize_unchecked(&mut author_bond_vault_data_reader)?
    };
    require_keys_eq!(
        author_bond_vault_account.key(),
        author_bond.vault,
        ErrorCode::AuthorBondVaultMismatch
    );
    require_keys_eq!(
        author_bond_vault.mint,
        ctx.accounts.config.usdc_mint,
        ErrorCode::InvalidTokenMint
    );
    require_keys_eq!(
        author_bond_vault.owner,
        ctx.accounts.author_bond_vault_authority.key(),
        ErrorCode::InvalidTokenOwner
    );

    let slash_amount = profile_bond
        .saturating_mul(ctx.accounts.config.slash_percentage as u64)
        .saturating_div(100);
    if slash_amount == 0 {
        return Ok(0);
    }

    let (_, author_bond_vault_authority_bump) = Pubkey::find_program_address(
        &[b"author_bond_vault_authority", author_key.as_ref()],
        ctx.program_id,
    );
    let signer_bump = [author_bond_vault_authority_bump];
    let signer_seeds: &[&[u8]] = &[
        b"author_bond_vault_authority",
        author_key.as_ref(),
        &signer_bump,
    ];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: author_bond_vault_account.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.challenger_usdc_account.to_account_info(),
                authority: ctx.accounts.author_bond_vault_authority.to_account_info(),
            },
            &[signer_seeds],
        ),
        slash_amount,
        ctx.accounts.usdc_mint.decimals,
    )?;

    author_bond.amount_usdc_micros = author_bond
        .amount_usdc_micros
        .checked_sub(slash_amount)
        .ok_or(ErrorCode::AuthorBondUnderflow)?;
    author_bond.updated_at = Clock::get()?.unix_timestamp;
    let mut author_bond_data = author_bond_account.try_borrow_mut_data()?;
    let mut author_bond_data_writer: &mut [u8] = &mut author_bond_data;
    author_bond.try_serialize(&mut author_bond_data_writer)?;

    Ok(slash_amount)
}

fn ruling_label(ruling: AuthorDisputeRuling) -> &'static str {
    match ruling {
        AuthorDisputeRuling::Upheld => "Upheld",
        AuthorDisputeRuling::Dismissed => "Dismissed",
    }
}

fn liability_scope_label(liability_scope: AuthorDisputeLiabilityScope) -> &'static str {
    match liability_scope {
        AuthorDisputeLiabilityScope::AuthorBondOnly => "AuthorBondOnly",
        AuthorDisputeLiabilityScope::AuthorBondThenVouchers => "AuthorBondThenVouchers",
    }
}

#[error_code]
pub enum ErrorCode {
    #[msg("Author dispute is not open")]
    AuthorDisputeNotOpen,
    #[msg("Author profile does not match dispute")]
    AuthorMismatch,
    #[msg("Config PDA does not match expected address")]
    ConfigMismatch,
    #[msg("Author dispute PDA does not match expected address")]
    AuthorDisputeMismatch,
    #[msg("Only config authority can resolve disputes")]
    UnauthorizedResolver,
    #[msg("Stored challenger does not match provided challenger account")]
    ChallengerMismatch,
    #[msg("Open author dispute count underflowed")]
    OpenAuthorDisputeCountUnderflow,
    #[msg("Author bond account does not match expected PDA")]
    AuthorBondAccountMismatch,
    #[msg("Author bond account does not match profile")]
    AuthorBondProfileMismatch,
    #[msg("Author bond vault does not match account state")]
    AuthorBondVaultMismatch,
    #[msg("Author bond amount underflowed")]
    AuthorBondUnderflow,
    #[msg("Author bond settlement accounts are missing")]
    MissingAuthorBondSettlementAccounts,
    #[msg("Dispute count overflowed")]
    DisputeCountOverflow,
    #[msg("USDC mint does not match config")]
    InvalidUsdcMint,
    #[msg("Dispute bond vault does not match dispute state")]
    DisputeBondVaultMismatch,
    #[msg("Treasury vault does not match config")]
    TreasuryVaultMismatch,
    #[msg("Token account mint does not match config")]
    InvalidTokenMint,
    #[msg("Token account owner is invalid")]
    InvalidTokenOwner,
    #[msg("Listing settlement does not match dispute lock")]
    ListingSettlementMismatch,
    #[msg("Skill listing does not match dispute")]
    SkillListingMismatch,
}
