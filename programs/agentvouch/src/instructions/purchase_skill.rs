use crate::events::SkillPurchased;
use crate::state::{
    AgentProfile, ListingSettlement, Purchase, ReputationConfig, SkillListing, SkillStatus,
    REWARD_INDEX_SCALE,
};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

#[derive(Accounts)]
pub struct PurchaseSkill<'info> {
    #[account(
        mut,
        constraint = skill_listing.status == SkillStatus::Active @ PurchaseError::SkillNotActive,
    )]
    pub skill_listing: Box<Account<'info, SkillListing>>,

    #[account(
        init,
        payer = buyer,
        space = Purchase::SPACE,
        seeds = [
            b"purchase",
            buyer.key().as_ref(),
            skill_listing.key().as_ref(),
            &skill_listing.current_revision.to_le_bytes()
        ],
        bump
    )]
    pub purchase: Box<Account<'info, Purchase>>,

    /// CHECK: Author wallet is validated against the listing author.
    #[account(constraint = author.key() == skill_listing.author @ PurchaseError::InvalidAuthor)]
    pub author: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"agent", skill_listing.author.as_ref()],
        bump,
    )]
    pub author_profile: Box<Account<'info, AgentProfile>>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ReputationConfig>>,

    #[account(address = config.usdc_mint @ PurchaseError::InvalidUsdcMint)]
    pub usdc_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        constraint = buyer_usdc_account.mint == config.usdc_mint @ PurchaseError::InvalidTokenMint,
        constraint = buyer_usdc_account.owner == buyer.key() @ PurchaseError::InvalidTokenOwner
    )]
    pub buyer_usdc_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [
            b"listing_settlement",
            skill_listing.key().as_ref(),
            &skill_listing.current_revision.to_le_bytes()
        ],
        bump = listing_settlement.bump,
        constraint = listing_settlement.skill_listing == skill_listing.key() @ PurchaseError::SettlementMismatch,
        constraint = listing_settlement.author == skill_listing.author @ PurchaseError::SettlementMismatch,
        constraint = listing_settlement.revision == skill_listing.current_revision @ PurchaseError::SettlementMismatch,
        constraint = skill_listing.current_settlement == listing_settlement.key() @ PurchaseError::SettlementMismatch,
    )]
    pub listing_settlement: Box<Account<'info, ListingSettlement>>,

    /// CHECK: PDA authority for the author proceeds vault.
    #[account(
        seeds = [
            b"author_proceeds_vault_authority",
            listing_settlement.key().as_ref()
        ],
        bump
    )]
    pub author_proceeds_vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        address = listing_settlement.author_proceeds_vault @ PurchaseError::AuthorProceedsVaultMismatch,
        constraint = author_proceeds_vault.mint == config.usdc_mint @ PurchaseError::InvalidTokenMint,
        constraint = author_proceeds_vault.owner == author_proceeds_vault_authority.key() @ PurchaseError::InvalidTokenOwner
    )]
    pub author_proceeds_vault: Box<Account<'info, TokenAccount>>,

    /// CHECK: PDA authority for the author-wide voucher reward vault.
    #[account(
        seeds = [
            b"author_reward_vault_authority",
            author_profile.key().as_ref()
        ],
        bump
    )]
    pub author_reward_vault_authority: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = buyer,
        token::mint = usdc_mint,
        token::authority = author_reward_vault_authority,
        token::token_program = token_program,
        seeds = [
            b"author_reward_vault",
            author_profile.key().as_ref()
        ],
        bump
    )]
    pub author_reward_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<PurchaseSkill>) -> Result<()> {
    require!(!ctx.accounts.config.paused, PurchaseError::ProtocolPaused);
    require!(
        !ctx.accounts.listing_settlement.is_locked(),
        PurchaseError::SettlementLocked
    );
    let clock = Clock::get()?;
    let skill_listing_key = ctx.accounts.skill_listing.key();
    let price_usdc_micros = ctx.accounts.skill_listing.price_usdc_micros;
    require!(price_usdc_micros > 0, PurchaseError::FreeSkillNotPurchased);
    let active_vouch_stake_usdc_micros = ctx.accounts.author_profile.total_vouch_stake_usdc_micros;

    if ctx.accounts.author_profile.reward_vault != ctx.accounts.author_reward_vault.key() {
        ctx.accounts.author_profile.reward_vault = ctx.accounts.author_reward_vault.key();
        ctx.accounts.author_profile.reward_vault_rent_payer = ctx.accounts.buyer.key();
        ctx.accounts.author_profile.reward_vault_bump = ctx.bumps.author_reward_vault;
    }

    let has_external_vouch_backing = active_vouch_stake_usdc_micros > 0;
    let (author_share_usdc_micros, voucher_pool_usdc_micros) = if has_external_vouch_backing {
        let author_share_usdc_micros = price_usdc_micros
            .checked_mul(ctx.accounts.config.author_share_bps as u64)
            .ok_or(PurchaseError::PaymentOverflow)?
            .checked_div(10_000)
            .ok_or(PurchaseError::PaymentOverflow)?;
        let voucher_pool_usdc_micros = price_usdc_micros
            .checked_mul(ctx.accounts.config.voucher_share_bps as u64)
            .ok_or(PurchaseError::PaymentOverflow)?
            .checked_div(10_000)
            .ok_or(PurchaseError::PaymentOverflow)?;
        require!(
            voucher_pool_usdc_micros > 0,
            PurchaseError::VoucherPoolTooSmall
        );
        (author_share_usdc_micros, voucher_pool_usdc_micros)
    } else {
        (price_usdc_micros, 0)
    };

    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.buyer_usdc_account.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.author_proceeds_vault.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        author_share_usdc_micros,
        ctx.accounts.usdc_mint.decimals,
    )?;

    if voucher_pool_usdc_micros > 0 {
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.buyer_usdc_account.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.author_reward_vault.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            voucher_pool_usdc_micros,
            ctx.accounts.usdc_mint.decimals,
        )?;
    }

    let skill_listing = &mut ctx.accounts.skill_listing;
    let index_delta = if voucher_pool_usdc_micros > 0 {
        let index_delta = (voucher_pool_usdc_micros as u128)
            .checked_mul(REWARD_INDEX_SCALE)
            .ok_or(PurchaseError::RewardIndexOverflow)?
            .checked_div(active_vouch_stake_usdc_micros as u128)
            .ok_or(PurchaseError::RewardIndexOverflow)?;
        require!(index_delta > 0, PurchaseError::VoucherPoolTooSmall);
        index_delta
    } else {
        0
    };

    skill_listing.total_downloads = skill_listing
        .total_downloads
        .checked_add(1)
        .ok_or(PurchaseError::PaymentOverflow)?;
    skill_listing.total_revenue_usdc_micros = skill_listing
        .total_revenue_usdc_micros
        .checked_add(price_usdc_micros)
        .ok_or(PurchaseError::PaymentOverflow)?;
    skill_listing.total_author_revenue_usdc_micros = skill_listing
        .total_author_revenue_usdc_micros
        .checked_add(author_share_usdc_micros)
        .ok_or(PurchaseError::PaymentOverflow)?;
    skill_listing.total_voucher_revenue_usdc_micros = skill_listing
        .total_voucher_revenue_usdc_micros
        .checked_add(voucher_pool_usdc_micros)
        .ok_or(PurchaseError::PaymentOverflow)?;
    let author_profile = &mut ctx.accounts.author_profile;
    if voucher_pool_usdc_micros > 0 {
        author_profile.reward_index_usdc_micros_x1e12 = author_profile
            .reward_index_usdc_micros_x1e12
            .checked_add(index_delta)
            .ok_or(PurchaseError::RewardIndexOverflow)?;
        author_profile.unclaimed_voucher_revenue_usdc_micros = author_profile
            .unclaimed_voucher_revenue_usdc_micros
            .checked_add(voucher_pool_usdc_micros)
            .ok_or(PurchaseError::PaymentOverflow)?;
    }

    let listing_settlement = &mut ctx.accounts.listing_settlement;
    listing_settlement.total_purchases = listing_settlement
        .total_purchases
        .checked_add(1)
        .ok_or(PurchaseError::PaymentOverflow)?;
    listing_settlement.total_purchase_usdc_micros = listing_settlement
        .total_purchase_usdc_micros
        .checked_add(price_usdc_micros)
        .ok_or(PurchaseError::PaymentOverflow)?;
    listing_settlement.total_author_proceeds_usdc_micros = listing_settlement
        .total_author_proceeds_usdc_micros
        .checked_add(author_share_usdc_micros)
        .ok_or(PurchaseError::PaymentOverflow)?;
    listing_settlement.withdrawable_author_proceeds_usdc_micros = listing_settlement
        .withdrawable_author_proceeds_usdc_micros
        .checked_add(author_share_usdc_micros)
        .ok_or(PurchaseError::PaymentOverflow)?;
    listing_settlement.updated_at = clock.unix_timestamp;

    // Create purchase record
    let purchase = &mut ctx.accounts.purchase;
    purchase.buyer = ctx.accounts.buyer.key();
    purchase.skill_listing = skill_listing_key;
    purchase.purchased_at = clock.unix_timestamp;
    purchase.listing_revision = ctx.accounts.skill_listing.current_revision;
    purchase.listing_settlement = ctx.accounts.listing_settlement.key();
    purchase.price_paid_usdc_micros = price_usdc_micros;
    purchase.author_share_usdc_micros = author_share_usdc_micros;
    purchase.voucher_pool_usdc_micros = voucher_pool_usdc_micros;
    purchase.usdc_mint = ctx.accounts.usdc_mint.key();
    purchase.bump = ctx.bumps.purchase;

    emit!(SkillPurchased {
        purchase: ctx.accounts.purchase.key(),
        skill_listing: skill_listing_key,
        buyer: ctx.accounts.buyer.key(),
        price_usdc_micros,
        author_share_usdc_micros,
        voucher_pool_usdc_micros,
        listing_revision: ctx.accounts.skill_listing.current_revision,
        listing_settlement: ctx.accounts.listing_settlement.key(),
        author_proceeds_vault: ctx.accounts.author_proceeds_vault.key(),
        reward_vault: ctx.accounts.author_reward_vault.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

#[error_code]
pub enum PurchaseError {
    #[msg("Skill is not active")]
    SkillNotActive,
    #[msg("Invalid author")]
    InvalidAuthor,
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("Free skills do not require purchase")]
    FreeSkillNotPurchased,
    #[msg("Payment calculation overflowed")]
    PaymentOverflow,
    #[msg("Voucher pool is too small")]
    VoucherPoolTooSmall,
    #[msg("Reward index overflowed")]
    RewardIndexOverflow,
    #[msg("USDC mint does not match config")]
    InvalidUsdcMint,
    #[msg("Token account mint does not match config")]
    InvalidTokenMint,
    #[msg("Token account owner is invalid")]
    InvalidTokenOwner,
    #[msg("Reward vault does not match author profile")]
    RewardVaultMismatch,
    #[msg("Listing settlement account does not match the active listing revision")]
    SettlementMismatch,
    #[msg("Author proceeds vault does not match settlement state")]
    AuthorProceedsVaultMismatch,
    #[msg("Author proceeds settlement is locked by an open dispute")]
    SettlementLocked,
}
