use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::events::AuthorProceedsWithdrawn;
use crate::state::{ListingSettlement, ReputationConfig, SkillListing};

#[derive(Accounts)]
pub struct WithdrawAuthorProceeds<'info> {
    #[account(
        constraint = skill_listing.author == author.key() @ WithdrawProceedsError::NotAuthor,
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
        constraint = listing_settlement.skill_listing == skill_listing.key() @ WithdrawProceedsError::SettlementMismatch,
        constraint = listing_settlement.author == author.key() @ WithdrawProceedsError::SettlementMismatch,
    )]
    pub listing_settlement: Box<Account<'info, ListingSettlement>>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ReputationConfig>>,

    #[account(address = config.usdc_mint @ WithdrawProceedsError::InvalidUsdcMint)]
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
        address = listing_settlement.author_proceeds_vault @ WithdrawProceedsError::AuthorProceedsVaultMismatch,
        constraint = author_proceeds_vault.mint == config.usdc_mint @ WithdrawProceedsError::InvalidTokenMint,
        constraint = author_proceeds_vault.owner == author_proceeds_vault_authority.key() @ WithdrawProceedsError::InvalidTokenOwner,
    )]
    pub author_proceeds_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = author_usdc_account.mint == config.usdc_mint @ WithdrawProceedsError::InvalidTokenMint,
        constraint = author_usdc_account.owner == author.key() @ WithdrawProceedsError::InvalidTokenOwner,
    )]
    pub author_usdc_account: Box<Account<'info, TokenAccount>>,

    pub author: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<WithdrawAuthorProceeds>, amount_usdc_micros: u64) -> Result<()> {
    require!(
        !ctx.accounts.config.paused,
        WithdrawProceedsError::ProtocolPaused
    );
    require!(amount_usdc_micros > 0, WithdrawProceedsError::InvalidAmount);
    require!(
        !ctx.accounts.listing_settlement.is_locked(),
        WithdrawProceedsError::SettlementLocked
    );
    let clock = Clock::get()?;
    let unlocked_at = ctx
        .accounts
        .listing_settlement
        .updated_at
        .checked_add(ctx.accounts.config.author_proceeds_lock_seconds)
        .ok_or(WithdrawProceedsError::LockOverflow)?;
    require!(
        clock.unix_timestamp >= unlocked_at,
        WithdrawProceedsError::ProceedsLocked
    );
    require!(
        amount_usdc_micros
            <= ctx
                .accounts
                .listing_settlement
                .withdrawable_author_proceeds_usdc_micros,
        WithdrawProceedsError::InsufficientWithdrawableProceeds
    );

    let settlement_key = ctx.accounts.listing_settlement.key();
    let signer_bump = [ctx.bumps.author_proceeds_vault_authority];
    let signer_seeds: &[&[u8]] = &[
        b"author_proceeds_vault_authority",
        settlement_key.as_ref(),
        &signer_bump,
    ];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.author_proceeds_vault.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.author_usdc_account.to_account_info(),
                authority: ctx
                    .accounts
                    .author_proceeds_vault_authority
                    .to_account_info(),
            },
            &[signer_seeds],
        ),
        amount_usdc_micros,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let settlement = &mut ctx.accounts.listing_settlement;
    settlement.withdrawable_author_proceeds_usdc_micros = settlement
        .withdrawable_author_proceeds_usdc_micros
        .checked_sub(amount_usdc_micros)
        .ok_or(WithdrawProceedsError::InsufficientWithdrawableProceeds)?;
    settlement.withdrawn_author_proceeds_usdc_micros = settlement
        .withdrawn_author_proceeds_usdc_micros
        .checked_add(amount_usdc_micros)
        .ok_or(WithdrawProceedsError::WithdrawalOverflow)?;
    settlement.updated_at = clock.unix_timestamp;

    emit!(AuthorProceedsWithdrawn {
        skill_listing: ctx.accounts.skill_listing.key(),
        listing_settlement: settlement_key,
        author: ctx.accounts.author.key(),
        amount_usdc_micros,
        remaining_withdrawable_usdc_micros: settlement.withdrawable_author_proceeds_usdc_micros,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

#[error_code]
pub enum WithdrawProceedsError {
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("Only the listing author can withdraw proceeds")]
    NotAuthor,
    #[msg("Withdrawal amount must be positive")]
    InvalidAmount,
    #[msg("Listing settlement account does not match the listing")]
    SettlementMismatch,
    #[msg("Author proceeds vault does not match settlement state")]
    AuthorProceedsVaultMismatch,
    #[msg("Author proceeds are still locked")]
    ProceedsLocked,
    #[msg("Author proceeds are locked by an open dispute")]
    SettlementLocked,
    #[msg("Insufficient withdrawable author proceeds")]
    InsufficientWithdrawableProceeds,
    #[msg("Author proceeds lock calculation overflowed")]
    LockOverflow,
    #[msg("Withdrawal accounting overflowed")]
    WithdrawalOverflow,
    #[msg("USDC mint does not match config")]
    InvalidUsdcMint,
    #[msg("Token account mint does not match config")]
    InvalidTokenMint,
    #[msg("Token account owner is invalid")]
    InvalidTokenOwner,
}
