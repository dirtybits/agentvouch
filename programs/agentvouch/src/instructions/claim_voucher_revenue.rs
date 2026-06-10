use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::events::RevenueClaimed;
use crate::state::{AgentProfile, ReputationConfig, Vouch, REWARD_INDEX_SCALE};

#[derive(Accounts)]
pub struct ClaimVoucherRevenue<'info> {
    #[account(
        mut,
        seeds = [b"agent", author_profile.authority.as_ref()],
        bump = author_profile.bump,
    )]
    pub author_profile: Box<Account<'info, AgentProfile>>,

    #[account(
        mut,
        seeds = [b"vouch", voucher_profile.key().as_ref(), author_profile.key().as_ref()],
        bump = vouch.bump,
        constraint = vouch.voucher == voucher_profile.key() @ ClaimError::VouchMismatch,
        constraint = vouch.vouchee == author_profile.key() @ ClaimError::VouchMismatch,
    )]
    pub vouch: Box<Account<'info, Vouch>>,

    #[account(
        seeds = [b"agent", voucher.key().as_ref()],
        bump = voucher_profile.bump,
    )]
    pub voucher_profile: Box<Account<'info, AgentProfile>>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ReputationConfig>>,

    #[account(address = config.usdc_mint @ ClaimError::InvalidUsdcMint)]
    pub usdc_mint: Box<Account<'info, Mint>>,

    /// CHECK: PDA authority for the author-wide voucher reward vault.
    #[account(
        seeds = [
            b"author_reward_vault_authority",
            author_profile.key().as_ref()
        ],
        bump
    )]
    pub author_reward_vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        address = author_profile.reward_vault @ ClaimError::RewardVaultMismatch,
        constraint = author_reward_vault.mint == config.usdc_mint @ ClaimError::InvalidTokenMint,
        constraint = author_reward_vault.owner == author_reward_vault_authority.key() @ ClaimError::InvalidTokenOwner
    )]
    pub author_reward_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = voucher_usdc_account.mint == config.usdc_mint @ ClaimError::InvalidTokenMint,
        constraint = voucher_usdc_account.owner == voucher.key() @ ClaimError::InvalidTokenOwner
    )]
    pub voucher_usdc_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub voucher: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ClaimVoucherRevenue>) -> Result<()> {
    accrue_author_rewards(&ctx.accounts.author_profile, &mut ctx.accounts.vouch)?;
    let claimable = ctx.accounts.vouch.pending_rewards_usdc_micros;
    require!(claimable > 0, ClaimError::NothingToClaim);

    let author_profile_key = ctx.accounts.author_profile.key();
    let signer_bump = [ctx.bumps.author_reward_vault_authority];
    let signer_seeds: &[&[u8]] = &[
        b"author_reward_vault_authority",
        author_profile_key.as_ref(),
        &signer_bump,
    ];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.author_reward_vault.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.voucher_usdc_account.to_account_info(),
                authority: ctx.accounts.author_reward_vault_authority.to_account_info(),
            },
            &[signer_seeds],
        ),
        claimable,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let author_profile = &mut ctx.accounts.author_profile;
    author_profile.unclaimed_voucher_revenue_usdc_micros = author_profile
        .unclaimed_voucher_revenue_usdc_micros
        .checked_sub(claimable)
        .ok_or(ClaimError::InsufficientFunds)?;

    let clock = Clock::get()?;
    let vouch = &mut ctx.accounts.vouch;
    vouch.pending_rewards_usdc_micros = 0;
    vouch.cumulative_revenue_usdc_micros = vouch
        .cumulative_revenue_usdc_micros
        .checked_add(claimable)
        .ok_or(ClaimError::RewardOverflow)?;
    vouch.last_payout_at = clock.unix_timestamp;

    emit!(RevenueClaimed {
        author_profile: ctx.accounts.author_profile.key(),
        author_reward_vault: ctx.accounts.author_reward_vault.key(),
        vouch: ctx.accounts.vouch.key(),
        voucher: ctx.accounts.voucher.key(),
        amount_usdc_micros: claimable,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

pub(crate) fn accrue_author_rewards(
    author_profile: &Account<AgentProfile>,
    vouch: &mut Account<Vouch>,
) -> Result<()> {
    let index_delta = author_profile
        .reward_index_usdc_micros_x1e12
        .checked_sub(vouch.entry_author_reward_index_x1e12)
        .ok_or(ClaimError::RewardIndexUnderflow)?;
    // Non-live vouches must not accrue: their stake was already removed from
    // the profile aggregate that denominates the reward index, so accruing on
    // residual stake would over-distribute and drain the reward vault.
    // Pre-slash pending rewards stay claimable.
    if index_delta == 0 || vouch.stake_usdc_micros == 0 || !vouch.status.is_live() {
        vouch.entry_author_reward_index_x1e12 = author_profile.reward_index_usdc_micros_x1e12;
        return Ok(());
    }
    let accrued = (vouch.stake_usdc_micros as u128)
        .checked_mul(index_delta)
        .ok_or(ClaimError::RewardOverflow)?
        .checked_div(REWARD_INDEX_SCALE)
        .ok_or(ClaimError::RewardOverflow)? as u64;
    vouch.pending_rewards_usdc_micros = vouch
        .pending_rewards_usdc_micros
        .checked_add(accrued)
        .ok_or(ClaimError::RewardOverflow)?;
    vouch.entry_author_reward_index_x1e12 = author_profile.reward_index_usdc_micros_x1e12;
    Ok(())
}

#[error_code]
pub enum ClaimError {
    #[msg("Vouch does not match expected accounts")]
    VouchMismatch,
    #[msg("No unclaimed revenue available")]
    NothingToClaim,
    #[msg("Insufficient funds in author reward pool")]
    InsufficientFunds,
    #[msg("Reward amount overflowed")]
    RewardOverflow,
    #[msg("Reward index underflowed")]
    RewardIndexUnderflow,
    #[msg("USDC mint does not match config")]
    InvalidUsdcMint,
    #[msg("Reward vault does not match author profile")]
    RewardVaultMismatch,
    #[msg("Token account mint does not match config")]
    InvalidTokenMint,
    #[msg("Token account owner is invalid")]
    InvalidTokenOwner,
}
