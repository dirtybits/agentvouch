use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction};

use crate::state::{
    ReputationConfig, DEFAULT_AUTHOR_PROCEEDS_LOCK_SECONDS, DEFAULT_CHALLENGER_REWARD_BPS,
    DEFAULT_CHALLENGER_REWARD_CAP_USDC_MICROS, DEFAULT_REFUND_CLAIM_WINDOW_SECONDS,
    REVENUE_SPLIT_BPS_DENOMINATOR,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
struct LegacyReputationConfig {
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
    pub paused: bool,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct MigrateConfigM13<'info> {
    /// CHECK: Decoded manually because legacy config accounts are shorter.
    #[account(mut, seeds = [b"config"], bump)]
    pub config: AccountInfo<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<MigrateConfigM13>) -> Result<()> {
    require_keys_eq!(
        *ctx.accounts.config.owner,
        crate::ID,
        MigrateConfigM13Error::ConfigOwnerMismatch
    );

    if ctx.accounts.config.data_len() >= ReputationConfig::LEN {
        return Ok(());
    }

    let legacy = {
        let data = ctx.accounts.config.try_borrow_data()?;
        require!(data.len() >= 8, MigrateConfigM13Error::ConfigTooSmall);
        require!(
            &data[0..8] == ReputationConfig::DISCRIMINATOR,
            MigrateConfigM13Error::ConfigDiscriminatorMismatch
        );
        let mut reader: &[u8] = &data[8..];
        LegacyReputationConfig::deserialize(&mut reader)?
    };

    require_keys_eq!(
        legacy.config_authority,
        ctx.accounts.authority.key(),
        MigrateConfigM13Error::Unauthorized
    );
    let legacy_split_total = u32::from(legacy.author_share_bps)
        .saturating_add(u32::from(legacy.voucher_share_bps))
        .saturating_add(u32::from(legacy.protocol_fee_bps));
    require!(
        legacy_split_total == REVENUE_SPLIT_BPS_DENOMINATOR,
        MigrateConfigM13Error::InvalidRevenueSplits
    );
    require!(
        legacy.protocol_fee_bps == 0,
        MigrateConfigM13Error::ProtocolFeeDeferred
    );

    let rent = Rent::get()?;
    let required_lamports = rent.minimum_balance(ReputationConfig::LEN);
    let current_lamports = ctx.accounts.config.lamports();
    let lamports_to_fund = required_lamports.saturating_sub(current_lamports);
    if lamports_to_fund > 0 {
        invoke(
            &system_instruction::transfer(
                &ctx.accounts.payer.key(),
                &ctx.accounts.config.key(),
                lamports_to_fund,
            ),
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.config.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
    }
    ctx.accounts.config.resize(ReputationConfig::LEN)?;

    let migrated = ReputationConfig {
        authority: legacy.authority,
        config_authority: legacy.config_authority,
        treasury_authority: legacy.treasury_authority,
        settlement_authority: legacy.settlement_authority,
        pause_authority: legacy.pause_authority,
        usdc_mint: legacy.usdc_mint,
        token_program: legacy.token_program,
        protocol_treasury_vault: legacy.protocol_treasury_vault,
        x402_settlement_vault: legacy.x402_settlement_vault,
        chain_context: legacy.chain_context,
        min_vouch_stake_usdc_micros: legacy.min_vouch_stake_usdc_micros,
        dispute_bond_usdc_micros: legacy.dispute_bond_usdc_micros,
        min_author_bond_for_free_listing_usdc_micros: legacy
            .min_author_bond_for_free_listing_usdc_micros,
        min_paid_listing_price_usdc_micros: legacy.min_paid_listing_price_usdc_micros,
        author_share_bps: legacy.author_share_bps,
        voucher_share_bps: legacy.voucher_share_bps,
        protocol_fee_bps: legacy.protocol_fee_bps,
        slash_percentage: legacy.slash_percentage,
        cooldown_period: legacy.cooldown_period,
        stake_weight_per_usdc: legacy.stake_weight_per_usdc,
        risk_component_cap: legacy.risk_component_cap,
        vouch_weight: legacy.vouch_weight,
        vouch_component_cap: legacy.vouch_component_cap,
        longevity_bonus_per_day: legacy.longevity_bonus_per_day,
        longevity_component_cap: legacy.longevity_component_cap,
        upheld_dispute_penalty: legacy.upheld_dispute_penalty,
        reputation_score_cap: legacy.reputation_score_cap,
        author_proceeds_lock_seconds: DEFAULT_AUTHOR_PROCEEDS_LOCK_SECONDS,
        refund_claim_window_seconds: DEFAULT_REFUND_CLAIM_WINDOW_SECONDS,
        challenger_reward_bps: DEFAULT_CHALLENGER_REWARD_BPS,
        challenger_reward_cap_usdc_micros: DEFAULT_CHALLENGER_REWARD_CAP_USDC_MICROS,
        paused: legacy.paused,
        bump: legacy.bump,
    };

    let mut data = ctx.accounts.config.try_borrow_mut_data()?;
    data.fill(0);
    data[0..8].copy_from_slice(ReputationConfig::DISCRIMINATOR);
    let mut writer: &mut [u8] = &mut data[8..];
    migrated.serialize(&mut writer)?;

    Ok(())
}

#[error_code]
pub enum MigrateConfigM13Error {
    #[msg("Config owner does not match the AgentVouch program")]
    ConfigOwnerMismatch,
    #[msg("Config account is too small")]
    ConfigTooSmall,
    #[msg("Config discriminator does not match ReputationConfig")]
    ConfigDiscriminatorMismatch,
    #[msg("Only the config authority can migrate config")]
    Unauthorized,
    #[msg("Revenue shares must sum to 10,000 basis points")]
    InvalidRevenueSplits,
    #[msg("Protocol fee collection is deferred; protocol_fee_bps must be 0")]
    ProtocolFeeDeferred,
}
