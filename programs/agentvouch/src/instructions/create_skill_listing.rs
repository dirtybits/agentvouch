use crate::events::SkillListingCreated;
use crate::state::{
    find_author_bond_pda, AgentProfile, AuthorBond, ListingSettlement, ReputationConfig,
    SkillListing, SkillStatus,
};
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

#[derive(Accounts)]
#[instruction(skill_id: String)]
pub struct CreateSkillListing<'info> {
    #[account(
        init,
        payer = author,
        space = SkillListing::SPACE,
        seeds = [b"skill", author.key().as_ref(), skill_id.as_bytes()],
        bump
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

    #[account(address = config.usdc_mint @ CreateSkillError::InvalidUsdcMint)]
    pub usdc_mint: Box<Account<'info, Mint>>,

    /// CHECK: PDA authority for the listing reward vault.
    #[account(seeds = [b"listing_reward_vault_authority", skill_listing.key().as_ref()], bump)]
    pub reward_vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = author,
        token::mint = usdc_mint,
        token::authority = reward_vault_authority,
        token::token_program = token_program,
        seeds = [b"listing_reward_vault", skill_listing.key().as_ref()],
        bump
    )]
    pub reward_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = author,
        space = ListingSettlement::LEN,
        seeds = [
            b"listing_settlement",
            skill_listing.key().as_ref(),
            &0u64.to_le_bytes()
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

pub fn handler(
    ctx: Context<CreateSkillListing>,
    _skill_id: String,
    skill_uri: String,
    name: String,
    description: String,
    price_usdc_micros: u64,
) -> Result<()> {
    require!(
        !ctx.accounts.config.paused,
        CreateSkillError::ProtocolPaused
    );
    require!(
        skill_uri.len() <= SkillListing::MAX_URI_LEN,
        CreateSkillError::UriTooLong
    );
    require!(
        name.len() <= SkillListing::MAX_NAME_LEN,
        CreateSkillError::NameTooLong
    );
    require!(
        description.len() <= SkillListing::MAX_DESCRIPTION_LEN,
        CreateSkillError::DescriptionTooLong
    );
    require!(
        SkillListing::is_supported_price(
            price_usdc_micros,
            ctx.accounts.config.min_paid_listing_price_usdc_micros,
        ),
        CreateSkillError::PriceNotSupported
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

    skill_listing.author = ctx.accounts.author.key();
    skill_listing.skill_uri = skill_uri;
    skill_listing.name = name.clone();
    skill_listing.description = description;
    skill_listing.price_usdc_micros = price_usdc_micros;
    skill_listing.reward_vault = ctx.accounts.reward_vault.key();
    skill_listing.reward_vault_rent_payer = ctx.accounts.author.key();
    skill_listing.current_revision = 0;
    skill_listing.current_settlement = ctx.accounts.listing_settlement.key();
    skill_listing.current_author_proceeds_vault = ctx.accounts.author_proceeds_vault.key();
    skill_listing.total_downloads = 0;
    skill_listing.total_revenue_usdc_micros = 0;
    skill_listing.total_author_revenue_usdc_micros = 0;
    skill_listing.total_voucher_revenue_usdc_micros = 0;
    skill_listing.active_reward_stake_usdc_micros = 0;
    skill_listing.active_reward_position_count = 0;
    skill_listing.reward_index_usdc_micros_x1e12 = 0;
    skill_listing.unclaimed_voucher_revenue_usdc_micros = 0;
    skill_listing.created_at = clock.unix_timestamp;
    skill_listing.updated_at = clock.unix_timestamp;
    skill_listing.status = SkillStatus::Active;
    skill_listing.bump = ctx.bumps.skill_listing;
    skill_listing.reward_vault_bump = ctx.bumps.reward_vault;

    let listing_settlement = &mut ctx.accounts.listing_settlement;
    listing_settlement.skill_listing = ctx.accounts.skill_listing.key();
    listing_settlement.author = ctx.accounts.author.key();
    listing_settlement.revision = 0;
    listing_settlement.author_proceeds_vault = ctx.accounts.author_proceeds_vault.key();
    listing_settlement.total_purchases = 0;
    listing_settlement.total_purchase_usdc_micros = 0;
    listing_settlement.total_author_proceeds_usdc_micros = 0;
    listing_settlement.withdrawable_author_proceeds_usdc_micros = 0;
    listing_settlement.withdrawn_author_proceeds_usdc_micros = 0;
    listing_settlement.refunded_author_proceeds_usdc_micros = 0;
    listing_settlement.locked_by_dispute = None;
    listing_settlement.created_at = clock.unix_timestamp;
    listing_settlement.updated_at = clock.unix_timestamp;
    listing_settlement.bump = ctx.bumps.listing_settlement;
    listing_settlement.author_proceeds_vault_bump = ctx.bumps.author_proceeds_vault;

    if SkillListing::is_free_price(price_usdc_micros) {
        ctx.accounts.author_profile.active_free_skill_listings = ctx
            .accounts
            .author_profile
            .active_free_skill_listings
            .checked_add(1)
            .ok_or(CreateSkillError::FreeListingCountOverflow)?;
    }

    emit!(SkillListingCreated {
        skill_listing: ctx.accounts.skill_listing.key(),
        author: ctx.accounts.author.key(),
        name,
        price_usdc_micros,
        reward_vault: ctx.accounts.reward_vault.key(),
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
        author_bond_account.ok_or(CreateSkillError::MissingAuthorBondForFreeListing)?;
    let (expected_author_bond, _) = find_author_bond_pda(author, program_id);
    require_keys_eq!(
        author_bond_account.key(),
        expected_author_bond,
        CreateSkillError::AuthorBondAccountMismatch
    );

    require_keys_eq!(
        author_bond_account.author,
        *author,
        CreateSkillError::AuthorBondAccountMismatch
    );
    require!(
        author_bond_account.amount_usdc_micros == author_profile.author_bond_usdc_micros,
        CreateSkillError::AuthorBondProfileMismatch
    );
    require!(
        author_bond_account.amount_usdc_micros
            >= config.min_author_bond_for_free_listing_usdc_micros,
        CreateSkillError::FreeListingRequiresBondFloor
    );

    Ok(())
}

#[error_code]
pub enum CreateSkillError {
    #[msg("URI too long")]
    UriTooLong,
    #[msg("Name too long")]
    NameTooLong,
    #[msg("Description too long")]
    DescriptionTooLong,
    #[msg("Price must be zero or at least the minimum paid listing price")]
    PriceNotSupported,
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
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("USDC mint does not match config")]
    InvalidUsdcMint,
}
