use anchor_lang::prelude::*;

#[account]
pub struct Vouch {
    pub voucher: Pubkey,        // Who is vouching
    pub vouchee: Pubkey,        // Who is being vouched for
    pub stake_usdc_micros: u64, // USDC stake backing the vouchee
    pub vault: Pubkey,
    pub rent_payer: Pubkey,
    pub created_at: i64,                     // Timestamp
    pub status: VouchStatus,                 // Active, Revoked, Slashed
    pub cumulative_revenue_usdc_micros: u64, // Total marketplace revenue claimed
    pub linked_listing_count: u32,
    pub entry_author_reward_index_x1e12: u128,
    pub pending_rewards_usdc_micros: u64,
    pub last_payout_at: i64, // Last time voucher claimed revenue
    pub bump: u8,            // PDA bump
    pub vault_bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum VouchStatus {
    Active,
    Revoked,
    Slashed,
}

impl Vouch {
    pub const LEN: usize = 8 + // discriminator
        32 + // voucher
        32 + // vouchee
        8 + // stake_usdc_micros
        32 + // vault
        32 + // rent_payer
        8 + // created_at
        1 + // status (enum)
        8 + // cumulative_revenue_usdc_micros
        4 + // linked_listing_count
        16 + // entry_author_reward_index_x1e12
        8 + // pending_rewards_usdc_micros
        8 + // last_payout_at
        1 + // bump
        1; // vault_bump

    pub fn is_uninitialized(&self) -> bool {
        self.voucher == Pubkey::default() && self.vouchee == Pubkey::default()
    }
}

impl VouchStatus {
    pub fn is_live(self) -> bool {
        matches!(self, Self::Active)
    }

    pub fn counts_toward_author_wide_backing_snapshot(self) -> bool {
        matches!(self, Self::Active)
    }
}
