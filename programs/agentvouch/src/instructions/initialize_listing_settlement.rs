use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::events::ListingSettlementInitialized;
use crate::state::{ListingSettlement, ReputationConfig, SkillListing, SkillStatus};

#[derive(Accounts)]
pub struct InitializeListingSettlement<'info> {
    #[account(
        mut,
        constraint = skill_listing.status != SkillStatus::Removed @ InitializeSettlementError::SkillRemoved,
        constraint = skill_listing.author == author.key() @ InitializeSettlementError::NotAuthor,
    )]
    pub skill_listing: Box<Account<'info, SkillListing>>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ReputationConfig>>,

    #[account(address = config.usdc_mint @ InitializeSettlementError::InvalidUsdcMint)]
    pub usdc_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = author,
        space = ListingSettlement::LEN,
        seeds = [
            b"listing_settlement",
            skill_listing.key().as_ref(),
            &skill_listing.current_revision.to_le_bytes()
        ],
        bump
    )]
    pub listing_settlement: Box<Account<'info, ListingSettlement>>,

    /// CHECK: PDA authority for the author proceeds vault.
    #[account(
        seeds = [
            b"author_proceeds_vault_authority",
            listing_settlement.key().as_ref()
        ],
        bump
    )]
    pub author_proceeds_vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = author,
        token::mint = usdc_mint,
        token::authority = author_proceeds_vault_authority,
        token::token_program = token_program,
        seeds = [
            b"author_proceeds_vault",
            listing_settlement.key().as_ref()
        ],
        bump
    )]
    pub author_proceeds_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub author: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeListingSettlement>) -> Result<()> {
    require!(
        !ctx.accounts.config.paused,
        InitializeSettlementError::ProtocolPaused
    );
    // While a dispute locks the listing, a fresh settlement would arrive
    // unlocked and let the author rotate out of the dispute lock.
    require!(
        !ctx.accounts.skill_listing.is_dispute_locked(),
        InitializeSettlementError::ListingDisputeLocked
    );
    let clock = Clock::get()?;

    let settlement = &mut ctx.accounts.listing_settlement;
    settlement.skill_listing = ctx.accounts.skill_listing.key();
    settlement.author = ctx.accounts.author.key();
    settlement.revision = ctx.accounts.skill_listing.current_revision;
    settlement.author_proceeds_vault = ctx.accounts.author_proceeds_vault.key();
    settlement.total_purchases = 0;
    settlement.total_purchase_usdc_micros = 0;
    settlement.total_author_proceeds_usdc_micros = 0;
    settlement.withdrawable_author_proceeds_usdc_micros = 0;
    settlement.withdrawn_author_proceeds_usdc_micros = 0;
    settlement.refunded_author_proceeds_usdc_micros = 0;
    settlement.slashed_deposit_usdc_micros = 0;
    settlement.locked_by_dispute = None;
    settlement.created_at = clock.unix_timestamp;
    settlement.updated_at = clock.unix_timestamp;
    settlement.bump = ctx.bumps.listing_settlement;
    settlement.author_proceeds_vault_bump = ctx.bumps.author_proceeds_vault;

    let listing = &mut ctx.accounts.skill_listing;
    listing.current_settlement = settlement.key();
    listing.current_author_proceeds_vault = ctx.accounts.author_proceeds_vault.key();
    listing.updated_at = clock.unix_timestamp;

    emit!(ListingSettlementInitialized {
        skill_listing: listing.key(),
        listing_settlement: settlement.key(),
        author: ctx.accounts.author.key(),
        revision: settlement.revision,
        author_proceeds_vault: ctx.accounts.author_proceeds_vault.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

#[error_code]
pub enum InitializeSettlementError {
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("Listing is locked by an open dispute")]
    ListingDisputeLocked,
    #[msg("Only the author can initialize settlement for this listing")]
    NotAuthor,
    #[msg("Cannot initialize settlement for a removed listing")]
    SkillRemoved,
    #[msg("USDC mint does not match config")]
    InvalidUsdcMint,
}
