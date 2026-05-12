use crate::state::AgentProfile;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct RegisterAgent<'info> {
    #[account(
        init_if_needed,
        payer = authority,
        space = AgentProfile::LEN,
        seeds = [b"agent", authority.key().as_ref()],
        bump
    )]
    pub agent_profile: Account<'info, AgentProfile>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RegisterAgent>, metadata_uri: String) -> Result<()> {
    require!(
        metadata_uri.len() <= AgentProfile::MAX_URI_LENGTH,
        ErrorCode::MetadataUriTooLong
    );

    let agent_profile = &mut ctx.accounts.agent_profile;
    let clock = Clock::get()?;

    // Preserve existing on-chain stats when re-registering (only update mutable fields)
    let is_new = agent_profile.registered_at == 0;
    agent_profile.authority = ctx.accounts.authority.key();
    agent_profile.metadata_uri = metadata_uri;
    if is_new {
        agent_profile.reputation_score = 0;
        agent_profile.total_vouches_received = 0;
        agent_profile.total_vouches_given = 0;
        agent_profile.total_vouch_stake_usdc_micros = 0;
        agent_profile.author_bond_usdc_micros = 0;
        agent_profile.active_free_skill_listings = 0;
        agent_profile.open_author_disputes = 0;
        agent_profile.upheld_author_disputes = 0;
        agent_profile.dismissed_author_disputes = 0;
        agent_profile.reward_vault = Pubkey::default();
        agent_profile.reward_vault_rent_payer = Pubkey::default();
        agent_profile.reward_index_usdc_micros_x1e12 = 0;
        agent_profile.unclaimed_voucher_revenue_usdc_micros = 0;
        agent_profile.registered_at = clock.unix_timestamp;
    }
    agent_profile.bump = ctx.bumps.agent_profile;
    if is_new {
        agent_profile.reward_vault_bump = 0;
    }

    Ok(())
}

#[error_code]
pub enum ErrorCode {
    #[msg("Metadata URI is too long")]
    MetadataUriTooLong,
}
