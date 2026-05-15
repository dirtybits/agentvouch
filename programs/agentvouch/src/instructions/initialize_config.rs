use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::state::{
    ReputationConfig, DEFAULT_AUTHOR_PROCEEDS_LOCK_SECONDS, DEFAULT_AUTHOR_SHARE_BPS,
    DEFAULT_CHALLENGER_REWARD_BPS, DEFAULT_CHALLENGER_REWARD_CAP_USDC_MICROS,
    DEFAULT_DISPUTE_BOND_USDC_MICROS, DEFAULT_LONGEVITY_BONUS_PER_DAY,
    DEFAULT_LONGEVITY_COMPONENT_CAP, DEFAULT_MIN_AUTHOR_BOND_FOR_FREE_LISTING_USDC_MICROS,
    DEFAULT_MIN_PAID_LISTING_PRICE_USDC_MICROS, DEFAULT_MIN_VOUCH_STAKE_USDC_MICROS,
    DEFAULT_PROTOCOL_FEE_BPS, DEFAULT_REFUND_CLAIM_WINDOW_SECONDS, DEFAULT_REPUTATION_SCORE_CAP,
    DEFAULT_RISK_COMPONENT_CAP, DEFAULT_SLASH_PERCENTAGE, DEFAULT_STAKE_WEIGHT_PER_USDC,
    DEFAULT_UPHELD_DISPUTE_PENALTY, DEFAULT_VOUCHER_SHARE_BPS, DEFAULT_VOUCH_COMPONENT_CAP,
    DEFAULT_VOUCH_WEIGHT, MAX_CHAIN_CONTEXT_LEN,
};

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = payer,
        space = ReputationConfig::LEN,
        seeds = [b"config"],
        bump
    )]
    pub config: Box<Account<'info, ReputationConfig>>,

    pub usdc_mint: Box<Account<'info, Mint>>,

    /// CHECK: PDA authority for the protocol treasury vault.
    #[account(seeds = [b"treasury_vault_authority"], bump)]
    pub protocol_treasury_vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        token::mint = usdc_mint,
        token::authority = protocol_treasury_vault_authority,
        token::token_program = token_program,
        seeds = [b"treasury_vault"],
        bump
    )]
    pub protocol_treasury_vault: Box<Account<'info, TokenAccount>>,

    /// CHECK: PDA authority for the x402 settlement vault.
    #[account(seeds = [b"x402_settlement_vault_authority"], bump)]
    pub x402_settlement_vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = usdc_mint,
        associated_token::authority = x402_settlement_vault_authority,
        associated_token::token_program = token_program
    )]
    pub x402_settlement_vault: Box<Account<'info, TokenAccount>>,

    /// CHECK: Stored as the legacy root authority for deploy/runbook continuity.
    pub authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeConfig>,
    chain_context: String,
    config_authority: Pubkey,
    treasury_authority: Pubkey,
    settlement_authority: Pubkey,
    pause_authority: Pubkey,
    slash_percentage: u8,
    cooldown_period: i64,
) -> Result<()> {
    require!(
        chain_context.len() <= MAX_CHAIN_CONTEXT_LEN,
        ErrorCode::ChainContextTooLong
    );
    require!(slash_percentage <= 100, ErrorCode::InvalidSlashPercentage);

    let config = &mut ctx.accounts.config;

    config.authority = ctx.accounts.authority.key();
    config.config_authority = config_authority;
    config.treasury_authority = treasury_authority;
    config.settlement_authority = settlement_authority;
    config.pause_authority = pause_authority;
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.token_program = ctx.accounts.token_program.key();
    config.protocol_treasury_vault = ctx.accounts.protocol_treasury_vault.key();
    config.x402_settlement_vault = ctx.accounts.x402_settlement_vault.key();
    config.chain_context = chain_context;
    config.min_vouch_stake_usdc_micros = DEFAULT_MIN_VOUCH_STAKE_USDC_MICROS;
    config.dispute_bond_usdc_micros = DEFAULT_DISPUTE_BOND_USDC_MICROS;
    config.min_author_bond_for_free_listing_usdc_micros =
        DEFAULT_MIN_AUTHOR_BOND_FOR_FREE_LISTING_USDC_MICROS;
    config.min_paid_listing_price_usdc_micros = DEFAULT_MIN_PAID_LISTING_PRICE_USDC_MICROS;
    config.author_share_bps = DEFAULT_AUTHOR_SHARE_BPS;
    config.voucher_share_bps = DEFAULT_VOUCHER_SHARE_BPS;
    config.protocol_fee_bps = DEFAULT_PROTOCOL_FEE_BPS;
    config.slash_percentage = if slash_percentage == 0 {
        DEFAULT_SLASH_PERCENTAGE
    } else {
        slash_percentage
    };
    config.cooldown_period = cooldown_period;
    config.stake_weight_per_usdc = DEFAULT_STAKE_WEIGHT_PER_USDC;
    config.risk_component_cap = DEFAULT_RISK_COMPONENT_CAP;
    config.vouch_weight = DEFAULT_VOUCH_WEIGHT;
    config.vouch_component_cap = DEFAULT_VOUCH_COMPONENT_CAP;
    config.longevity_bonus_per_day = DEFAULT_LONGEVITY_BONUS_PER_DAY;
    config.longevity_component_cap = DEFAULT_LONGEVITY_COMPONENT_CAP;
    config.upheld_dispute_penalty = DEFAULT_UPHELD_DISPUTE_PENALTY;
    config.reputation_score_cap = DEFAULT_REPUTATION_SCORE_CAP;
    config.author_proceeds_lock_seconds = DEFAULT_AUTHOR_PROCEEDS_LOCK_SECONDS;
    config.refund_claim_window_seconds = DEFAULT_REFUND_CLAIM_WINDOW_SECONDS;
    config.challenger_reward_bps = DEFAULT_CHALLENGER_REWARD_BPS;
    config.challenger_reward_cap_usdc_micros = DEFAULT_CHALLENGER_REWARD_CAP_USDC_MICROS;
    config.paused = false;
    config.bump = ctx.bumps.config;

    Ok(())
}

#[error_code]
pub enum ErrorCode {
    #[msg("Chain context is too long")]
    ChainContextTooLong,
    #[msg("Slash percentage must be between 0 and 100")]
    InvalidSlashPercentage,
}
