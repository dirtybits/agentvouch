use anchor_lang::prelude::*;

#[account]
pub struct ListingSettlement {
    pub skill_listing: Pubkey,
    pub author: Pubkey,
    pub revision: u64,
    pub author_proceeds_vault: Pubkey,
    pub total_purchases: u64,
    pub total_purchase_usdc_micros: u64,
    pub total_author_proceeds_usdc_micros: u64,
    pub withdrawable_author_proceeds_usdc_micros: u64,
    pub withdrawn_author_proceeds_usdc_micros: u64,
    pub refunded_author_proceeds_usdc_micros: u64,
    pub locked_by_dispute: Option<Pubkey>,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
    pub author_proceeds_vault_bump: u8,
}

impl ListingSettlement {
    pub const LEN: usize = 8 + // discriminator
        32 + // skill_listing
        32 + // author
        8 + // revision
        32 + // author_proceeds_vault
        8 + // total_purchases
        8 + // total_purchase_usdc_micros
        8 + // total_author_proceeds_usdc_micros
        8 + // withdrawable_author_proceeds_usdc_micros
        8 + // withdrawn_author_proceeds_usdc_micros
        8 + // refunded_author_proceeds_usdc_micros
        (1 + 32) + // locked_by_dispute
        8 + // created_at
        8 + // updated_at
        1 + // bump
        1; // author_proceeds_vault_bump

    pub fn is_locked(&self) -> bool {
        self.locked_by_dispute.is_some()
    }
}

#[account]
pub struct RefundPool {
    pub author_dispute: Pubkey,
    pub skill_listing: Pubkey,
    pub listing_settlement: Pubkey,
    pub revision: u64,
    pub refund_vault: Pubkey,
    pub total_pool_usdc_micros: u64,
    pub remaining_pool_usdc_micros: u64,
    pub claimed_usdc_micros: u64,
    pub max_refund_per_purchase_usdc_micros: u64,
    pub challenger_reward_usdc_micros: u64,
    pub claim_deadline: Option<i64>,
    pub created_at: i64,
    pub bump: u8,
    pub refund_vault_bump: u8,
}

impl RefundPool {
    pub const LEN: usize = 8 + // discriminator
        32 + // author_dispute
        32 + // skill_listing
        32 + // listing_settlement
        8 + // revision
        32 + // refund_vault
        8 + // total_pool_usdc_micros
        8 + // remaining_pool_usdc_micros
        8 + // claimed_usdc_micros
        8 + // max_refund_per_purchase_usdc_micros
        8 + // challenger_reward_usdc_micros
        (1 + 8) + // claim_deadline
        8 + // created_at
        1 + // bump
        1; // refund_vault_bump
}

#[account]
pub struct RefundClaim {
    pub refund_pool: Pubkey,
    pub purchase: Pubkey,
    pub buyer: Pubkey,
    pub amount_usdc_micros: u64,
    pub claimed_at: i64,
    pub bump: u8,
}

impl RefundClaim {
    pub const LEN: usize = 8 + // discriminator
        32 + // refund_pool
        32 + // purchase
        32 + // buyer
        8 + // amount_usdc_micros
        8 + // claimed_at
        1; // bump
}
