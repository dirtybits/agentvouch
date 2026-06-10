use anchor_lang::prelude::*;

pub const AUTHOR_DISPUTE_VOUCH_LINK_SEED: &[u8] = b"dispute_vouch_link";

#[account]
pub struct AuthorDisputeVouchLink {
    pub author_dispute: Pubkey,
    pub vouch: Pubkey,
    pub listing_vouch_position: Pubkey,
    pub settled: bool,
    /// Permissionless cranker who paid the link rent, recorded for any
    /// future close/refund path.
    pub rent_payer: Pubkey,
    pub added_at: i64,
    pub bump: u8,
}

impl AuthorDisputeVouchLink {
    pub const LEN: usize = 8 + // discriminator
        32 + // author_dispute
        32 + // vouch
        32 + // listing_vouch_position
        1 + // settled
        32 + // rent_payer
        8 + // added_at
        1; // bump
}
