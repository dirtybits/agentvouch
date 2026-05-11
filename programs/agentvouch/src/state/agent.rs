use anchor_lang::prelude::*;

#[account]
pub struct AgentProfile {
    pub authority: Pubkey,                  // Agent's wallet
    pub metadata_uri: String,               // Off-chain metadata (name, description, capabilities)
    pub reputation_score: u64,              // Computed score
    pub total_vouches_received: u32,        // Count of vouches received
    pub total_vouches_given: u32,           // Count of vouches given
    pub total_vouch_stake_usdc_micros: u64, // USDC staked by others vouching for this agent
    pub author_bond_usdc_micros: u64,       // Self-staked trust capital posted by the author
    pub active_free_skill_listings: u32,    // Active zero-price listings gated by the author bond
    pub open_author_disputes: u32,          // Open author disputes that freeze reachable funds
    pub upheld_author_disputes: u32,
    pub dismissed_author_disputes: u32,
    pub reward_vault: Pubkey,
    pub reward_vault_rent_payer: Pubkey,
    pub reward_index_usdc_micros_x1e12: u128,
    pub unclaimed_voucher_revenue_usdc_micros: u64,
    pub registered_at: i64, // Timestamp
    pub bump: u8,           // PDA bump
    pub reward_vault_bump: u8,
}

impl AgentProfile {
    pub const MAX_URI_LENGTH: usize = 200;

    pub const LEN: usize = 8 + // discriminator
        32 + // authority
        (4 + Self::MAX_URI_LENGTH) + // metadata_uri (String = 4 bytes length + content)
        8 + // reputation_score
        4 + // total_vouches_received
        4 + // total_vouches_given
        8 + // total_vouch_stake_usdc_micros
        8 + // author_bond_usdc_micros
        4 + // active_free_skill_listings
        4 + // open_author_disputes
        4 + // upheld_author_disputes
        4 + // dismissed_author_disputes
        32 + // reward_vault
        32 + // reward_vault_rent_payer
        16 + // reward_index_usdc_micros_x1e12
        8 + // unclaimed_voucher_revenue_usdc_micros
        8 + // registered_at
        1 + // bump
        1; // reward_vault_bump

    pub fn compute_reputation(&self, config: &super::ReputationConfig) -> u64 {
        let risk_usdc_micros = self
            .total_vouch_stake_usdc_micros
            .saturating_add(self.author_bond_usdc_micros);
        let risk_component = ((risk_usdc_micros as u128)
            .saturating_mul(config.stake_weight_per_usdc as u128)
            / super::USDC_MICROS_PER_USDC as u128)
            .min(config.risk_component_cap as u128) as u64;
        let vouch_component = (self.total_vouches_received as u64)
            .saturating_mul(config.vouch_weight as u64)
            .min(config.vouch_component_cap);

        let now = Clock::get().unwrap().unix_timestamp;
        let age_seconds = now.saturating_sub(self.registered_at);
        let age_days = age_seconds / 86400;
        let longevity_component = (age_days as u64)
            .saturating_mul(config.longevity_bonus_per_day as u64)
            .min(config.longevity_component_cap);
        let raw_positive_score = risk_component
            .saturating_add(vouch_component)
            .saturating_add(longevity_component);
        let dispute_penalty =
            (self.upheld_author_disputes as u64).saturating_mul(config.upheld_dispute_penalty);

        raw_positive_score
            .saturating_sub(dispute_penalty)
            .min(config.reputation_score_cap)
    }
}
