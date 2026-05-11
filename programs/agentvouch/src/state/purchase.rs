use anchor_lang::prelude::*;

#[account]
pub struct Purchase {
    pub buyer: Pubkey,         // Who purchased the skill
    pub skill_listing: Pubkey, // Which skill was purchased
    pub purchased_at: i64,     // Unix timestamp
    pub listing_revision: u64,
    pub listing_settlement: Pubkey,
    pub price_paid_usdc_micros: u64,
    pub author_share_usdc_micros: u64,
    pub voucher_pool_usdc_micros: u64,
    pub usdc_mint: Pubkey,
    pub bump: u8, // PDA bump seed
}

impl Purchase {
    pub const SPACE: usize = 8 + // discriminator
        32 + // buyer
        32 + // skill_listing
        8 + // purchased_at
        8 + // listing_revision
        32 + // listing_settlement
        8 + // price_paid_usdc_micros
        8 + // author_share_usdc_micros
        8 + // voucher_pool_usdc_micros
        32 + // usdc_mint
        1; // bump
}
