use anchor_lang::prelude::*;

#[account]
pub struct X402SettlementReceipt {
    pub payment_ref_hash: [u8; 32],
    pub settlement_tx_signature_hash: [u8; 32],
    pub buyer: Pubkey,
    pub skill_listing: Pubkey,
    pub purchase: Pubkey,
    pub listing_revision: u64,
    pub listing_settlement: Pubkey,
    pub amount_usdc_micros: u64,
    pub author_share_usdc_micros: u64,
    pub voucher_pool_usdc_micros: u64,
    pub settled_at: i64,
    pub bump: u8,
}

impl X402SettlementReceipt {
    pub const SPACE: usize = 8 + // discriminator
        32 + // payment_ref_hash
        32 + // settlement_tx_signature_hash
        32 + // buyer
        32 + // skill_listing
        32 + // purchase
        8 + // listing_revision
        32 + // listing_settlement
        8 + // amount_usdc_micros
        8 + // author_share_usdc_micros
        8 + // voucher_pool_usdc_micros
        8 + // settled_at
        1; // bump
}

#[account]
pub struct X402SettlementSignatureGuard {
    pub settlement_tx_signature_hash: [u8; 32],
    pub receipt: Pubkey,
    pub bump: u8,
}

impl X402SettlementSignatureGuard {
    pub const SPACE: usize = 8 + // discriminator
        32 + // settlement_tx_signature_hash
        32 + // receipt
        1; // bump
}
