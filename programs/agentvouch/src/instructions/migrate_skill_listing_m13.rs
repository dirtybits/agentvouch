use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction};
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::events::ListingSettlementInitialized;
use crate::state::{
    ListingSettlement, ReputationConfig, SkillListing, SkillStatus,
    MAX_ACTIVE_REWARD_POSITIONS_PER_LISTING,
};

const M13_INITIAL_REVISION: u64 = 0;
const M13_INSERTED_SKILL_LISTING_BYTES: usize = 32 + 8 + 32 + 32;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
struct LegacySkillListing {
    pub author: Pubkey,
    pub skill_uri: String,
    pub name: String,
    pub description: String,
    pub price_usdc_micros: u64,
    pub reward_vault: Pubkey,
    pub reward_vault_rent_payer: Pubkey,
    pub total_downloads: u64,
    pub total_revenue_usdc_micros: u64,
    pub total_author_revenue_usdc_micros: u64,
    pub total_voucher_revenue_usdc_micros: u64,
    pub active_reward_stake_usdc_micros: u64,
    pub active_reward_position_count: u32,
    pub reward_index_usdc_micros_x1e12: u128,
    pub unclaimed_voucher_revenue_usdc_micros: u64,
    pub created_at: i64,
    pub updated_at: i64,
    pub status: SkillStatus,
    pub bump: u8,
    pub reward_vault_bump: u8,
}

impl LegacySkillListing {
    pub const LEN: usize = SkillListing::SPACE - M13_INSERTED_SKILL_LISTING_BYTES;
}

#[derive(Accounts)]
pub struct MigrateSkillListingM13<'info> {
    /// CHECK: Decoded manually because legacy listing accounts are shorter.
    #[account(mut)]
    pub skill_listing: AccountInfo<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ReputationConfig>>,

    #[account(address = config.usdc_mint @ MigrateSkillListingM13Error::InvalidUsdcMint)]
    pub usdc_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = payer,
        space = ListingSettlement::LEN,
        seeds = [
            b"listing_settlement",
            skill_listing.key().as_ref(),
            &M13_INITIAL_REVISION.to_le_bytes()
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
        payer = payer,
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
    pub payer: Signer<'info>,

    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<MigrateSkillListingM13>) -> Result<()> {
    require_keys_eq!(
        *ctx.accounts.skill_listing.owner,
        crate::ID,
        MigrateSkillListingM13Error::SkillListingOwnerMismatch
    );
    require!(
        ctx.accounts.skill_listing.data_len() < SkillListing::SPACE,
        MigrateSkillListingM13Error::SkillListingAlreadyMigrated
    );
    require!(
        ctx.accounts.skill_listing.data_len() >= LegacySkillListing::LEN,
        MigrateSkillListingM13Error::SkillListingTooSmall
    );

    let legacy = {
        let data = ctx.accounts.skill_listing.try_borrow_data()?;
        require!(
            data.len() >= 8,
            MigrateSkillListingM13Error::SkillListingTooSmall
        );
        require!(
            &data[0..8] == SkillListing::DISCRIMINATOR,
            MigrateSkillListingM13Error::SkillListingDiscriminatorMismatch
        );
        let mut reader: &[u8] = &data[8..];
        LegacySkillListing::deserialize(&mut reader)?
    };

    require!(
        legacy.status != SkillStatus::Removed,
        MigrateSkillListingM13Error::SkillRemoved
    );
    require!(
        legacy.active_reward_position_count <= MAX_ACTIVE_REWARD_POSITIONS_PER_LISTING,
        MigrateSkillListingM13Error::InvalidRewardPositionCount
    );
    require!(
        ctx.accounts.authority.key() == legacy.author
            || ctx.accounts.authority.key() == ctx.accounts.config.config_authority,
        MigrateSkillListingM13Error::Unauthorized
    );

    let clock = Clock::get()?;
    let rent = Rent::get()?;
    let required_lamports = rent.minimum_balance(SkillListing::SPACE);
    let current_lamports = ctx.accounts.skill_listing.lamports();
    if required_lamports > current_lamports {
        invoke(
            &system_instruction::transfer(
                &ctx.accounts.payer.key(),
                &ctx.accounts.skill_listing.key(),
                required_lamports - current_lamports,
            ),
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.skill_listing.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
    }

    ctx.accounts.skill_listing.resize(SkillListing::SPACE)?;

    let migrated = SkillListing {
        author: legacy.author,
        skill_uri: legacy.skill_uri,
        name: legacy.name,
        description: legacy.description,
        price_usdc_micros: legacy.price_usdc_micros,
        reward_vault: legacy.reward_vault,
        reward_vault_rent_payer: legacy.reward_vault_rent_payer,
        current_revision: M13_INITIAL_REVISION,
        current_settlement: ctx.accounts.listing_settlement.key(),
        current_author_proceeds_vault: ctx.accounts.author_proceeds_vault.key(),
        total_downloads: legacy.total_downloads,
        total_revenue_usdc_micros: legacy.total_revenue_usdc_micros,
        total_author_revenue_usdc_micros: legacy.total_author_revenue_usdc_micros,
        total_voucher_revenue_usdc_micros: legacy.total_voucher_revenue_usdc_micros,
        active_reward_stake_usdc_micros: legacy.active_reward_stake_usdc_micros,
        active_reward_position_count: legacy.active_reward_position_count,
        reward_index_usdc_micros_x1e12: legacy.reward_index_usdc_micros_x1e12,
        unclaimed_voucher_revenue_usdc_micros: legacy.unclaimed_voucher_revenue_usdc_micros,
        created_at: legacy.created_at,
        updated_at: clock.unix_timestamp,
        status: legacy.status,
        bump: legacy.bump,
        reward_vault_bump: legacy.reward_vault_bump,
    };

    {
        let mut data = ctx.accounts.skill_listing.try_borrow_mut_data()?;
        data.fill(0);
        data[0..8].copy_from_slice(SkillListing::DISCRIMINATOR);
        let mut writer: &mut [u8] = &mut data[8..];
        migrated.serialize(&mut writer)?;
    }

    let settlement = &mut ctx.accounts.listing_settlement;
    settlement.skill_listing = ctx.accounts.skill_listing.key();
    settlement.author = legacy.author;
    settlement.revision = M13_INITIAL_REVISION;
    settlement.author_proceeds_vault = ctx.accounts.author_proceeds_vault.key();
    settlement.total_purchases = 0;
    settlement.total_purchase_usdc_micros = 0;
    settlement.total_author_proceeds_usdc_micros = 0;
    settlement.withdrawable_author_proceeds_usdc_micros = 0;
    settlement.withdrawn_author_proceeds_usdc_micros = 0;
    settlement.refunded_author_proceeds_usdc_micros = 0;
    settlement.locked_by_dispute = None;
    settlement.created_at = clock.unix_timestamp;
    settlement.updated_at = clock.unix_timestamp;
    settlement.bump = ctx.bumps.listing_settlement;
    settlement.author_proceeds_vault_bump = ctx.bumps.author_proceeds_vault;

    emit!(ListingSettlementInitialized {
        skill_listing: ctx.accounts.skill_listing.key(),
        listing_settlement: ctx.accounts.listing_settlement.key(),
        author: legacy.author,
        revision: M13_INITIAL_REVISION,
        author_proceeds_vault: ctx.accounts.author_proceeds_vault.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

#[error_code]
pub enum MigrateSkillListingM13Error {
    #[msg("Skill listing owner does not match the AgentVouch program")]
    SkillListingOwnerMismatch,
    #[msg("Skill listing already uses the M13 layout")]
    SkillListingAlreadyMigrated,
    #[msg("Skill listing account is too small")]
    SkillListingTooSmall,
    #[msg("Skill listing discriminator does not match SkillListing")]
    SkillListingDiscriminatorMismatch,
    #[msg("Only the listing author or config authority can migrate the skill listing")]
    Unauthorized,
    #[msg("Cannot migrate a removed skill listing")]
    SkillRemoved,
    #[msg("USDC mint does not match config")]
    InvalidUsdcMint,
    #[msg("Legacy reward position count is invalid")]
    InvalidRewardPositionCount,
}
