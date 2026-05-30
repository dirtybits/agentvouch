use crate::events::VouchRevoked;
use crate::instructions::claim_voucher_revenue::accrue_author_rewards;
use crate::state::{AgentProfile, ReputationConfig, Vouch, VouchStatus};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

#[derive(Accounts)]
pub struct RevokeVouch<'info> {
    #[account(
        mut,
        seeds = [b"vouch", voucher_profile.key().as_ref(), vouchee_profile.key().as_ref()],
        bump = vouch.bump,
        constraint = vouch.voucher == voucher_profile.key() @ ErrorCode::UnauthorizedVouchRevocation,
        constraint = vouch.status.is_live() @ ErrorCode::VouchNotRevocable
    )]
    pub vouch: Box<Account<'info, Vouch>>,

    #[account(
        mut,
        seeds = [b"agent", voucher.key().as_ref()],
        bump = voucher_profile.bump
    )]
    pub voucher_profile: Box<Account<'info, AgentProfile>>,

    #[account(
        mut,
        seeds = [b"agent", vouchee_profile.authority.as_ref()],
        bump = vouchee_profile.bump
    )]
    pub vouchee_profile: Box<Account<'info, AgentProfile>>,

    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Box<Account<'info, ReputationConfig>>,

    #[account(address = config.usdc_mint @ ErrorCode::InvalidUsdcMint)]
    pub usdc_mint: Box<Account<'info, Mint>>,

    /// CHECK: PDA authority for the vouch stake vault.
    #[account(
        seeds = [
            b"vouch_vault_authority",
            voucher_profile.key().as_ref(),
            vouchee_profile.key().as_ref()
        ],
        bump
    )]
    pub vouch_vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        address = vouch.vault @ ErrorCode::VouchVaultMismatch,
        constraint = vouch_vault.mint == config.usdc_mint @ ErrorCode::InvalidTokenMint,
        constraint = vouch_vault.owner == vouch_vault_authority.key() @ ErrorCode::InvalidTokenOwner
    )]
    pub vouch_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = voucher_usdc_account.mint == config.usdc_mint @ ErrorCode::InvalidTokenMint,
        constraint = voucher_usdc_account.owner == voucher.key() @ ErrorCode::InvalidTokenOwner
    )]
    pub voucher_usdc_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub voucher: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<RevokeVouch>) -> Result<()> {
    // Escape-hatch lock: a voucher cannot pull stake while the author they back has
    // an open dispute, otherwise they could dodge slashing. Mirrors the same guard
    // on withdraw_author_bond. The dispute resolves atomically (slash happens in
    // resolve), so there is no window between resolution and slashing.
    require!(
        ctx.accounts.vouchee_profile.open_author_disputes == 0,
        ErrorCode::VoucheeHasOpenDispute
    );

    let vouch = &mut ctx.accounts.vouch;
    accrue_author_rewards(&ctx.accounts.vouchee_profile, vouch)?;
    let stake_usdc_micros = vouch.stake_usdc_micros;

    // Mark as revoked
    vouch.status = VouchStatus::Revoked;
    vouch.stake_usdc_micros = 0;

    let voucher_profile_key = ctx.accounts.voucher_profile.key();
    let vouchee_profile_key = ctx.accounts.vouchee_profile.key();
    let signer_bump = [ctx.bumps.vouch_vault_authority];
    let signer_seeds: &[&[u8]] = &[
        b"vouch_vault_authority",
        voucher_profile_key.as_ref(),
        vouchee_profile_key.as_ref(),
        &signer_bump,
    ];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.vouch_vault.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.voucher_usdc_account.to_account_info(),
                authority: ctx.accounts.vouch_vault_authority.to_account_info(),
            },
            &[signer_seeds],
        ),
        stake_usdc_micros,
        ctx.accounts.usdc_mint.decimals,
    )?;

    // Update profiles
    let voucher_profile = &mut ctx.accounts.voucher_profile;
    voucher_profile.total_vouches_given = voucher_profile.total_vouches_given.saturating_sub(1);

    let vouchee_profile = &mut ctx.accounts.vouchee_profile;
    vouchee_profile.total_vouches_received =
        vouchee_profile.total_vouches_received.saturating_sub(1);
    vouchee_profile.total_vouch_stake_usdc_micros = vouchee_profile
        .total_vouch_stake_usdc_micros
        .saturating_sub(stake_usdc_micros);

    // Recompute reputation
    let config = &ctx.accounts.config;
    vouchee_profile.reputation_score = vouchee_profile.compute_reputation(config);

    emit!(VouchRevoked {
        vouch: ctx.accounts.vouch.key(),
        voucher: ctx.accounts.voucher_profile.key(),
        vouchee: ctx.accounts.vouchee_profile.key(),
        stake_returned_usdc_micros: stake_usdc_micros,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized vouch revocation")]
    UnauthorizedVouchRevocation,
    #[msg("Vouch is not currently revocable")]
    VouchNotRevocable,
    #[msg("Cannot revoke while the vouched author has an open dispute")]
    VoucheeHasOpenDispute,
    #[msg("USDC mint does not match config")]
    InvalidUsdcMint,
    #[msg("Vouch vault does not match account state")]
    VouchVaultMismatch,
    #[msg("Token account mint does not match config")]
    InvalidTokenMint,
    #[msg("Token account owner is invalid")]
    InvalidTokenOwner,
}
