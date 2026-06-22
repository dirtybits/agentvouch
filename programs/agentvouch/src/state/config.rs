use anchor_lang::prelude::*;

pub const USDC_MICROS_PER_USDC: u64 = 1_000_000;
pub const PROTOCOL_VERSION_V0_2_0: u16 = 2;
pub const MAX_CHAIN_CONTEXT_LEN: usize = 64;

pub const DEFAULT_MIN_PAID_LISTING_PRICE_USDC_MICROS: u64 = 10_000;
pub const DEFAULT_MIN_VOUCH_STAKE_USDC_MICROS: u64 = 1_000_000;
pub const DEFAULT_MIN_AUTHOR_BOND_FOR_FREE_LISTING_USDC_MICROS: u64 = 1_000_000;
pub const DEFAULT_DISPUTE_BOND_USDC_MICROS: u64 = 500_000;
pub const REVENUE_SPLIT_BPS_DENOMINATOR: u32 = 10_000;
pub const DEFAULT_AUTHOR_SHARE_BPS: u16 = 6_000;
pub const DEFAULT_VOUCHER_SHARE_BPS: u16 = 4_000;
// Reserved for future treasury fee routing. Purchases do not collect this yet.
pub const DEFAULT_PROTOCOL_FEE_BPS: u16 = 0;
pub const DEFAULT_SLASH_PERCENTAGE: u8 = 50;
pub const DEFAULT_AUTHOR_PROCEEDS_LOCK_SECONDS: i64 = 0;
pub const DEFAULT_REFUND_CLAIM_WINDOW_SECONDS: i64 = 0;
pub const DEFAULT_CHALLENGER_REWARD_BPS: u16 = 1_000;
pub const DEFAULT_CHALLENGER_REWARD_CAP_USDC_MICROS: u64 = 1_000_000;
pub const DEFAULT_STAKE_WEIGHT_PER_USDC: u32 = 10;
pub const DEFAULT_RISK_COMPONENT_CAP: u64 = 10_000_000;
pub const DEFAULT_VOUCH_WEIGHT: u32 = 10;
pub const DEFAULT_VOUCH_COMPONENT_CAP: u64 = 10_000;
pub const DEFAULT_LONGEVITY_BONUS_PER_DAY: u32 = 1;
pub const DEFAULT_LONGEVITY_COMPONENT_CAP: u64 = 3_650;
pub const DEFAULT_UPHELD_DISPUTE_PENALTY: u64 = 1_000;
pub const DEFAULT_REPUTATION_SCORE_CAP: u64 = 10_100_000;

#[account]
pub struct ReputationConfig {
    pub authority: Pubkey,
    pub config_authority: Pubkey,
    pub treasury_authority: Pubkey,
    pub settlement_authority: Pubkey,
    pub pause_authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub token_program: Pubkey,
    pub protocol_treasury_vault: Pubkey,
    pub x402_settlement_vault: Pubkey,
    pub chain_context: String,
    pub min_vouch_stake_usdc_micros: u64,
    pub dispute_bond_usdc_micros: u64,
    pub min_author_bond_for_free_listing_usdc_micros: u64,
    pub min_paid_listing_price_usdc_micros: u64,
    pub author_share_bps: u16,
    pub voucher_share_bps: u16,
    /// Reserved/deferred. Current purchases route only author + voucher shares,
    /// so live configs must keep this at 0 until protocol fee collection ships.
    pub protocol_fee_bps: u16,
    pub slash_percentage: u8,
    pub cooldown_period: i64,
    pub stake_weight_per_usdc: u32,
    pub risk_component_cap: u64,
    pub vouch_weight: u32,
    pub vouch_component_cap: u64,
    pub longevity_bonus_per_day: u32,
    pub longevity_component_cap: u64,
    pub upheld_dispute_penalty: u64,
    pub reputation_score_cap: u64,
    pub author_proceeds_lock_seconds: i64,
    pub refund_claim_window_seconds: i64,
    pub challenger_reward_bps: u16,
    pub challenger_reward_cap_usdc_micros: u64,
    pub paused: bool,
    pub bump: u8,
}

impl ReputationConfig {
    pub const LEN: usize = 8 + // discriminator
        32 + // authority
        32 + // config_authority
        32 + // treasury_authority
        32 + // settlement_authority
        32 + // pause_authority
        32 + // usdc_mint
        32 + // token_program
        32 + // protocol_treasury_vault
        32 + // x402_settlement_vault
        (4 + MAX_CHAIN_CONTEXT_LEN) + // chain_context
        8 + // min_vouch_stake_usdc_micros
        8 + // dispute_bond_usdc_micros
        8 + // min_author_bond_for_free_listing_usdc_micros
        8 + // min_paid_listing_price_usdc_micros
        2 + // author_share_bps
        2 + // voucher_share_bps
        2 + // protocol_fee_bps
        1 + // slash_percentage
        8 + // cooldown_period
        4 + // stake_weight_per_usdc
        8 + // risk_component_cap
        4 + // vouch_weight
        8 + // vouch_component_cap
        4 + // longevity_bonus_per_day
        8 + // longevity_component_cap
        8 + // upheld_dispute_penalty
        8 + // reputation_score_cap
        8 + // author_proceeds_lock_seconds
        8 + // refund_claim_window_seconds
        2 + // challenger_reward_bps
        8 + // challenger_reward_cap_usdc_micros
        1 + // paused
        1; // bump

    pub fn validate_splits(&self) -> bool {
        u32::from(self.author_share_bps)
            .saturating_add(u32::from(self.voucher_share_bps))
            .saturating_add(u32::from(self.protocol_fee_bps))
            == REVENUE_SPLIT_BPS_DENOMINATOR
    }

    pub fn validate_deferred_protocol_fee(&self) -> bool {
        self.protocol_fee_bps == 0
    }

    pub fn validate_live_revenue_splits(&self) -> bool {
        self.validate_splits() && self.validate_deferred_protocol_fee()
    }
}
