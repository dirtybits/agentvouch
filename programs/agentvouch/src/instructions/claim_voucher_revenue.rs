use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::events::RevenueClaimed;
use crate::instructions::unlink_vouch_from_listing::accrue_position_rewards;
use crate::state::{AgentProfile, ListingVouchPosition, ReputationConfig, SkillListing, Vouch};

#[derive(Accounts)]
pub struct ClaimVoucherRevenue<'info> {
    #[account(
        mut,
        constraint = skill_listing.author == author_profile.authority @ ClaimError::AuthorMismatch,
    )]
    pub skill_listing: Box<Account<'info, SkillListing>>,

    #[account(
        mut,
        seeds = [
            b"listing_vouch_position",
            skill_listing.key().as_ref(),
            vouch.key().as_ref()
        ],
        bump = listing_vouch_position.bump,
        constraint = listing_vouch_position.skill_listing == skill_listing.key() @ ClaimError::PositionMismatch,
        constraint = listing_vouch_position.vouch == vouch.key() @ ClaimError::PositionMismatch,
    )]
    pub listing_vouch_position: Box<Account<'info, ListingVouchPosition>>,

    #[account(
        seeds = [b"vouch", voucher_profile.key().as_ref(), author_profile.key().as_ref()],
        bump = vouch.bump,
        constraint = vouch.voucher == voucher_profile.key() @ ClaimError::VouchMismatch,
        constraint = vouch.vouchee == author_profile.key() @ ClaimError::VouchMismatch,
    )]
    pub vouch: Box<Account<'info, Vouch>>,

    #[account(
        seeds = [b"agent", skill_listing.author.as_ref()],
        bump = author_profile.bump,
    )]
    pub author_profile: Box<Account<'info, AgentProfile>>,

    #[account(
        seeds = [b"agent", voucher.key().as_ref()],
        bump = voucher_profile.bump,
    )]
    pub voucher_profile: Box<Account<'info, AgentProfile>>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ReputationConfig>>,

    #[account(address = config.usdc_mint @ ClaimError::InvalidUsdcMint)]
    pub usdc_mint: Box<Account<'info, Mint>>,

    /// CHECK: PDA authority for the listing reward vault.
    #[account(seeds = [b"listing_reward_vault_authority", skill_listing.key().as_ref()], bump)]
    pub reward_vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        address = skill_listing.reward_vault @ ClaimError::RewardVaultMismatch,
        constraint = reward_vault.mint == config.usdc_mint @ ClaimError::InvalidTokenMint,
        constraint = reward_vault.owner == reward_vault_authority.key() @ ClaimError::InvalidTokenOwner
    )]
    pub reward_vault: Box<Account<'info, TokenAccount>>,

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
    accrue_position_rewards(
        &ctx.accounts.skill_listing,
        &mut ctx.accounts.listing_vouch_position,
    )?;
    let claimable = ctx
        .accounts
        .listing_vouch_position
        .pending_rewards_usdc_micros;
    require!(claimable > 0, ClaimError::NothingToClaim);

    let listing_key = ctx.accounts.skill_listing.key();
    let signer_bump = [ctx.bumps.reward_vault_authority];
    let signer_seeds: &[&[u8]] = &[
        b"listing_reward_vault_authority",
        listing_key.as_ref(),
        &signer_bump,
    ];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.reward_vault.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.voucher_usdc_account.to_account_info(),
                authority: ctx.accounts.reward_vault_authority.to_account_info(),
            },
            &[signer_seeds],
        ),
        claimable,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let skill_listing = &mut ctx.accounts.skill_listing;
    skill_listing.unclaimed_voucher_revenue_usdc_micros = skill_listing
        .unclaimed_voucher_revenue_usdc_micros
        .checked_sub(claimable)
        .ok_or(ClaimError::InsufficientFunds)?;

    let clock = Clock::get()?;
    let position = &mut ctx.accounts.listing_vouch_position;
    position.pending_rewards_usdc_micros = 0;
    position.cumulative_revenue_usdc_micros = position
        .cumulative_revenue_usdc_micros
        .checked_add(claimable)
        .ok_or(ClaimError::RewardOverflow)?;
    position.updated_at = clock.unix_timestamp;

    let vouch = &mut ctx.accounts.vouch;
    vouch.cumulative_revenue_usdc_micros = vouch
        .cumulative_revenue_usdc_micros
        .checked_add(claimable)
        .ok_or(ClaimError::RewardOverflow)?;
    vouch.last_payout_at = clock.unix_timestamp;

    emit!(RevenueClaimed {
        skill_listing: ctx.accounts.skill_listing.key(),
        listing_vouch_position: ctx.accounts.listing_vouch_position.key(),
        vouch: ctx.accounts.vouch.key(),
        voucher: ctx.accounts.voucher.key(),
        amount_usdc_micros: claimable,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

#[error_code]
pub enum ClaimError {
    #[msg("Skill listing author does not match author profile")]
    AuthorMismatch,
    #[msg("Vouch does not match expected accounts")]
    VouchMismatch,
    #[msg("Listing vouch position does not match expected accounts")]
    PositionMismatch,
    #[msg("No unclaimed revenue available")]
    NothingToClaim,
    #[msg("Insufficient funds in skill listing")]
    InsufficientFunds,
    #[msg("Reward amount overflowed")]
    RewardOverflow,
    #[msg("USDC mint does not match config")]
    InvalidUsdcMint,
    #[msg("Reward vault does not match listing state")]
    RewardVaultMismatch,
    #[msg("Token account mint does not match config")]
    InvalidTokenMint,
    #[msg("Token account owner is invalid")]
    InvalidTokenOwner,
}
