use anchor_lang::prelude::*;

pub const MAX_ACTIVE_REWARD_POSITIONS_PER_LISTING: u32 = 32;
// 5 remaining accounts per position (position, vouch, vouch vault, vault
// authority, link PDA) — 4 positions plus the fixed accounts stays under the
// 1232-byte transaction limit.
pub const MAX_DISPUTE_POSITIONS_PER_TX: usize = 4;
pub const REWARD_INDEX_SCALE: u128 = 1_000_000_000_000;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum SkillStatus {
    Active,
    Suspended,
    Removed,
}

#[account]
pub struct SkillListing {
    pub author: Pubkey,         // Agent who published the skill
    pub skill_uri: String,      // IPFS hash or Arweave URL
    pub name: String,           // Skill name
    pub description: String,    // Short description
    pub price_usdc_micros: u64, // Price in micro-USDC
    pub reward_vault: Pubkey,
    pub reward_vault_rent_payer: Pubkey,
    pub current_revision: u64,
    pub current_settlement: Pubkey,
    pub current_author_proceeds_vault: Pubkey,
    pub total_downloads: u64, // Number of purchases
    pub total_revenue_usdc_micros: u64,
    pub total_author_revenue_usdc_micros: u64,
    pub total_voucher_revenue_usdc_micros: u64,
    pub active_reward_stake_usdc_micros: u64,
    pub active_reward_position_count: u32,
    pub reward_index_usdc_micros_x1e12: u128,
    pub unclaimed_voucher_revenue_usdc_micros: u64,
    pub created_at: i64,     // Unix timestamp
    pub updated_at: i64,     // Last update timestamp
    pub status: SkillStatus, // Active, Suspended, or Removed
    /// Mirror of the current settlement's dispute lock, kept at the listing
    /// level so it survives settlement rotation: while set, vouch positions
    /// cannot be linked/unlinked, the revision cannot be bumped, and no new
    /// settlement can be initialized for this listing.
    pub locked_by_dispute: Option<Pubkey>,
    pub bump: u8, // PDA bump seed
    pub reward_vault_bump: u8,
}

impl SkillListing {
    pub const MAX_NAME_LEN: usize = 64;
    pub const MAX_DESCRIPTION_LEN: usize = 256;
    pub const MAX_URI_LEN: usize = 256;

    pub const SPACE: usize = 8 + // discriminator
        32 + // author
        (4 + Self::MAX_URI_LEN) + // skill_uri
        (4 + Self::MAX_NAME_LEN) + // name
        (4 + Self::MAX_DESCRIPTION_LEN) + // description
        8 + // price_usdc_micros
        32 + // reward_vault
        32 + // reward_vault_rent_payer
        8 + // current_revision
        32 + // current_settlement
        32 + // current_author_proceeds_vault
        8 + // total_downloads
        8 + // total_revenue_usdc_micros
        8 + // total_author_revenue_usdc_micros
        8 + // total_voucher_revenue_usdc_micros
        8 + // active_reward_stake_usdc_micros
        4 + // active_reward_position_count
        16 + // reward_index_usdc_micros_x1e12
        8 + // unclaimed_voucher_revenue_usdc_micros
        8 + // created_at
        8 + // updated_at
        1 + // status
        (1 + 32) + // locked_by_dispute
        1 + // bump
        1; // reward_vault_bump

    pub fn is_dispute_locked(&self) -> bool {
        self.locked_by_dispute.is_some()
    }

    pub fn is_free_price(price_usdc_micros: u64) -> bool {
        price_usdc_micros == 0
    }

    pub fn is_supported_price(
        price_usdc_micros: u64,
        min_paid_listing_price_usdc_micros: u64,
    ) -> bool {
        Self::is_free_price(price_usdc_micros)
            || price_usdc_micros >= min_paid_listing_price_usdc_micros
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ListingVouchPositionStatus {
    Active,
    Unlinked,
    Slashed,
}

#[account]
pub struct ListingVouchPosition {
    pub skill_listing: Pubkey,
    pub vouch: Pubkey,
    pub voucher: Pubkey,
    pub reward_stake_usdc_micros: u64,
    pub entry_reward_index_x1e12: u128,
    pub pending_rewards_usdc_micros: u64,
    pub cumulative_revenue_usdc_micros: u64,
    pub status: ListingVouchPositionStatus,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

impl ListingVouchPosition {
    pub const LEN: usize = 8 + // discriminator
        32 + // skill_listing
        32 + // vouch
        32 + // voucher
        8 + // reward_stake_usdc_micros
        16 + // entry_reward_index_x1e12
        8 + // pending_rewards_usdc_micros
        8 + // cumulative_revenue_usdc_micros
        1 + // status
        8 + // created_at
        8 + // updated_at
        1; // bump

    pub fn is_active(&self) -> bool {
        self.status == ListingVouchPositionStatus::Active
    }
}
