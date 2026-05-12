use anchor_lang::prelude::*;

#[event]
pub struct VouchCreated {
    pub vouch: Pubkey,
    pub voucher: Pubkey,
    pub vouchee: Pubkey,
    pub stake_usdc_micros: u64,
    pub vault: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct VouchRevoked {
    pub vouch: Pubkey,
    pub voucher: Pubkey,
    pub vouchee: Pubkey,
    pub stake_returned_usdc_micros: u64,
    pub timestamp: i64,
}

#[event]
pub struct AuthorBondDeposited {
    pub author_bond: Pubkey,
    pub author: Pubkey,
    pub amount_usdc_micros: u64,
    pub total_bond_usdc_micros: u64,
    pub vault: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AuthorBondWithdrawn {
    pub author_bond: Pubkey,
    pub author: Pubkey,
    pub amount_usdc_micros: u64,
    pub total_bond_usdc_micros: u64,
    pub timestamp: i64,
}

#[event]
pub struct AuthorBondSlashed {
    pub author_bond: Pubkey,
    pub author: Pubkey,
    pub amount_usdc_micros: u64,
    pub remaining_bond_usdc_micros: u64,
    pub timestamp: i64,
}

#[event]
pub struct AuthorDisputeOpened {
    pub author_dispute: Pubkey,
    pub author: Pubkey,
    pub challenger: Pubkey,
    pub reason: String,
    pub liability_scope: String,
    pub skill_listing: Pubkey,
    pub skill_price_usdc_micros_snapshot: u64,
    pub purchase: Option<Pubkey>,
    pub linked_vouch_count: u32,
    pub bond_amount_usdc_micros: u64,
    pub dispute_bond_vault: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AuthorDisputeResolved {
    pub author_dispute: Pubkey,
    pub author: Pubkey,
    pub ruling: String,
    pub liability_scope: String,
    pub linked_vouch_count: u32,
    pub author_bond_slashed_usdc_micros: u64,
    pub voucher_slashed_usdc_micros: u64,
    pub slashed_usdc_micros: u64,
    pub timestamp: i64,
}

#[event]
pub struct AuthorDisputeVouchLinked {
    pub author_dispute: Pubkey,
    pub vouch: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct SkillListingCreated {
    pub skill_listing: Pubkey,
    pub author: Pubkey,
    pub name: String,
    pub price_usdc_micros: u64,
    pub reward_vault: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct SkillListingUpdated {
    pub skill_listing: Pubkey,
    pub author: Pubkey,
    pub name: String,
    pub price_usdc_micros: u64,
    pub timestamp: i64,
}

#[event]
pub struct ListingSettlementInitialized {
    pub skill_listing: Pubkey,
    pub listing_settlement: Pubkey,
    pub author: Pubkey,
    pub revision: u64,
    pub author_proceeds_vault: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct SkillPurchased {
    pub purchase: Pubkey,
    pub skill_listing: Pubkey,
    pub buyer: Pubkey,
    pub price_usdc_micros: u64,
    pub author_share_usdc_micros: u64,
    pub voucher_pool_usdc_micros: u64,
    pub listing_revision: u64,
    pub listing_settlement: Pubkey,
    pub author_proceeds_vault: Pubkey,
    pub reward_vault: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AuthorProceedsWithdrawn {
    pub skill_listing: Pubkey,
    pub listing_settlement: Pubkey,
    pub author: Pubkey,
    pub amount_usdc_micros: u64,
    pub remaining_withdrawable_usdc_micros: u64,
    pub timestamp: i64,
}

#[event]
pub struct RefundPoolCreated {
    pub refund_pool: Pubkey,
    pub author_dispute: Pubkey,
    pub skill_listing: Pubkey,
    pub listing_settlement: Pubkey,
    pub revision: u64,
    pub total_pool_usdc_micros: u64,
    pub challenger_reward_usdc_micros: u64,
    pub claim_deadline: Option<i64>,
    pub timestamp: i64,
}

#[event]
pub struct PurchaseRefundClaimed {
    pub refund_pool: Pubkey,
    pub refund_claim: Pubkey,
    pub purchase: Pubkey,
    pub buyer: Pubkey,
    pub amount_usdc_micros: u64,
    pub timestamp: i64,
}

#[event]
pub struct RevenueClaimed {
    pub author_profile: Pubkey,
    pub author_reward_vault: Pubkey,
    pub vouch: Pubkey,
    pub voucher: Pubkey,
    pub amount_usdc_micros: u64,
    pub timestamp: i64,
}

#[event]
pub struct ListingVouchPositionLinked {
    pub listing_vouch_position: Pubkey,
    pub skill_listing: Pubkey,
    pub vouch: Pubkey,
    pub voucher: Pubkey,
    pub reward_stake_usdc_micros: u64,
    pub timestamp: i64,
}

#[event]
pub struct ListingVouchPositionUnlinked {
    pub listing_vouch_position: Pubkey,
    pub skill_listing: Pubkey,
    pub vouch: Pubkey,
    pub voucher: Pubkey,
    pub pending_rewards_usdc_micros: u64,
    pub timestamp: i64,
}
