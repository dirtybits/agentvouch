use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::events::RefundPoolCreated;
use crate::state::{
    AuthorDispute, AuthorDisputeLiabilityScope, AuthorDisputeRuling, AuthorDisputeStatus,
    ListingSettlement, RefundPool, ReputationConfig, SkillListing,
};

#[derive(Accounts)]
pub struct CreateRefundPool<'info> {
    #[account()]
    pub author_dispute: Box<Account<'info, AuthorDispute>>,

    #[account(
        mut,
        constraint = skill_listing.key() == author_dispute.skill_listing @ CreateRefundPoolError::SkillListingMismatch,
    )]
    pub skill_listing: Box<Account<'info, SkillListing>>,

    #[account(
        mut,
        seeds = [
            b"listing_settlement",
            skill_listing.key().as_ref(),
            &listing_settlement.revision.to_le_bytes()
        ],
        bump = listing_settlement.bump,
        constraint = listing_settlement.skill_listing == skill_listing.key() @ CreateRefundPoolError::SettlementMismatch,
        constraint = listing_settlement.author == author_dispute.author @ CreateRefundPoolError::SettlementMismatch,
        constraint = listing_settlement.locked_by_dispute == Some(author_dispute.key()) @ CreateRefundPoolError::SettlementNotLockedByDispute,
    )]
    pub listing_settlement: Box<Account<'info, ListingSettlement>>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ReputationConfig>>,

    pub authority: Signer<'info>,

    #[account(address = config.usdc_mint @ CreateRefundPoolError::InvalidUsdcMint)]
    pub usdc_mint: Box<Account<'info, Mint>>,

    /// CHECK: PDA authority for the author proceeds vault.
    #[account(
        seeds = [
            b"author_proceeds_vault_authority",
            listing_settlement.key().as_ref()
        ],
        bump
    )]
    pub author_proceeds_vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        address = listing_settlement.author_proceeds_vault @ CreateRefundPoolError::AuthorProceedsVaultMismatch,
        constraint = author_proceeds_vault.mint == config.usdc_mint @ CreateRefundPoolError::InvalidTokenMint,
        constraint = author_proceeds_vault.owner == author_proceeds_vault_authority.key() @ CreateRefundPoolError::InvalidTokenOwner,
    )]
    pub author_proceeds_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = payer,
        space = RefundPool::LEN,
        seeds = [b"refund_pool", author_dispute.key().as_ref()],
        bump
    )]
    pub refund_pool: Box<Account<'info, RefundPool>>,

    /// CHECK: PDA authority for the refund vault.
    #[account(seeds = [b"refund_vault_authority", refund_pool.key().as_ref()], bump)]
    pub refund_vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        token::mint = usdc_mint,
        token::authority = refund_vault_authority,
        token::token_program = token_program,
        seeds = [b"refund_vault", refund_pool.key().as_ref()],
        bump
    )]
    pub refund_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = challenger_usdc_account.mint == config.usdc_mint @ CreateRefundPoolError::InvalidTokenMint,
        constraint = challenger_usdc_account.owner == author_dispute.challenger @ CreateRefundPoolError::InvalidTokenOwner,
    )]
    pub challenger_usdc_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateRefundPool>,
    requested_refund_pool_usdc_micros: u64,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.config.config_authority,
        ctx.accounts.authority.key(),
        CreateRefundPoolError::Unauthorized
    );
    require!(
        ctx.accounts.author_dispute.status == AuthorDisputeStatus::Resolved,
        CreateRefundPoolError::DisputeNotResolved
    );
    require!(
        ctx.accounts.author_dispute.ruling == Some(AuthorDisputeRuling::Upheld),
        CreateRefundPoolError::DisputeNotUpheld
    );
    require!(
        ctx.accounts.author_dispute.liability_scope
            == AuthorDisputeLiabilityScope::AuthorBondThenVouchers,
        CreateRefundPoolError::NotPaidDispute
    );
    require!(
        requested_refund_pool_usdc_micros > 0,
        CreateRefundPoolError::InvalidRefundPoolAmount
    );

    // Two buckets fund the pool: withdrawable author proceeds and the
    // ring-fenced slashed voucher deposits. The challenger reward is computed
    // on proceeds only — slashed stake never inflates the challenger prize.
    let available_proceeds = ctx
        .accounts
        .listing_settlement
        .withdrawable_author_proceeds_usdc_micros;
    let slashed_deposit = ctx
        .accounts
        .listing_settlement
        .slashed_deposit_usdc_micros;
    require!(
        available_proceeds
            .checked_add(slashed_deposit)
            .ok_or(CreateRefundPoolError::RewardOverflow)?
            > 0,
        CreateRefundPoolError::NoRefundableProceeds
    );

    let max_challenger_reward = available_proceeds
        .checked_mul(ctx.accounts.config.challenger_reward_bps as u64)
        .ok_or(CreateRefundPoolError::RewardOverflow)?
        .checked_div(10_000)
        .ok_or(CreateRefundPoolError::RewardOverflow)?
        .min(ctx.accounts.config.challenger_reward_cap_usdc_micros);
    let pool_capacity = available_proceeds
        .checked_sub(max_challenger_reward)
        .ok_or(CreateRefundPoolError::RewardOverflow)?
        .checked_add(slashed_deposit)
        .ok_or(CreateRefundPoolError::RewardOverflow)?;
    let refund_pool_amount = requested_refund_pool_usdc_micros.min(pool_capacity);
    require!(
        refund_pool_amount > 0,
        CreateRefundPoolError::InvalidRefundPoolAmount
    );
    // Ring-fenced money is the first money out of the vault.
    let slashed_used = slashed_deposit.min(refund_pool_amount);
    let proceeds_used = refund_pool_amount
        .checked_sub(slashed_used)
        .ok_or(CreateRefundPoolError::RewardOverflow)?;

    let settlement_key = ctx.accounts.listing_settlement.key();
    let signer_bump = [ctx.bumps.author_proceeds_vault_authority];
    let signer_seeds: &[&[u8]] = &[
        b"author_proceeds_vault_authority",
        settlement_key.as_ref(),
        &signer_bump,
    ];

    if max_challenger_reward > 0 {
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.author_proceeds_vault.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.challenger_usdc_account.to_account_info(),
                    authority: ctx
                        .accounts
                        .author_proceeds_vault_authority
                        .to_account_info(),
                },
                &[signer_seeds],
            ),
            max_challenger_reward,
            ctx.accounts.usdc_mint.decimals,
        )?;
    }

    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.author_proceeds_vault.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.refund_vault.to_account_info(),
                authority: ctx
                    .accounts
                    .author_proceeds_vault_authority
                    .to_account_info(),
            },
            &[signer_seeds],
        ),
        refund_pool_amount,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let clock = Clock::get()?;
    let claim_deadline = if ctx.accounts.config.refund_claim_window_seconds > 0 {
        Some(
            clock
                .unix_timestamp
                .checked_add(ctx.accounts.config.refund_claim_window_seconds)
                .ok_or(CreateRefundPoolError::ClaimDeadlineOverflow)?,
        )
    } else {
        None
    };

    let settlement = &mut ctx.accounts.listing_settlement;
    let proceeds_debit = proceeds_used
        .checked_add(max_challenger_reward)
        .ok_or(CreateRefundPoolError::RewardOverflow)?;
    settlement.withdrawable_author_proceeds_usdc_micros = settlement
        .withdrawable_author_proceeds_usdc_micros
        .checked_sub(proceeds_debit)
        .ok_or(CreateRefundPoolError::NoRefundableProceeds)?;
    settlement.slashed_deposit_usdc_micros = settlement
        .slashed_deposit_usdc_micros
        .checked_sub(slashed_used)
        .ok_or(CreateRefundPoolError::NoRefundableProceeds)?;
    settlement.refunded_author_proceeds_usdc_micros = settlement
        .refunded_author_proceeds_usdc_micros
        .checked_add(proceeds_used)
        .ok_or(CreateRefundPoolError::RewardOverflow)?;
    settlement.locked_by_dispute = None;
    settlement.updated_at = clock.unix_timestamp;

    if ctx.accounts.skill_listing.locked_by_dispute == Some(ctx.accounts.author_dispute.key()) {
        ctx.accounts.skill_listing.locked_by_dispute = None;
        ctx.accounts.skill_listing.updated_at = clock.unix_timestamp;
    }

    let refund_pool = &mut ctx.accounts.refund_pool;
    refund_pool.author_dispute = ctx.accounts.author_dispute.key();
    refund_pool.skill_listing = ctx.accounts.skill_listing.key();
    refund_pool.listing_settlement = settlement_key;
    refund_pool.revision = settlement.revision;
    refund_pool.refund_vault = ctx.accounts.refund_vault.key();
    refund_pool.total_pool_usdc_micros = refund_pool_amount;
    refund_pool.remaining_pool_usdc_micros = refund_pool_amount;
    refund_pool.claimed_usdc_micros = 0;
    refund_pool.max_refund_per_purchase_usdc_micros =
        ctx.accounts.author_dispute.skill_price_usdc_micros_snapshot;
    refund_pool.challenger_reward_usdc_micros = max_challenger_reward;
    refund_pool.claim_deadline = claim_deadline;
    refund_pool.created_at = clock.unix_timestamp;
    refund_pool.bump = ctx.bumps.refund_pool;
    refund_pool.refund_vault_bump = ctx.bumps.refund_vault;

    emit!(RefundPoolCreated {
        refund_pool: refund_pool.key(),
        author_dispute: ctx.accounts.author_dispute.key(),
        skill_listing: ctx.accounts.skill_listing.key(),
        listing_settlement: settlement_key,
        revision: refund_pool.revision,
        total_pool_usdc_micros: refund_pool_amount,
        challenger_reward_usdc_micros: max_challenger_reward,
        claim_deadline,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

#[error_code]
pub enum CreateRefundPoolError {
    #[msg("Only the config authority can create refund pools")]
    Unauthorized,
    #[msg("Author dispute is not resolved")]
    DisputeNotResolved,
    #[msg("Author dispute was not upheld")]
    DisputeNotUpheld,
    #[msg("Refund pools only apply to paid disputes")]
    NotPaidDispute,
    #[msg("Skill listing does not match dispute")]
    SkillListingMismatch,
    #[msg("Listing settlement does not match dispute")]
    SettlementMismatch,
    #[msg("Listing settlement is not locked by this dispute")]
    SettlementNotLockedByDispute,
    #[msg("Refund pool amount must be positive")]
    InvalidRefundPoolAmount,
    #[msg("No refundable proceeds are available")]
    NoRefundableProceeds,
    #[msg("Reward calculation overflowed")]
    RewardOverflow,
    #[msg("Claim deadline overflowed")]
    ClaimDeadlineOverflow,
    #[msg("USDC mint does not match config")]
    InvalidUsdcMint,
    #[msg("Author proceeds vault does not match settlement state")]
    AuthorProceedsVaultMismatch,
    #[msg("Token account mint does not match config")]
    InvalidTokenMint,
    #[msg("Token account owner is invalid")]
    InvalidTokenOwner,
}
