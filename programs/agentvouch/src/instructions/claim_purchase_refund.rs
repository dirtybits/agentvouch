use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::events::PurchaseRefundClaimed;
use crate::state::{Purchase, RefundClaim, RefundPool, ReputationConfig};

#[derive(Accounts)]
pub struct ClaimPurchaseRefund<'info> {
    #[account(
        mut,
        constraint = refund_pool.listing_settlement == purchase.listing_settlement @ ClaimRefundError::PurchaseNotInRefundCohort,
        constraint = refund_pool.skill_listing == purchase.skill_listing @ ClaimRefundError::PurchaseNotInRefundCohort,
        constraint = refund_pool.revision == purchase.listing_revision @ ClaimRefundError::PurchaseNotInRefundCohort,
    )]
    pub refund_pool: Box<Account<'info, RefundPool>>,

    #[account(
        seeds = [
            b"purchase",
            buyer.key().as_ref(),
            purchase.skill_listing.as_ref(),
            &purchase.listing_revision.to_le_bytes()
        ],
        bump = purchase.bump,
        constraint = purchase.buyer == buyer.key() @ ClaimRefundError::BuyerMismatch,
    )]
    pub purchase: Box<Account<'info, Purchase>>,

    #[account(
        init,
        payer = buyer,
        space = RefundClaim::LEN,
        seeds = [b"refund_claim", refund_pool.key().as_ref(), purchase.key().as_ref()],
        bump
    )]
    pub refund_claim: Box<Account<'info, RefundClaim>>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ReputationConfig>>,

    #[account(address = config.usdc_mint @ ClaimRefundError::InvalidUsdcMint)]
    pub usdc_mint: Box<Account<'info, Mint>>,

    /// CHECK: PDA authority for the refund vault.
    #[account(seeds = [b"refund_vault_authority", refund_pool.key().as_ref()], bump)]
    pub refund_vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        address = refund_pool.refund_vault @ ClaimRefundError::RefundVaultMismatch,
        constraint = refund_vault.mint == config.usdc_mint @ ClaimRefundError::InvalidTokenMint,
        constraint = refund_vault.owner == refund_vault_authority.key() @ ClaimRefundError::InvalidTokenOwner,
    )]
    pub refund_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = buyer_usdc_account.mint == config.usdc_mint @ ClaimRefundError::InvalidTokenMint,
        constraint = buyer_usdc_account.owner == buyer.key() @ ClaimRefundError::InvalidTokenOwner,
    )]
    pub buyer_usdc_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ClaimPurchaseRefund>) -> Result<()> {
    let clock = Clock::get()?;
    if let Some(deadline) = ctx.accounts.refund_pool.claim_deadline {
        require!(
            clock.unix_timestamp <= deadline,
            ClaimRefundError::ClaimWindowExpired
        );
    }

    let claim_amount = ctx
        .accounts
        .purchase
        .price_paid_usdc_micros
        .min(ctx.accounts.refund_pool.max_refund_per_purchase_usdc_micros)
        .min(ctx.accounts.refund_pool.remaining_pool_usdc_micros);
    require!(claim_amount > 0, ClaimRefundError::RefundPoolEmpty);

    let refund_pool_key = ctx.accounts.refund_pool.key();
    let signer_bump = [ctx.bumps.refund_vault_authority];
    let signer_seeds: &[&[u8]] = &[
        b"refund_vault_authority",
        refund_pool_key.as_ref(),
        &signer_bump,
    ];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.refund_vault.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.buyer_usdc_account.to_account_info(),
                authority: ctx.accounts.refund_vault_authority.to_account_info(),
            },
            &[signer_seeds],
        ),
        claim_amount,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let refund_pool = &mut ctx.accounts.refund_pool;
    refund_pool.remaining_pool_usdc_micros = refund_pool
        .remaining_pool_usdc_micros
        .checked_sub(claim_amount)
        .ok_or(ClaimRefundError::RefundPoolEmpty)?;
    refund_pool.claimed_usdc_micros = refund_pool
        .claimed_usdc_micros
        .checked_add(claim_amount)
        .ok_or(ClaimRefundError::ClaimOverflow)?;

    let refund_claim = &mut ctx.accounts.refund_claim;
    refund_claim.refund_pool = refund_pool_key;
    refund_claim.purchase = ctx.accounts.purchase.key();
    refund_claim.buyer = ctx.accounts.buyer.key();
    refund_claim.amount_usdc_micros = claim_amount;
    refund_claim.claimed_at = clock.unix_timestamp;
    refund_claim.bump = ctx.bumps.refund_claim;

    emit!(PurchaseRefundClaimed {
        refund_pool: refund_pool_key,
        refund_claim: refund_claim.key(),
        purchase: ctx.accounts.purchase.key(),
        buyer: ctx.accounts.buyer.key(),
        amount_usdc_micros: claim_amount,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

#[error_code]
pub enum ClaimRefundError {
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("Purchase is not part of this refund cohort")]
    PurchaseNotInRefundCohort,
    #[msg("Purchase buyer does not match signer")]
    BuyerMismatch,
    #[msg("Refund claim window has expired")]
    ClaimWindowExpired,
    #[msg("Refund pool is empty")]
    RefundPoolEmpty,
    #[msg("Refund claim accounting overflowed")]
    ClaimOverflow,
    #[msg("USDC mint does not match config")]
    InvalidUsdcMint,
    #[msg("Refund vault does not match refund pool")]
    RefundVaultMismatch,
    #[msg("Token account mint does not match config")]
    InvalidTokenMint,
    #[msg("Token account owner is invalid")]
    InvalidTokenOwner,
}
