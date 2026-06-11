use crate::state::{AgentProfile, SkillListing, SkillStatus};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(skill_id: String)]
pub struct RemoveSkillListing<'info> {
    #[account(
        mut,
        seeds = [b"skill", author.key().as_ref(), skill_id.as_bytes()],
        bump = skill_listing.bump,
        constraint = skill_listing.author == author.key() @ RemoveSkillError::NotAuthor,
        constraint = skill_listing.status != SkillStatus::Removed @ RemoveSkillError::AlreadyRemoved,
    )]
    pub skill_listing: Account<'info, SkillListing>,

    #[account(
        mut,
        seeds = [b"agent", author.key().as_ref()],
        bump = author_profile.bump,
    )]
    pub author_profile: Account<'info, AgentProfile>,

    #[account(mut)]
    pub author: Signer<'info>,
}

pub fn handler(ctx: Context<RemoveSkillListing>, _skill_id: String) -> Result<()> {
    // Removal is the first step toward close_skill_listing, which deletes the
    // account that slash_dispute_vouches and create_refund_pool must read.
    // Mirrors the membership freeze on link/unlink/update while disputed.
    require!(
        !ctx.accounts.skill_listing.is_dispute_locked(),
        RemoveSkillError::ListingDisputeLocked
    );
    if crate::state::SkillListing::is_free_price(ctx.accounts.skill_listing.price_usdc_micros) {
        ctx.accounts.author_profile.active_free_skill_listings = ctx
            .accounts
            .author_profile
            .active_free_skill_listings
            .checked_sub(1)
            .ok_or(RemoveSkillError::FreeListingCountUnderflow)?;
    }
    ctx.accounts.skill_listing.status = SkillStatus::Removed;
    ctx.accounts.skill_listing.updated_at = Clock::get()?.unix_timestamp;
    Ok(())
}

#[error_code]
pub enum RemoveSkillError {
    #[msg("Only the skill author can remove this listing")]
    NotAuthor,
    #[msg("Skill listing is already removed")]
    AlreadyRemoved,
    #[msg("Active free listing count underflowed")]
    FreeListingCountUnderflow,
    #[msg("Listing is locked by an open dispute")]
    ListingDisputeLocked,
}
