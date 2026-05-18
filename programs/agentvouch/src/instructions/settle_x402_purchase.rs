use crate::events::X402PurchaseSettled;
use crate::state::{
    AgentProfile, ListingSettlement, Purchase, ReputationConfig, SkillListing, SkillStatus,
    X402SettlementReceipt, X402SettlementSignatureGuard, REWARD_INDEX_SCALE,
};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

#[derive(Accounts)]
#[instruction(
    payment_ref_hash: [u8; 32],
    settlement_tx_signature_hash: [u8; 32],
    buyer: Pubkey,
    amount_usdc_micros: u64
)]
pub struct SettleX402Purchase<'info> {
    #[account(
        mut,
        constraint = skill_listing.status == SkillStatus::Active @ SettleX402PurchaseError::SkillNotActive,
    )]
    pub skill_listing: Box<Account<'info, SkillListing>>,

    #[account(
        init,
        payer = settlement_authority,
        space = Purchase::SPACE,
        seeds = [
            b"purchase",
            buyer.as_ref(),
            skill_listing.key().as_ref(),
            &skill_listing.current_revision.to_le_bytes()
        ],
        bump
    )]
    pub purchase: Box<Account<'info, Purchase>>,

    /// CHECK: Author wallet is validated against the listing author.
    #[account(constraint = author.key() == skill_listing.author @ SettleX402PurchaseError::InvalidAuthor)]
    pub author: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"agent", skill_listing.author.as_ref()],
        bump,
    )]
    pub author_profile: Box<Account<'info, AgentProfile>>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ReputationConfig>>,

    #[account(address = config.usdc_mint @ SettleX402PurchaseError::InvalidUsdcMint)]
    pub usdc_mint: Box<Account<'info, Mint>>,

    /// CHECK: PDA authority for the x402 settlement vault.
    #[account(seeds = [b"x402_settlement_vault_authority"], bump)]
    pub x402_settlement_vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        address = config.x402_settlement_vault @ SettleX402PurchaseError::X402SettlementVaultMismatch,
        constraint = x402_settlement_vault.mint == config.usdc_mint @ SettleX402PurchaseError::InvalidTokenMint,
        constraint = x402_settlement_vault.owner == x402_settlement_vault_authority.key() @ SettleX402PurchaseError::InvalidTokenOwner
    )]
    pub x402_settlement_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [
            b"listing_settlement",
            skill_listing.key().as_ref(),
            &skill_listing.current_revision.to_le_bytes()
        ],
        bump = listing_settlement.bump,
        constraint = listing_settlement.skill_listing == skill_listing.key() @ SettleX402PurchaseError::SettlementMismatch,
        constraint = listing_settlement.author == skill_listing.author @ SettleX402PurchaseError::SettlementMismatch,
        constraint = listing_settlement.revision == skill_listing.current_revision @ SettleX402PurchaseError::SettlementMismatch,
        constraint = skill_listing.current_settlement == listing_settlement.key() @ SettleX402PurchaseError::SettlementMismatch,
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
        address = listing_settlement.author_proceeds_vault @ SettleX402PurchaseError::AuthorProceedsVaultMismatch,
        constraint = author_proceeds_vault.mint == config.usdc_mint @ SettleX402PurchaseError::InvalidTokenMint,
        constraint = author_proceeds_vault.owner == author_proceeds_vault_authority.key() @ SettleX402PurchaseError::InvalidTokenOwner
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
        payer = settlement_authority,
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

    #[account(
        init,
        payer = settlement_authority,
        space = X402SettlementReceipt::SPACE,
        seeds = [
            b"x402_settlement_receipt",
            payment_ref_hash.as_ref()
        ],
        bump
    )]
    pub x402_settlement_receipt: Box<Account<'info, X402SettlementReceipt>>,

    #[account(
        init,
        payer = settlement_authority,
        space = X402SettlementSignatureGuard::SPACE,
        seeds = [
            b"x402_settlement_signature",
            settlement_tx_signature_hash.as_ref()
        ],
        bump
    )]
    pub x402_settlement_signature_guard: Box<Account<'info, X402SettlementSignatureGuard>>,

    #[account(
        mut,
        address = config.settlement_authority @ SettleX402PurchaseError::InvalidSettlementAuthority
    )]
    pub settlement_authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<SettleX402Purchase>,
    payment_ref_hash: [u8; 32],
    settlement_tx_signature_hash: [u8; 32],
    buyer: Pubkey,
    amount_usdc_micros: u64,
) -> Result<()> {
    require!(
        payment_ref_hash != [0; 32],
        SettleX402PurchaseError::InvalidPaymentRefHash
    );
    require!(
        settlement_tx_signature_hash != [0; 32],
        SettleX402PurchaseError::InvalidSettlementSignatureHash
    );
    require!(
        !ctx.accounts.config.paused,
        SettleX402PurchaseError::ProtocolPaused
    );
    require!(
        !ctx.accounts.listing_settlement.is_locked(),
        SettleX402PurchaseError::SettlementLocked
    );

    let clock = Clock::get()?;
    let skill_listing_key = ctx.accounts.skill_listing.key();
    let price_usdc_micros = ctx.accounts.skill_listing.price_usdc_micros;
    require!(
        price_usdc_micros > 0,
        SettleX402PurchaseError::FreeSkillNotPurchased
    );
    require!(
        amount_usdc_micros == price_usdc_micros,
        SettleX402PurchaseError::InvalidSettlementAmount
    );

    let active_vouch_stake_usdc_micros = ctx.accounts.author_profile.total_vouch_stake_usdc_micros;

    if ctx.accounts.author_profile.reward_vault != ctx.accounts.author_reward_vault.key() {
        ctx.accounts.author_profile.reward_vault = ctx.accounts.author_reward_vault.key();
        ctx.accounts.author_profile.reward_vault_rent_payer =
            ctx.accounts.settlement_authority.key();
        ctx.accounts.author_profile.reward_vault_bump = ctx.bumps.author_reward_vault;
    }

    let has_external_vouch_backing = active_vouch_stake_usdc_micros > 0;
    let (author_share_usdc_micros, voucher_pool_usdc_micros) = if has_external_vouch_backing {
        let author_share_usdc_micros = price_usdc_micros
            .checked_mul(ctx.accounts.config.author_share_bps as u64)
            .ok_or(SettleX402PurchaseError::PaymentOverflow)?
            .checked_div(10_000)
            .ok_or(SettleX402PurchaseError::PaymentOverflow)?;
        let voucher_pool_usdc_micros = price_usdc_micros
            .checked_mul(ctx.accounts.config.voucher_share_bps as u64)
            .ok_or(SettleX402PurchaseError::PaymentOverflow)?
            .checked_div(10_000)
            .ok_or(SettleX402PurchaseError::PaymentOverflow)?;
        require!(
            voucher_pool_usdc_micros > 0,
            SettleX402PurchaseError::VoucherPoolTooSmall
        );
        (author_share_usdc_micros, voucher_pool_usdc_micros)
    } else {
        (price_usdc_micros, 0)
    };

    let x402_vault_signer_bump = [ctx.bumps.x402_settlement_vault_authority];
    let x402_vault_signer_seeds: &[&[u8]] =
        &[b"x402_settlement_vault_authority", &x402_vault_signer_bump];

    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.x402_settlement_vault.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.author_proceeds_vault.to_account_info(),
                authority: ctx
                    .accounts
                    .x402_settlement_vault_authority
                    .to_account_info(),
            },
            &[x402_vault_signer_seeds],
        ),
        author_share_usdc_micros,
        ctx.accounts.usdc_mint.decimals,
    )?;

    if voucher_pool_usdc_micros > 0 {
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.x402_settlement_vault.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.author_reward_vault.to_account_info(),
                    authority: ctx
                        .accounts
                        .x402_settlement_vault_authority
                        .to_account_info(),
                },
                &[x402_vault_signer_seeds],
            ),
            voucher_pool_usdc_micros,
            ctx.accounts.usdc_mint.decimals,
        )?;
    }

    let index_delta = if voucher_pool_usdc_micros > 0 {
        let index_delta = (voucher_pool_usdc_micros as u128)
            .checked_mul(REWARD_INDEX_SCALE)
            .ok_or(SettleX402PurchaseError::RewardIndexOverflow)?
            .checked_div(active_vouch_stake_usdc_micros as u128)
            .ok_or(SettleX402PurchaseError::RewardIndexOverflow)?;
        require!(
            index_delta > 0,
            SettleX402PurchaseError::VoucherPoolTooSmall
        );
        index_delta
    } else {
        0
    };

    let skill_listing = &mut ctx.accounts.skill_listing;
    skill_listing.total_downloads = skill_listing
        .total_downloads
        .checked_add(1)
        .ok_or(SettleX402PurchaseError::PaymentOverflow)?;
    skill_listing.total_revenue_usdc_micros = skill_listing
        .total_revenue_usdc_micros
        .checked_add(price_usdc_micros)
        .ok_or(SettleX402PurchaseError::PaymentOverflow)?;
    skill_listing.total_author_revenue_usdc_micros = skill_listing
        .total_author_revenue_usdc_micros
        .checked_add(author_share_usdc_micros)
        .ok_or(SettleX402PurchaseError::PaymentOverflow)?;
    skill_listing.total_voucher_revenue_usdc_micros = skill_listing
        .total_voucher_revenue_usdc_micros
        .checked_add(voucher_pool_usdc_micros)
        .ok_or(SettleX402PurchaseError::PaymentOverflow)?;

    let author_profile = &mut ctx.accounts.author_profile;
    if voucher_pool_usdc_micros > 0 {
        author_profile.reward_index_usdc_micros_x1e12 = author_profile
            .reward_index_usdc_micros_x1e12
            .checked_add(index_delta)
            .ok_or(SettleX402PurchaseError::RewardIndexOverflow)?;
        author_profile.unclaimed_voucher_revenue_usdc_micros = author_profile
            .unclaimed_voucher_revenue_usdc_micros
            .checked_add(voucher_pool_usdc_micros)
            .ok_or(SettleX402PurchaseError::PaymentOverflow)?;
    }

    let listing_settlement = &mut ctx.accounts.listing_settlement;
    listing_settlement.total_purchases = listing_settlement
        .total_purchases
        .checked_add(1)
        .ok_or(SettleX402PurchaseError::PaymentOverflow)?;
    listing_settlement.total_purchase_usdc_micros = listing_settlement
        .total_purchase_usdc_micros
        .checked_add(price_usdc_micros)
        .ok_or(SettleX402PurchaseError::PaymentOverflow)?;
    listing_settlement.total_author_proceeds_usdc_micros = listing_settlement
        .total_author_proceeds_usdc_micros
        .checked_add(author_share_usdc_micros)
        .ok_or(SettleX402PurchaseError::PaymentOverflow)?;
    listing_settlement.withdrawable_author_proceeds_usdc_micros = listing_settlement
        .withdrawable_author_proceeds_usdc_micros
        .checked_add(author_share_usdc_micros)
        .ok_or(SettleX402PurchaseError::PaymentOverflow)?;
    listing_settlement.updated_at = clock.unix_timestamp;

    let purchase = &mut ctx.accounts.purchase;
    purchase.buyer = buyer;
    purchase.skill_listing = skill_listing_key;
    purchase.purchased_at = clock.unix_timestamp;
    purchase.listing_revision = ctx.accounts.skill_listing.current_revision;
    purchase.listing_settlement = ctx.accounts.listing_settlement.key();
    purchase.price_paid_usdc_micros = price_usdc_micros;
    purchase.author_share_usdc_micros = author_share_usdc_micros;
    purchase.voucher_pool_usdc_micros = voucher_pool_usdc_micros;
    purchase.usdc_mint = ctx.accounts.usdc_mint.key();
    purchase.bump = ctx.bumps.purchase;

    let receipt = &mut ctx.accounts.x402_settlement_receipt;
    receipt.payment_ref_hash = payment_ref_hash;
    receipt.settlement_tx_signature_hash = settlement_tx_signature_hash;
    receipt.buyer = buyer;
    receipt.skill_listing = skill_listing_key;
    receipt.purchase = ctx.accounts.purchase.key();
    receipt.listing_revision = ctx.accounts.skill_listing.current_revision;
    receipt.listing_settlement = ctx.accounts.listing_settlement.key();
    receipt.amount_usdc_micros = amount_usdc_micros;
    receipt.author_share_usdc_micros = author_share_usdc_micros;
    receipt.voucher_pool_usdc_micros = voucher_pool_usdc_micros;
    receipt.settled_at = clock.unix_timestamp;
    receipt.bump = ctx.bumps.x402_settlement_receipt;

    let signature_guard = &mut ctx.accounts.x402_settlement_signature_guard;
    signature_guard.settlement_tx_signature_hash = settlement_tx_signature_hash;
    signature_guard.receipt = ctx.accounts.x402_settlement_receipt.key();
    signature_guard.bump = ctx.bumps.x402_settlement_signature_guard;

    emit!(X402PurchaseSettled {
        receipt: ctx.accounts.x402_settlement_receipt.key(),
        signature_guard: ctx.accounts.x402_settlement_signature_guard.key(),
        purchase: ctx.accounts.purchase.key(),
        skill_listing: skill_listing_key,
        buyer,
        payment_ref_hash,
        settlement_tx_signature_hash,
        price_usdc_micros,
        author_share_usdc_micros,
        voucher_pool_usdc_micros,
        listing_revision: ctx.accounts.skill_listing.current_revision,
        listing_settlement: ctx.accounts.listing_settlement.key(),
        x402_settlement_vault: ctx.accounts.x402_settlement_vault.key(),
        author_proceeds_vault: ctx.accounts.author_proceeds_vault.key(),
        reward_vault: ctx.accounts.author_reward_vault.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

#[error_code]
pub enum SettleX402PurchaseError {
    #[msg("Skill is not active")]
    SkillNotActive,
    #[msg("Invalid author")]
    InvalidAuthor,
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("Free skills do not require purchase")]
    FreeSkillNotPurchased,
    #[msg("x402 settlement amount must match the listing price")]
    InvalidSettlementAmount,
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
    #[msg("Listing settlement account does not match the active listing revision")]
    SettlementMismatch,
    #[msg("Author proceeds vault does not match settlement state")]
    AuthorProceedsVaultMismatch,
    #[msg("x402 settlement vault does not match config")]
    X402SettlementVaultMismatch,
    #[msg("x402 settlement authority does not match config")]
    InvalidSettlementAuthority,
    #[msg("Author proceeds settlement is locked by an open dispute")]
    SettlementLocked,
    #[msg("Payment reference hash cannot be all zeros")]
    InvalidPaymentRefHash,
    #[msg("Settlement transaction signature hash cannot be all zeros")]
    InvalidSettlementSignatureHash,
}
