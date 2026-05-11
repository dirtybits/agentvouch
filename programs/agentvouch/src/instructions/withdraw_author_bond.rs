use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::events::AuthorBondWithdrawn;
use crate::state::{AgentProfile, AuthorBond, ReputationConfig, AUTHOR_BOND_SEED};

#[derive(Accounts)]
pub struct WithdrawAuthorBond<'info> {
    #[account(
        mut,
        seeds = [AUTHOR_BOND_SEED, author.key().as_ref()],
        bump = author_bond.bump,
        constraint = author_bond.author == author.key() @ ErrorCode::AuthorBondAuthorityMismatch
    )]
    pub author_bond: Box<Account<'info, AuthorBond>>,

    #[account(
        mut,
        seeds = [b"agent", author.key().as_ref()],
        bump = author_profile.bump,
    )]
    pub author_profile: Box<Account<'info, AgentProfile>>,

    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Box<Account<'info, ReputationConfig>>,

    #[account(address = config.usdc_mint @ ErrorCode::InvalidUsdcMint)]
    pub usdc_mint: Box<Account<'info, Mint>>,

    /// CHECK: PDA authority for the author bond vault.
    #[account(seeds = [b"author_bond_vault_authority", author.key().as_ref()], bump)]
    pub author_bond_vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        address = author_bond.vault @ ErrorCode::AuthorBondVaultMismatch,
        constraint = author_bond_vault.mint == config.usdc_mint @ ErrorCode::InvalidTokenMint,
        constraint = author_bond_vault.owner == author_bond_vault_authority.key() @ ErrorCode::InvalidTokenOwner
    )]
    pub author_bond_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = author_usdc_account.mint == config.usdc_mint @ ErrorCode::InvalidTokenMint,
        constraint = author_usdc_account.owner == author.key() @ ErrorCode::InvalidTokenOwner
    )]
    pub author_usdc_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub author: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<WithdrawAuthorBond>, amount_usdc_micros: u64) -> Result<()> {
    require!(amount_usdc_micros > 0, ErrorCode::AmountMustBePositive);

    let clock = Clock::get()?;
    let author_bond = &mut ctx.accounts.author_bond;
    let remaining_bond = author_bond
        .amount_usdc_micros
        .checked_sub(amount_usdc_micros)
        .ok_or(ErrorCode::InsufficientBondAmount)?;

    if ctx.accounts.author_profile.active_free_skill_listings > 0 {
        require!(
            remaining_bond
                >= ctx
                    .accounts
                    .config
                    .min_author_bond_for_free_listing_usdc_micros,
            ErrorCode::FreeListingsRequireBondFloor
        );
    }
    require!(
        ctx.accounts.author_profile.open_author_disputes == 0,
        ErrorCode::AuthorBondLockedWhileDisputesOpen
    );

    let author_key = ctx.accounts.author.key();
    let signer_bump = [ctx.bumps.author_bond_vault_authority];
    let signer_seeds: &[&[u8]] = &[
        b"author_bond_vault_authority",
        author_key.as_ref(),
        &signer_bump,
    ];

    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.author_bond_vault.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.author_usdc_account.to_account_info(),
                authority: ctx.accounts.author_bond_vault_authority.to_account_info(),
            },
            &[signer_seeds],
        ),
        amount_usdc_micros,
        ctx.accounts.usdc_mint.decimals,
    )?;

    author_bond.amount_usdc_micros = remaining_bond;
    author_bond.updated_at = clock.unix_timestamp;

    let author_profile = &mut ctx.accounts.author_profile;
    author_profile.author_bond_usdc_micros = author_profile
        .author_bond_usdc_micros
        .checked_sub(amount_usdc_micros)
        .ok_or(ErrorCode::InsufficientBondAmount)?;
    author_profile.reputation_score = author_profile.compute_reputation(&ctx.accounts.config);

    emit!(AuthorBondWithdrawn {
        author_bond: author_bond.key(),
        author: ctx.accounts.author.key(),
        amount_usdc_micros,
        total_bond_usdc_micros: author_bond.amount_usdc_micros,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

#[error_code]
pub enum ErrorCode {
    #[msg("Amount must be greater than zero")]
    AmountMustBePositive,
    #[msg("Author bond authority mismatch")]
    AuthorBondAuthorityMismatch,
    #[msg("Author bond amount is insufficient for this withdrawal")]
    InsufficientBondAmount,
    #[msg("Active free listings require the configured minimum author bond")]
    FreeListingsRequireBondFloor,
    #[msg("Author bond cannot be withdrawn while author disputes are open")]
    AuthorBondLockedWhileDisputesOpen,
    #[msg("USDC mint does not match config")]
    InvalidUsdcMint,
    #[msg("Author bond vault does not match account state")]
    AuthorBondVaultMismatch,
    #[msg("Token account mint does not match config")]
    InvalidTokenMint,
    #[msg("Token account owner is invalid")]
    InvalidTokenOwner,
}
