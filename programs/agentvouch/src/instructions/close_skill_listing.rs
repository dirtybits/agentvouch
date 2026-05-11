use crate::state::{AgentProfile, SkillListing, SkillStatus};
use anchor_lang::prelude::*;

/// Permanently closes a removed skill listing PDA and reclaims rent.
/// Requires the listing is already Removed and has no pending voucher revenue.
#[derive(Accounts)]
#[instruction(skill_id: String)]
pub struct CloseSkillListing<'info> {
    #[account(
        mut,
        seeds = [b"skill", author.key().as_ref(), skill_id.as_bytes()],
        bump = skill_listing.bump,
        constraint = skill_listing.author == author.key() @ CloseSkillError::NotAuthor,
        constraint = skill_listing.status == SkillStatus::Removed @ CloseSkillError::NotRemoved,
        constraint = skill_listing.unclaimed_voucher_revenue_usdc_micros == 0 @ CloseSkillError::UnclaimedRevenue,
        constraint = skill_listing.active_reward_position_count == 0 @ CloseSkillError::ActiveRewardPositions,
        close = author,
    )]
    pub skill_listing: Account<'info, SkillListing>,

    #[account(
        seeds = [b"agent", author.key().as_ref()],
        bump = author_profile.bump,
    )]
    pub author_profile: Account<'info, AgentProfile>,

    #[account(mut)]
    pub author: Signer<'info>,
}

pub fn handler(_ctx: Context<CloseSkillListing>, _skill_id: String) -> Result<()> {
    Ok(())
}

#[error_code]
pub enum CloseSkillError {
    #[msg("Only the skill author can close this listing")]
    NotAuthor,
    #[msg("Listing must be removed before it can be closed")]
    NotRemoved,
    #[msg("Listing has unclaimed voucher revenue; claim it before closing")]
    UnclaimedRevenue,
    #[msg("Listing still has active reward positions")]
    ActiveRewardPositions,
}
