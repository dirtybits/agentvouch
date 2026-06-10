use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::events::AuthorDisputeOpened as AuthorDisputeOpenedEvent;
use crate::state::{
    AgentProfile, AuthorDispute, AuthorDisputeLiabilityScope, AuthorDisputeReason,
    AuthorDisputeStatus, ListingSettlement, Purchase, ReputationConfig, SkillListing,
};

#[derive(Accounts)]
#[instruction(dispute_id: u64)]
pub struct OpenAuthorDispute<'info> {
    #[account(
        init,
        payer = challenger,
        space = AuthorDispute::LEN,
        seeds = [b"author_dispute", author_profile.authority.as_ref(), &dispute_id.to_le_bytes()],
        bump
    )]
    pub author_dispute: Box<Account<'info, AuthorDispute>>,

    #[account(
        mut,
        seeds = [b"agent", author_profile.authority.as_ref()],
        bump = author_profile.bump
    )]
    pub author_profile: Box<Account<'info, AgentProfile>>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ReputationConfig>>,

    #[account(mut)]
    pub skill_listing: Box<Account<'info, SkillListing>>,

    pub purchase: Option<Box<Account<'info, Purchase>>>,

    #[account(mut)]
    pub listing_settlement: Option<Box<Account<'info, ListingSettlement>>>,

    #[account(address = config.usdc_mint @ ErrorCode::InvalidUsdcMint)]
    pub usdc_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        constraint = challenger_usdc_account.mint == config.usdc_mint @ ErrorCode::InvalidTokenMint,
        constraint = challenger_usdc_account.owner == challenger.key() @ ErrorCode::InvalidTokenOwner
    )]
    pub challenger_usdc_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: PDA authority for the dispute bond vault.
    #[account(
        seeds = [
            b"dispute_bond_vault_authority",
            author_profile.authority.as_ref(),
            &dispute_id.to_le_bytes()
        ],
        bump
    )]
    pub dispute_bond_vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = challenger,
        token::mint = usdc_mint,
        token::authority = dispute_bond_vault_authority,
        token::token_program = token_program,
        seeds = [
            b"dispute_bond_vault",
            author_profile.authority.as_ref(),
            &dispute_id.to_le_bytes()
        ],
        bump
    )]
    pub dispute_bond_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub challenger: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, OpenAuthorDispute<'info>>,
    dispute_id: u64,
    reason: AuthorDisputeReason,
    evidence_uri: String,
) -> Result<()> {
    require!(!ctx.accounts.config.paused, ErrorCode::ProtocolPaused);
    require!(
        evidence_uri.len() <= AuthorDispute::MAX_EVIDENCE_URI_LENGTH,
        ErrorCode::EvidenceUriTooLong
    );

    let author = ctx.accounts.author_profile.authority;
    require!(
        ctx.accounts.skill_listing.author == author,
        ErrorCode::SkillListingAuthorMismatch
    );

    if let Some(purchase) = &ctx.accounts.purchase {
        require!(
            purchase.skill_listing == ctx.accounts.skill_listing.key(),
            ErrorCode::PurchaseSkillMismatch
        );
        require!(
            purchase.listing_revision == ctx.accounts.skill_listing.current_revision,
            ErrorCode::PurchaseRevisionMismatch
        );
    }

    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.challenger_usdc_account.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.dispute_bond_vault.to_account_info(),
                authority: ctx.accounts.challenger.to_account_info(),
            },
        ),
        ctx.accounts.config.dispute_bond_usdc_micros,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let clock = Clock::get()?;
    let skill_listing = ctx.accounts.skill_listing.key();
    let skill_price_usdc_micros_snapshot = ctx.accounts.skill_listing.price_usdc_micros;
    let liability_scope = if SkillListing::is_free_price(skill_price_usdc_micros_snapshot) {
        AuthorDisputeLiabilityScope::AuthorBondOnly
    } else {
        AuthorDisputeLiabilityScope::AuthorBondThenVouchers
    };
    if liability_scope == AuthorDisputeLiabilityScope::AuthorBondThenVouchers {
        let settlement = ctx
            .accounts
            .listing_settlement
            .as_deref_mut()
            .ok_or(ErrorCode::MissingListingSettlement)?;
        require!(
            settlement.skill_listing == skill_listing,
            ErrorCode::ListingSettlementMismatch
        );
        require!(
            settlement.revision == ctx.accounts.skill_listing.current_revision,
            ErrorCode::ListingSettlementMismatch
        );
        require!(
            settlement.locked_by_dispute.is_none(),
            ErrorCode::ListingSettlementAlreadyLocked
        );
        // Listing-level mirror of the settlement lock: survives settlement
        // rotation, freezes slash-set membership (link/unlink), revision
        // bumps, and new-settlement init until the dispute fully settles.
        require!(
            !ctx.accounts.skill_listing.is_dispute_locked(),
            ErrorCode::ListingSettlementAlreadyLocked
        );
        settlement.locked_by_dispute = Some(ctx.accounts.author_dispute.key());
        settlement.updated_at = clock.unix_timestamp;
        ctx.accounts.skill_listing.locked_by_dispute = Some(ctx.accounts.author_dispute.key());
        ctx.accounts.skill_listing.updated_at = clock.unix_timestamp;
    }
    let purchase = ctx.accounts.purchase.as_ref().map(|account| account.key());

    let author_dispute = &mut ctx.accounts.author_dispute;
    author_dispute.dispute_id = dispute_id;
    author_dispute.author = author;
    author_dispute.challenger = ctx.accounts.challenger.key();
    author_dispute.dispute_bond_vault = ctx.accounts.dispute_bond_vault.key();
    author_dispute.rent_payer = ctx.accounts.challenger.key();
    author_dispute.reason = reason;
    author_dispute.evidence_uri = evidence_uri;
    author_dispute.status = AuthorDisputeStatus::Open;
    author_dispute.ruling = None;
    author_dispute.liability_scope = liability_scope;
    author_dispute.skill_listing = skill_listing;
    author_dispute.skill_price_usdc_micros_snapshot = skill_price_usdc_micros_snapshot;
    author_dispute.purchase = purchase;
    author_dispute.backing_vouch_count_snapshot =
        ctx.accounts.author_profile.total_vouches_received;
    author_dispute.linked_vouch_count = 0;
    author_dispute.processed_vouch_count = 0;
    author_dispute.author_bond_slashed_usdc_micros = 0;
    author_dispute.voucher_slashed_usdc_micros = 0;
    author_dispute.bond_amount_usdc_micros = ctx.accounts.config.dispute_bond_usdc_micros;
    author_dispute.created_at = clock.unix_timestamp;
    author_dispute.resolved_at = None;
    author_dispute.bump = ctx.bumps.author_dispute;
    author_dispute.dispute_bond_vault_bump = ctx.bumps.dispute_bond_vault;

    ctx.accounts.author_profile.open_author_disputes = ctx
        .accounts
        .author_profile
        .open_author_disputes
        .checked_add(1)
        .ok_or(ErrorCode::OpenAuthorDisputeCountOverflow)?;

    emit!(AuthorDisputeOpenedEvent {
        author_dispute: author_dispute.key(),
        author,
        challenger: ctx.accounts.challenger.key(),
        reason: reason_label(reason).to_string(),
        liability_scope: liability_scope_label(liability_scope).to_string(),
        skill_listing,
        skill_price_usdc_micros_snapshot,
        purchase,
        linked_vouch_count: 0,
        bond_amount_usdc_micros: ctx.accounts.config.dispute_bond_usdc_micros,
        dispute_bond_vault: ctx.accounts.dispute_bond_vault.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

fn reason_label(reason: AuthorDisputeReason) -> &'static str {
    match reason {
        AuthorDisputeReason::MaliciousSkill => "MaliciousSkill",
        AuthorDisputeReason::FraudulentClaims => "FraudulentClaims",
        AuthorDisputeReason::FailedDelivery => "FailedDelivery",
        AuthorDisputeReason::Other => "Other",
    }
}

fn liability_scope_label(liability_scope: AuthorDisputeLiabilityScope) -> &'static str {
    match liability_scope {
        AuthorDisputeLiabilityScope::AuthorBondOnly => "AuthorBondOnly",
        AuthorDisputeLiabilityScope::AuthorBondThenVouchers => "AuthorBondThenVouchers",
    }
}

#[error_code]
pub enum ErrorCode {
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("Evidence URI is too long")]
    EvidenceUriTooLong,
    #[msg("The provided skill listing does not belong to the disputed author")]
    SkillListingAuthorMismatch,
    #[msg("Provided purchase does not match the disputed skill listing")]
    PurchaseSkillMismatch,
    #[msg("Provided purchase does not match the disputed listing revision")]
    PurchaseRevisionMismatch,
    #[msg("Paid disputes require the listing settlement account")]
    MissingListingSettlement,
    #[msg("Listing settlement does not match the disputed listing")]
    ListingSettlementMismatch,
    #[msg("Listing settlement is already locked by a dispute")]
    ListingSettlementAlreadyLocked,
    #[msg("Open author dispute count overflowed")]
    OpenAuthorDisputeCountOverflow,
    #[msg("USDC mint does not match config")]
    InvalidUsdcMint,
    #[msg("Token account mint does not match config")]
    InvalidTokenMint,
    #[msg("Token account owner is invalid")]
    InvalidTokenOwner,
}
