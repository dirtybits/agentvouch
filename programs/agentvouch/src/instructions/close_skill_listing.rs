use crate::state::{AgentProfile, SkillListing, SkillStatus};
use anchor_lang::prelude::*;

/// Permanently closes a removed skill listing PDA and reclaims rent.
/// Requires the listing is already Removed.
#[derive(Accounts)]
#[instruction(skill_id: String)]
pub struct CloseSkillListing<'info> {
    #[account(
        mut,
        seeds = [b"skill", author.key().as_ref(), skill_id.as_bytes()],
        bump = skill_listing.bump,
        constraint = skill_listing.author == author.key() @ CloseSkillError::NotAuthor,
        constraint = skill_listing.status == SkillStatus::Removed @ CloseSkillError::NotRemoved,
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

pub fn handler(ctx: Context<CloseSkillListing>, _skill_id: String) -> Result<()> {
    // Closing deletes the account that slash_dispute_vouches and
    // create_refund_pool must deserialize. Without this guard an author could
    // remove+close mid-dispute, leaving the dispute stuck in SlashingVouchers
    // and every voucher's revoke locked behind open_author_disputes forever.
    require!(
        !ctx.accounts.skill_listing.is_dispute_locked(),
        CloseSkillError::ListingDisputeLocked
    );
    Ok(())
}

#[error_code]
pub enum CloseSkillError {
    #[msg("Only the skill author can close this listing")]
    NotAuthor,
    #[msg("Listing must be removed before it can be closed")]
    NotRemoved,
    #[msg("Listing is locked by an open dispute")]
    ListingDisputeLocked,
}
