use anchor_lang::prelude::*;

use crate::events::ListingVouchPositionUnlinked;
use crate::state::{
    AgentProfile, ListingVouchPosition, ListingVouchPositionStatus, ReputationConfig, SkillListing,
    Vouch,
};

#[derive(Accounts)]
pub struct UnlinkVouchFromListing<'info> {
    #[account(
        mut,
        constraint = skill_listing.author == author_profile.authority @ UnlinkError::AuthorMismatch,
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
        constraint = listing_vouch_position.skill_listing == skill_listing.key() @ UnlinkError::PositionMismatch,
        constraint = listing_vouch_position.vouch == vouch.key() @ UnlinkError::PositionMismatch,
        constraint = listing_vouch_position.status == ListingVouchPositionStatus::Active @ UnlinkError::PositionNotActive,
    )]
    pub listing_vouch_position: Box<Account<'info, ListingVouchPosition>>,

    #[account(
        mut,
        seeds = [b"vouch", voucher_profile.key().as_ref(), author_profile.key().as_ref()],
        bump = vouch.bump,
        constraint = vouch.voucher == voucher_profile.key() @ UnlinkError::VouchMismatch,
        constraint = vouch.vouchee == author_profile.key() @ UnlinkError::VouchMismatch,
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

    pub voucher: Signer<'info>,
}

pub fn handler(ctx: Context<UnlinkVouchFromListing>) -> Result<()> {
    // Slash-set membership is frozen while the listing is dispute-locked:
    // without this, vouchers could exit the slash set mid-dispute.
    require!(
        !ctx.accounts.skill_listing.is_dispute_locked(),
        UnlinkError::ListingDisputeLocked
    );
    accrue_position_rewards(
        &ctx.accounts.skill_listing,
        &mut ctx.accounts.listing_vouch_position,
    )?;

    let position_stake = ctx.accounts.listing_vouch_position.reward_stake_usdc_micros;
    ctx.accounts.listing_vouch_position.reward_stake_usdc_micros = 0;
    ctx.accounts.listing_vouch_position.status = ListingVouchPositionStatus::Unlinked;
    ctx.accounts.listing_vouch_position.updated_at = Clock::get()?.unix_timestamp;

    let listing = &mut ctx.accounts.skill_listing;
    listing.active_reward_stake_usdc_micros = listing
        .active_reward_stake_usdc_micros
        .checked_sub(position_stake)
        .ok_or(UnlinkError::RewardStakeUnderflow)?;
    listing.active_reward_position_count = listing
        .active_reward_position_count
        .checked_sub(1)
        .ok_or(UnlinkError::RewardPositionCountUnderflow)?;

    ctx.accounts.vouch.linked_listing_count = ctx
        .accounts
        .vouch
        .linked_listing_count
        .checked_sub(1)
        .ok_or(UnlinkError::RewardPositionCountUnderflow)?;

    emit!(ListingVouchPositionUnlinked {
        listing_vouch_position: ctx.accounts.listing_vouch_position.key(),
        skill_listing: listing.key(),
        vouch: ctx.accounts.vouch.key(),
        voucher: ctx.accounts.voucher_profile.key(),
        pending_rewards_usdc_micros: ctx
            .accounts
            .listing_vouch_position
            .pending_rewards_usdc_micros,
        timestamp: ctx.accounts.listing_vouch_position.updated_at,
    });

    Ok(())
}

pub(crate) fn accrue_position_rewards(
    listing: &Account<SkillListing>,
    position: &mut Account<ListingVouchPosition>,
) -> Result<()> {
    let index_delta = listing
        .reward_index_usdc_micros_x1e12
        .checked_sub(position.entry_reward_index_x1e12)
        .ok_or(UnlinkError::RewardIndexUnderflow)?;
    if index_delta == 0 || position.reward_stake_usdc_micros == 0 {
        position.entry_reward_index_x1e12 = listing.reward_index_usdc_micros_x1e12;
        return Ok(());
    }
    let accrued = (position.reward_stake_usdc_micros as u128)
        .checked_mul(index_delta)
        .ok_or(UnlinkError::RewardOverflow)?
        .checked_div(crate::state::REWARD_INDEX_SCALE)
        .ok_or(UnlinkError::RewardOverflow)? as u64;
    position.pending_rewards_usdc_micros = position
        .pending_rewards_usdc_micros
        .checked_add(accrued)
        .ok_or(UnlinkError::RewardOverflow)?;
    position.entry_reward_index_x1e12 = listing.reward_index_usdc_micros_x1e12;
    Ok(())
}

#[error_code]
pub enum UnlinkError {
    #[msg("Skill listing author does not match author profile")]
    AuthorMismatch,
    #[msg("Listing vouch position does not match expected accounts")]
    PositionMismatch,
    #[msg("Listing vouch position is not active")]
    PositionNotActive,
    #[msg("Vouch does not match expected accounts")]
    VouchMismatch,
    #[msg("Reward index underflowed")]
    RewardIndexUnderflow,
    #[msg("Reward amount overflowed")]
    RewardOverflow,
    #[msg("Reward stake underflowed")]
    RewardStakeUnderflow,
    #[msg("Reward position count underflowed")]
    RewardPositionCountUnderflow,
    #[msg("Listing is locked by an open dispute")]
    ListingDisputeLocked,
}
