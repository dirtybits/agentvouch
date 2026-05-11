use crate::events::VouchCreated;
use crate::state::{AgentProfile, ReputationConfig, Vouch, VouchStatus, REWARD_INDEX_SCALE};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

#[derive(Accounts)]
#[instruction(stake_usdc_micros: u64)]
pub struct CreateVouch<'info> {
    #[account(
        init_if_needed,
        payer = voucher,
        space = Vouch::LEN,
        seeds = [b"vouch", voucher_profile.key().as_ref(), vouchee_profile.key().as_ref()],
        bump
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

    #[account(
        mut,
        constraint = voucher_usdc_account.mint == config.usdc_mint @ ErrorCode::InvalidTokenMint,
        constraint = voucher_usdc_account.owner == voucher.key() @ ErrorCode::InvalidTokenOwner
    )]
    pub voucher_usdc_account: Box<Account<'info, TokenAccount>>,

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
        init_if_needed,
        payer = voucher,
        token::mint = usdc_mint,
        token::authority = vouch_vault_authority,
        token::token_program = token_program,
        seeds = [
            b"vouch_vault",
            voucher_profile.key().as_ref(),
            vouchee_profile.key().as_ref()
        ],
        bump
    )]
    pub vouch_vault: Box<Account<'info, TokenAccount>>,

    /// CHECK: PDA authority for the author-wide voucher reward vault.
    #[account(
        seeds = [
            b"author_reward_vault_authority",
            vouchee_profile.key().as_ref()
        ],
        bump
    )]
    pub author_reward_vault_authority: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = voucher,
        token::mint = usdc_mint,
        token::authority = author_reward_vault_authority,
        token::token_program = token_program,
        seeds = [
            b"author_reward_vault",
            vouchee_profile.key().as_ref()
        ],
        bump
    )]
    pub author_reward_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub voucher: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateVouch>, stake_usdc_micros: u64) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, ErrorCode::ProtocolPaused);

    require!(
        stake_usdc_micros >= config.min_vouch_stake_usdc_micros,
        ErrorCode::StakeBelowMinimum
    );

    require!(
        ctx.accounts.voucher_profile.authority != ctx.accounts.vouchee_profile.authority,
        ErrorCode::CannotVouchForSelf
    );

    let clock = Clock::get()?;
    let is_new_relationship = ctx.accounts.vouch.is_uninitialized();
    let existing_status = ctx.accounts.vouch.status;
    let existing_voucher = ctx.accounts.vouch.voucher;
    let existing_vouchee = ctx.accounts.vouch.vouchee;
    let is_reactivation = !is_new_relationship && existing_status == VouchStatus::Revoked;

    require!(
        is_new_relationship || is_reactivation || existing_status.is_live(),
        ErrorCode::VouchNotReusable
    );

    require!(
        is_new_relationship || existing_voucher == ctx.accounts.voucher_profile.key(),
        ErrorCode::VouchAccountMismatch
    );
    require!(
        is_new_relationship || existing_vouchee == ctx.accounts.vouchee_profile.key(),
        ErrorCode::VouchAccountMismatch
    );
    if ctx.accounts.vouchee_profile.reward_vault == Pubkey::default() {
        ctx.accounts.vouchee_profile.reward_vault = ctx.accounts.author_reward_vault.key();
        ctx.accounts.vouchee_profile.reward_vault_rent_payer = ctx.accounts.voucher.key();
        ctx.accounts.vouchee_profile.reward_vault_bump = ctx.bumps.author_reward_vault;
    } else {
        require_keys_eq!(
            ctx.accounts.vouchee_profile.reward_vault,
            ctx.accounts.author_reward_vault.key(),
            ErrorCode::AuthorRewardVaultMismatch
        );
    }

    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.voucher_usdc_account.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.vouch_vault.to_account_info(),
                authority: ctx.accounts.voucher.to_account_info(),
            },
        ),
        stake_usdc_micros,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let vouch = &mut ctx.accounts.vouch;
    if !is_new_relationship && existing_status.is_live() {
        accrue_author_rewards(&ctx.accounts.vouchee_profile, vouch)?;
    }
    if is_new_relationship {
        vouch.voucher = ctx.accounts.voucher_profile.key();
        vouch.vouchee = ctx.accounts.vouchee_profile.key();
        vouch.stake_usdc_micros = stake_usdc_micros;
        vouch.vault = ctx.accounts.vouch_vault.key();
        vouch.rent_payer = ctx.accounts.voucher.key();
        vouch.created_at = clock.unix_timestamp;
        vouch.status = VouchStatus::Active;
        vouch.cumulative_revenue_usdc_micros = 0;
        vouch.linked_listing_count = 0;
        vouch.entry_author_reward_index_x1e12 =
            ctx.accounts.vouchee_profile.reward_index_usdc_micros_x1e12;
        vouch.pending_rewards_usdc_micros = 0;
        vouch.last_payout_at = clock.unix_timestamp;
        vouch.bump = ctx.bumps.vouch;
        vouch.vault_bump = ctx.bumps.vouch_vault;
    } else if is_reactivation {
        vouch.stake_usdc_micros = stake_usdc_micros;
        vouch.created_at = clock.unix_timestamp;
        vouch.status = VouchStatus::Active;
        vouch.entry_author_reward_index_x1e12 =
            ctx.accounts.vouchee_profile.reward_index_usdc_micros_x1e12;
        vouch.last_payout_at = clock.unix_timestamp;
    } else {
        vouch.stake_usdc_micros = vouch
            .stake_usdc_micros
            .checked_add(stake_usdc_micros)
            .ok_or(ErrorCode::StakeOverflow)?;
        vouch.status = VouchStatus::Active;
    }

    let voucher_profile = &mut ctx.accounts.voucher_profile;
    if is_new_relationship || is_reactivation {
        voucher_profile.total_vouches_given = voucher_profile.total_vouches_given.saturating_add(1);
    }

    let vouchee_profile = &mut ctx.accounts.vouchee_profile;
    if is_new_relationship || is_reactivation {
        vouchee_profile.total_vouches_received =
            vouchee_profile.total_vouches_received.saturating_add(1);
    }
    vouchee_profile.total_vouch_stake_usdc_micros = vouchee_profile
        .total_vouch_stake_usdc_micros
        .saturating_add(stake_usdc_micros);

    // Recompute reputation
    vouchee_profile.reputation_score = vouchee_profile.compute_reputation(config);

    emit!(VouchCreated {
        vouch: ctx.accounts.vouch.key(),
        voucher: ctx.accounts.voucher_profile.key(),
        vouchee: ctx.accounts.vouchee_profile.key(),
        stake_usdc_micros,
        vault: ctx.accounts.vouch_vault.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

fn accrue_author_rewards(
    author_profile: &Account<AgentProfile>,
    vouch: &mut Account<Vouch>,
) -> Result<()> {
    let index_delta = author_profile
        .reward_index_usdc_micros_x1e12
        .checked_sub(vouch.entry_author_reward_index_x1e12)
        .ok_or(ErrorCode::RewardIndexUnderflow)?;
    if index_delta == 0 || vouch.stake_usdc_micros == 0 {
        vouch.entry_author_reward_index_x1e12 = author_profile.reward_index_usdc_micros_x1e12;
        return Ok(());
    }
    let accrued = (vouch.stake_usdc_micros as u128)
        .checked_mul(index_delta)
        .ok_or(ErrorCode::RewardOverflow)?
        .checked_div(REWARD_INDEX_SCALE)
        .ok_or(ErrorCode::RewardOverflow)? as u64;
    vouch.pending_rewards_usdc_micros = vouch
        .pending_rewards_usdc_micros
        .checked_add(accrued)
        .ok_or(ErrorCode::RewardOverflow)?;
    vouch.entry_author_reward_index_x1e12 = author_profile.reward_index_usdc_micros_x1e12;
    Ok(())
}

#[error_code]
pub enum ErrorCode {
    #[msg("Stake amount is below minimum")]
    StakeBelowMinimum,
    #[msg("Cannot vouch for yourself")]
    CannotVouchForSelf,
    #[msg("Stake amount overflowed the existing vouch")]
    StakeOverflow,
    #[msg("Vouch account does not match the expected voucher/vouchee pair")]
    VouchAccountMismatch,
    #[msg("This vouch relationship cannot accept new stake in its current state")]
    VouchNotReusable,
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("USDC mint does not match config")]
    InvalidUsdcMint,
    #[msg("Token account mint does not match config")]
    InvalidTokenMint,
    #[msg("Token account owner is invalid")]
    InvalidTokenOwner,
    #[msg("Author reward vault does not match author profile")]
    AuthorRewardVaultMismatch,
    #[msg("Reward index underflowed")]
    RewardIndexUnderflow,
    #[msg("Reward amount overflowed")]
    RewardOverflow,
}
