use anchor_lang::prelude::*;

use crate::events::ListingVouchPositionLinked;
use crate::state::{
    AgentProfile, ListingVouchPosition, ListingVouchPositionStatus, ReputationConfig, SkillListing,
    SkillStatus, Vouch, VouchStatus, MAX_ACTIVE_REWARD_POSITIONS_PER_LISTING,
};

#[derive(Accounts)]
pub struct LinkVouchToListing<'info> {
    #[account(
        mut,
        constraint = skill_listing.status == SkillStatus::Active @ LinkError::SkillNotActive,
        constraint = skill_listing.author == author_profile.authority @ LinkError::AuthorMismatch,
    )]
    pub skill_listing: Box<Account<'info, SkillListing>>,

    #[account(
        init,
        payer = voucher,
        space = ListingVouchPosition::LEN,
        seeds = [
            b"listing_vouch_position",
            skill_listing.key().as_ref(),
            vouch.key().as_ref()
        ],
        bump
    )]
    pub listing_vouch_position: Box<Account<'info, ListingVouchPosition>>,

    #[account(
        mut,
        seeds = [b"vouch", voucher_profile.key().as_ref(), author_profile.key().as_ref()],
        bump = vouch.bump,
        constraint = vouch.status == VouchStatus::Active @ LinkError::VouchNotActive,
        constraint = vouch.voucher == voucher_profile.key() @ LinkError::VouchMismatch,
        constraint = vouch.vouchee == author_profile.key() @ LinkError::VouchMismatch,
    )]
    pub vouch: Box<Account<'info, Vouch>>,

    #[account(
        seeds = [b"agent", voucher.key().as_ref()],
        bump = voucher_profile.bump,
    )]
    pub voucher_profile: Box<Account<'info, AgentProfile>>,

    #[account(
        seeds = [b"agent", skill_listing.author.as_ref()],
        bump = author_profile.bump,
    )]
    pub author_profile: Box<Account<'info, AgentProfile>>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ReputationConfig>>,

    #[account(mut)]
    pub voucher: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<LinkVouchToListing>) -> Result<()> {
    require!(!ctx.accounts.config.paused, LinkError::ProtocolPaused);
    require!(
        ctx.accounts.skill_listing.active_reward_position_count
            < MAX_ACTIVE_REWARD_POSITIONS_PER_LISTING,
        LinkError::TooManyRewardPositions
    );
    require!(
        ctx.accounts.vouch.stake_usdc_micros > 0,
        LinkError::VouchStakeTooSmall
    );

    let clock = Clock::get()?;
    let position = &mut ctx.accounts.listing_vouch_position;
    position.skill_listing = ctx.accounts.skill_listing.key();
    position.vouch = ctx.accounts.vouch.key();
    position.voucher = ctx.accounts.voucher_profile.key();
    position.reward_stake_usdc_micros = ctx.accounts.vouch.stake_usdc_micros;
    position.entry_reward_index_x1e12 = ctx.accounts.skill_listing.reward_index_usdc_micros_x1e12;
    position.pending_rewards_usdc_micros = 0;
    position.cumulative_revenue_usdc_micros = 0;
    position.status = ListingVouchPositionStatus::Active;
    position.created_at = clock.unix_timestamp;
    position.updated_at = clock.unix_timestamp;
    position.bump = ctx.bumps.listing_vouch_position;

    let listing = &mut ctx.accounts.skill_listing;
    listing.active_reward_stake_usdc_micros = listing
        .active_reward_stake_usdc_micros
        .checked_add(position.reward_stake_usdc_micros)
        .ok_or(LinkError::RewardStakeOverflow)?;
    listing.active_reward_position_count = listing
        .active_reward_position_count
        .checked_add(1)
        .ok_or(LinkError::RewardPositionCountOverflow)?;

    ctx.accounts.vouch.linked_listing_count = ctx
        .accounts
        .vouch
        .linked_listing_count
        .checked_add(1)
        .ok_or(LinkError::RewardPositionCountOverflow)?;

    emit!(ListingVouchPositionLinked {
        listing_vouch_position: position.key(),
        skill_listing: listing.key(),
        vouch: ctx.accounts.vouch.key(),
        voucher: ctx.accounts.voucher_profile.key(),
        reward_stake_usdc_micros: position.reward_stake_usdc_micros,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

#[error_code]
pub enum LinkError {
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("Skill listing is not active")]
    SkillNotActive,
    #[msg("Skill listing author does not match author profile")]
    AuthorMismatch,
    #[msg("Vouch is not active")]
    VouchNotActive,
    #[msg("Vouch does not match expected accounts")]
    VouchMismatch,
    #[msg("Listing has reached the active reward position limit")]
    TooManyRewardPositions,
    #[msg("Vouch stake is too small to link")]
    VouchStakeTooSmall,
    #[msg("Reward stake overflowed")]
    RewardStakeOverflow,
    #[msg("Reward position count overflowed")]
    RewardPositionCountOverflow,
}
