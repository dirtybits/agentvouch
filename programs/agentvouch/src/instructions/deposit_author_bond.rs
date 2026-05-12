use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::events::AuthorBondDeposited;
use crate::state::{AgentProfile, AuthorBond, ReputationConfig, AUTHOR_BOND_SEED};

#[derive(Accounts)]
pub struct DepositAuthorBond<'info> {
    #[account(
        init_if_needed,
        payer = author,
        space = AuthorBond::LEN,
        seeds = [AUTHOR_BOND_SEED, author.key().as_ref()],
        bump
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

    #[account(
        mut,
        constraint = author_usdc_account.mint == config.usdc_mint @ ErrorCode::InvalidTokenMint,
        constraint = author_usdc_account.owner == author.key() @ ErrorCode::InvalidTokenOwner
    )]
    pub author_usdc_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: PDA authority for the author bond vault.
    #[account(seeds = [b"author_bond_vault_authority", author.key().as_ref()], bump)]
    pub author_bond_vault_authority: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = author,
        token::mint = usdc_mint,
        token::authority = author_bond_vault_authority,
        token::token_program = token_program,
        seeds = [b"author_bond_vault", author.key().as_ref()],
        bump
    )]
    pub author_bond_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub author: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<DepositAuthorBond>, amount_usdc_micros: u64) -> Result<()> {
    require!(amount_usdc_micros > 0, ErrorCode::AmountMustBePositive);
    require!(!ctx.accounts.config.paused, ErrorCode::ProtocolPaused);

    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.author_usdc_account.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.author_bond_vault.to_account_info(),
                authority: ctx.accounts.author.to_account_info(),
            },
        ),
        amount_usdc_micros,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let clock = Clock::get()?;
    let author_bond = &mut ctx.accounts.author_bond;
    let is_new = author_bond.is_uninitialized();

    if is_new {
        author_bond.author = ctx.accounts.author.key();
        author_bond.vault = ctx.accounts.author_bond_vault.key();
        author_bond.rent_payer = ctx.accounts.author.key();
        author_bond.amount_usdc_micros = 0;
        author_bond.created_at = clock.unix_timestamp;
        author_bond.bump = ctx.bumps.author_bond;
        author_bond.vault_bump = ctx.bumps.author_bond_vault;
    }

    author_bond.amount_usdc_micros = author_bond
        .amount_usdc_micros
        .checked_add(amount_usdc_micros)
        .ok_or(ErrorCode::BondAmountOverflow)?;
    author_bond.updated_at = clock.unix_timestamp;

    let author_profile = &mut ctx.accounts.author_profile;
    author_profile.author_bond_usdc_micros = author_profile
        .author_bond_usdc_micros
        .checked_add(amount_usdc_micros)
        .ok_or(ErrorCode::BondAmountOverflow)?;
    author_profile.reputation_score = author_profile.compute_reputation(&ctx.accounts.config);

    emit!(AuthorBondDeposited {
        author_bond: author_bond.key(),
        author: ctx.accounts.author.key(),
        amount_usdc_micros,
        total_bond_usdc_micros: author_bond.amount_usdc_micros,
        vault: ctx.accounts.author_bond_vault.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

#[error_code]
pub enum ErrorCode {
    #[msg("Amount must be greater than zero")]
    AmountMustBePositive,
    #[msg("Author bond amount overflowed")]
    BondAmountOverflow,
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("USDC mint does not match config")]
    InvalidUsdcMint,
    #[msg("Token account mint does not match config")]
    InvalidTokenMint,
    #[msg("Token account owner is invalid")]
    InvalidTokenOwner,
}
