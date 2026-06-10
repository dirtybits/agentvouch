use crate::events::SkillListingUpdated;
use crate::state::{
    find_author_bond_pda, AgentProfile, AuthorBond, ReputationConfig, SkillListing, SkillStatus,
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(skill_id: String)]
pub struct UpdateSkillListing<'info> {
    #[account(
        mut,
        seeds = [b"skill", author.key().as_ref(), skill_id.as_bytes()],
        bump = skill_listing.bump,
        constraint = skill_listing.author == author.key() @ UpdateSkillError::NotAuthor,
        constraint = skill_listing.status != SkillStatus::Removed @ UpdateSkillError::SkillRemoved,
    )]
    pub skill_listing: Box<Account<'info, SkillListing>>,

    #[account(
        mut,
        seeds = [b"agent", author.key().as_ref()],
        bump = author_profile.bump,
    )]
    pub author_profile: Box<Account<'info, AgentProfile>>,

    #[account(
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, ReputationConfig>>,

    pub author_bond: Option<Box<Account<'info, AuthorBond>>>,

    pub author: Signer<'info>,
}

pub fn handler(
    ctx: Context<UpdateSkillListing>,
    _skill_id: String,
    skill_uri: String,
    name: String,
    description: String,
    price_usdc_micros: u64,
) -> Result<()> {
    require!(
        !ctx.accounts.config.paused,
        UpdateSkillError::ProtocolPaused
    );
    require!(
        skill_uri.len() <= SkillListing::MAX_URI_LEN,
        UpdateSkillError::UriTooLong
    );
    require!(
        name.len() <= SkillListing::MAX_NAME_LEN,
        UpdateSkillError::NameTooLong
    );
    require!(
        description.len() <= SkillListing::MAX_DESCRIPTION_LEN,
        UpdateSkillError::DescriptionTooLong
    );
    require!(
        SkillListing::is_supported_price(
            price_usdc_micros,
            ctx.accounts.config.min_paid_listing_price_usdc_micros,
        ),
        UpdateSkillError::PriceNotSupported
    );

    if SkillListing::is_free_price(price_usdc_micros) {
        validate_free_listing_bond(
            ctx.program_id,
            &ctx.accounts.author.key(),
            &ctx.accounts.author_profile,
            &ctx.accounts.config,
            ctx.accounts.author_bond.as_deref(),
        )?;
    }

    let skill_listing = &mut ctx.accounts.skill_listing;
    let clock = Clock::get()?;
    let was_free = SkillListing::is_free_price(skill_listing.price_usdc_micros);
    let will_be_free = SkillListing::is_free_price(price_usdc_micros);

    let revision_changed = skill_listing.skill_uri != skill_uri
        || skill_listing.price_usdc_micros != price_usdc_micros;

    skill_listing.skill_uri = skill_uri;
    skill_listing.name = name.clone();
    skill_listing.description = description;
    skill_listing.price_usdc_micros = price_usdc_micros;
    if revision_changed {
        // A revision bump rotates to a fresh (unlocked) settlement, which
        // would bypass the dispute lock — block it while disputed.
        require!(
            !skill_listing.is_dispute_locked(),
            UpdateSkillError::ListingDisputeLocked
        );
        skill_listing.current_revision = skill_listing
            .current_revision
            .checked_add(1)
            .ok_or(UpdateSkillError::RevisionOverflow)?;
        skill_listing.current_settlement = Pubkey::default();
        skill_listing.current_author_proceeds_vault = Pubkey::default();
    }
    skill_listing.updated_at = clock.unix_timestamp;

    if !was_free && will_be_free {
        ctx.accounts.author_profile.active_free_skill_listings = ctx
            .accounts
            .author_profile
            .active_free_skill_listings
            .checked_add(1)
            .ok_or(UpdateSkillError::FreeListingCountOverflow)?;
    } else if was_free && !will_be_free {
        ctx.accounts.author_profile.active_free_skill_listings = ctx
            .accounts
            .author_profile
            .active_free_skill_listings
            .checked_sub(1)
            .ok_or(UpdateSkillError::FreeListingCountUnderflow)?;
    }

    emit!(SkillListingUpdated {
        skill_listing: ctx.accounts.skill_listing.key(),
        author: ctx.accounts.author.key(),
        name,
        price_usdc_micros,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

fn validate_free_listing_bond(
    program_id: &Pubkey,
    author: &Pubkey,
    author_profile: &Account<AgentProfile>,
    config: &Account<ReputationConfig>,
    author_bond_account: Option<&Account<AuthorBond>>,
) -> Result<()> {
    let author_bond_account =
        author_bond_account.ok_or(UpdateSkillError::MissingAuthorBondForFreeListing)?;
    let (expected_author_bond, _) = find_author_bond_pda(author, program_id);
    require_keys_eq!(
        author_bond_account.key(),
        expected_author_bond,
        UpdateSkillError::AuthorBondAccountMismatch
    );

    require_keys_eq!(
        author_bond_account.author,
        *author,
        UpdateSkillError::AuthorBondAccountMismatch
    );
    require!(
        author_bond_account.amount_usdc_micros == author_profile.author_bond_usdc_micros,
        UpdateSkillError::AuthorBondProfileMismatch
    );
    require!(
        author_bond_account.amount_usdc_micros
            >= config.min_author_bond_for_free_listing_usdc_micros,
        UpdateSkillError::FreeListingRequiresBondFloor
    );

    Ok(())
}

#[error_code]
pub enum UpdateSkillError {
    #[msg("URI too long")]
    UriTooLong,
    #[msg("Name too long")]
    NameTooLong,
    #[msg("Description too long")]
    DescriptionTooLong,
    #[msg("Price must be zero or at least the minimum paid listing price")]
    PriceNotSupported,
    #[msg("Only the author can update this listing")]
    NotAuthor,
    #[msg("Cannot update a removed listing")]
    SkillRemoved,
    #[msg("Free listings must provide the author's bond account")]
    MissingAuthorBondForFreeListing,
    #[msg("Free listings require the configured minimum author bond")]
    FreeListingRequiresBondFloor,
    #[msg("Author bond PDA does not match the expected author")]
    AuthorBondAccountMismatch,
    #[msg("Author bond account does not match the author profile totals")]
    AuthorBondProfileMismatch,
    #[msg("Active free listing count overflowed")]
    FreeListingCountOverflow,
    #[msg("Active free listing count underflowed")]
    FreeListingCountUnderflow,
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("Listing revision overflowed")]
    RevisionOverflow,
    #[msg("Listing is locked by an open dispute")]
    ListingDisputeLocked,
}
