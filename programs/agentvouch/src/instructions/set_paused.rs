use anchor_lang::prelude::*;

use crate::events::PauseStateChanged;
use crate::state::ReputationConfig;

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Box<Account<'info, ReputationConfig>>,

    pub pause_authority: Signer<'info>,
}

pub fn handler(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.config.pause_authority,
        ctx.accounts.pause_authority.key(),
        ErrorCode::PauseAuthorityMismatch
    );

    let config = &mut ctx.accounts.config;
    config.paused = paused;

    emit!(PauseStateChanged {
        config: config.key(),
        pause_authority: ctx.accounts.pause_authority.key(),
        paused,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[error_code]
pub enum ErrorCode {
    #[msg("Pause authority mismatch")]
    PauseAuthorityMismatch,
}
