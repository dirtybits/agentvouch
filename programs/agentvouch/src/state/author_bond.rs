use anchor_lang::prelude::*;

pub const AUTHOR_BOND_SEED: &[u8] = b"author_bond";

#[account]
pub struct AuthorBond {
    pub author: Pubkey,
    pub vault: Pubkey,
    pub rent_payer: Pubkey,
    pub amount_usdc_micros: u64,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl AuthorBond {
    pub const LEN: usize = 8 + // discriminator
        32 + // author
        32 + // vault
        32 + // rent_payer
        8 + // amount_usdc_micros
        8 + // created_at
        8 + // updated_at
        1 + // bump
        1; // vault_bump

    pub fn is_uninitialized(&self) -> bool {
        self.author == Pubkey::default()
    }
}

pub fn find_author_bond_pda(author: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[AUTHOR_BOND_SEED, author.as_ref()], program_id)
}
