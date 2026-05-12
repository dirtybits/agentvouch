use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum AuthorDisputeReason {
    MaliciousSkill,
    FraudulentClaims,
    FailedDelivery,
    Other,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum AuthorDisputeStatus {
    Open,
    Resolved,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum AuthorDisputeRuling {
    Upheld,
    Dismissed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum AuthorDisputeLiabilityScope {
    AuthorBondOnly,
    AuthorBondThenVouchers,
}

#[account]
pub struct AuthorDispute {
    pub dispute_id: u64,
    pub author: Pubkey,
    pub challenger: Pubkey,
    pub dispute_bond_vault: Pubkey,
    pub rent_payer: Pubkey,
    pub reason: AuthorDisputeReason,
    pub evidence_uri: String,
    pub status: AuthorDisputeStatus,
    pub ruling: Option<AuthorDisputeRuling>,
    pub liability_scope: AuthorDisputeLiabilityScope,
    pub skill_listing: Pubkey,
    pub skill_price_usdc_micros_snapshot: u64,
    pub purchase: Option<Pubkey>,
    pub backing_vouch_count_snapshot: u32,
    pub linked_vouch_count: u32,
    pub processed_vouch_count: u32,
    pub author_bond_slashed_usdc_micros: u64,
    pub voucher_slashed_usdc_micros: u64,
    pub bond_amount_usdc_micros: u64,
    pub created_at: i64,
    pub resolved_at: Option<i64>,
    pub bump: u8,
    pub dispute_bond_vault_bump: u8,
}

impl AuthorDispute {
    pub const MAX_EVIDENCE_URI_LENGTH: usize = 200;

    pub const LEN: usize = 8 + // discriminator
        8 + // dispute_id
        32 + // author
        32 + // challenger
        32 + // dispute_bond_vault
        32 + // rent_payer
        1 + // reason
        (4 + Self::MAX_EVIDENCE_URI_LENGTH) + // evidence_uri
        1 + // status
        (1 + 1) + // ruling
        1 + // liability_scope
        32 + // skill_listing
        8 + // skill_price_usdc_micros_snapshot
        (1 + 32) + // purchase
        4 + // backing_vouch_count_snapshot
        4 + // linked_vouch_count
        4 + // processed_vouch_count
        8 + // author_bond_slashed_usdc_micros
        8 + // voucher_slashed_usdc_micros
        8 + // bond_amount_usdc_micros
        8 + // created_at
        (1 + 8) + // resolved_at
        1 + // bump
        1; // dispute_bond_vault_bump
}
