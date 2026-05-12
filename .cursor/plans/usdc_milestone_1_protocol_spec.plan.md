---
name: Milestone 1 - v0.2.0 Protocol Spec
overview: "Define the v0.2.0 USDC-native protocol spec before implementation: accounts, PDA seeds, vault ownership, x402 settlement, economics, reputation, rewards, authorities, events, and DB/indexer implications."
todos:
  - id: create-m1-plan
    content: Create the Milestone 1 working plan/spec file
    status: completed
  - id: inventory-v01-protocol
    content: Map v0.1.0 accounts, instructions, PDA seeds, and lamport fields to v0.2.0 replacements
    status: completed
  - id: draft-v02-account-model
    content: Draft v0.2.0 account, PDA, and vault ownership model
    status: completed
  - id: define-instruction-contracts
    content: Define v0.2.0 instruction contracts, token constraints, signers, and events
    status: completed
  - id: resolve-economics-reputation
    content: Specify economic floors, reputation formula, reward index, and dispute liability
    status: completed
  - id: resolve-x402-bridge-spec
    content: Specify x402 settlement bridge POC requirements and fallback gating
    status: completed
  - id: define-authorities-indexing
    content: Specify authority roles, governance controls, ERC-8004 linkage, DB/indexer implications
    status: completed
  - id: verify-m1-spec
    content: Run spec verification checklist and summarize blockers before Milestone 2/3
    status: completed
isProject: false
---

# Milestone 1 - v0.2.0 Protocol Spec

## Goal

Define the USDC-native account and instruction model before coding. This spec is implementation guidance for the fresh `v0.2.0` program. It uses the existing `v0.1.0` program as scaffolding, but does not preserve SOL-denominated account layouts or purchase semantics.

## Source Of Truth

- Durable roadmap: `docs/USDC_NATIVE_MIGRATION.md`
- Working spec: this file
- Current program scaffolding: `programs/reputation-oracle/src`
- Current x402 and entitlement scaffolding: `web/lib/x402.ts`, `web/lib/usdcPurchases.ts`, `web/lib/db.ts`, `web/app/api/skills/[id]/raw/route.ts`

Update `docs/USDC_NATIVE_MIGRATION.md` only when a durable roadmap decision changes. Keep implementation TODOs in milestone plans.

## Non-Goals

- Do not preserve `v0.1.0` account layout compatibility.
- Do not add a price-feed oracle.
- Do not support arbitrary collateral assets in the core program.
- Do not support bridged USDC or Token-2022 as protocol collateral in `v0.2.0`.
- Do not make x402 primary for protocol-listed paid skills until the bridge POC passes.
- Do not solve mainnet launch governance beyond specifying required roles and multisig posture.

## v0.1.0 Inventory

### Instructions

Current exported instructions:

- `initialize_config`, `migrate_config`
- `register_agent`, `migrate_agent`, `admin_migrate_agent`, `repair_agent_registered_at`
- `deposit_author_bond`, `withdraw_author_bond`
- `vouch`, `revoke_vouch`
- `create_skill_listing`, `update_skill_listing`, `remove_skill_listing`, `close_skill_listing`
- `purchase_skill`, `claim_voucher_revenue`
- `open_author_dispute`, `resolve_author_dispute`

`v0.2.0` removes old migration/repair instructions unless a new USDC-native repair path is explicitly needed. Legacy data is disposable devnet scaffolding.

### Current PDA Seeds

- `config`: `[b"config"]`
- `agent`: `[b"agent", authority]`
- `skill`: `[b"skill", author, skill_id.as_bytes()]`
- `purchase`: `[b"purchase", buyer, skill_listing]`
- `vouch`: `[b"vouch", voucher_profile, vouchee_profile]`
- `author_bond`: `[b"author_bond", author]`
- `author_dispute`: `[b"author_dispute", author, dispute_id.to_le_bytes()]`
- `author_dispute_vouch_link`: `[b"author_dispute_vouch_link", author_dispute, vouch]`

### Lamport Fields To Replace

| v0.1.0 field | v0.2.0 replacement |
| --- | --- |
| `ReputationConfig.min_stake` | `min_vouch_stake_usdc_micros` |
| `ReputationConfig.dispute_bond` | `dispute_bond_usdc_micros` |
| `ReputationConfig.min_author_bond_for_free_listing` | `min_author_bond_for_free_listing_usdc_micros` |
| `AgentProfile.total_staked_for` | `total_vouch_stake_usdc_micros` |
| `AgentProfile.author_bond_lamports` | `author_bond_usdc_micros` |
| `AuthorBond.amount` | `amount_usdc_micros` |
| `Vouch.stake_amount` | `stake_usdc_micros` |
| `Vouch.cumulative_revenue` | `cumulative_revenue_usdc_micros` |
| `SkillListing.price_lamports` | `price_usdc_micros` |
| `SkillListing.total_revenue` | `total_revenue_usdc_micros` |
| `SkillListing.unclaimed_voucher_revenue` | reward-index accounting plus listing reward vault balance |
| `Purchase.price_paid` | `price_paid_usdc_micros` |
| `AuthorDispute.skill_price_lamports_snapshot` | `skill_price_usdc_micros_snapshot` |
| `AuthorDispute.bond_amount` | `bond_amount_usdc_micros` |

Lamports remain relevant only for transaction fees and rent.

## v0.2.0 Constants And Defaults

### Token And Chain Constants

- Amount unit: micro-USDC (`1 USDC = 1_000_000`).
- Protocol collateral token: configured native Circle USDC mint.
- Token program: classic SPL Token only (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`).
- Devnet USDC mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
- Mainnet-beta USDC mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.
- Chain context: CAIP-2 string stored in DB/indexer outputs and emitted in events where feasible.
- Program cannot derive genesis hash on-chain, so `ReputationConfig.chain_context` may store a bounded string or compact enum if space pressure requires it. Indexers must still publish CAIP-2.

### Economic Defaults

Use these `v0.2.0` devnet defaults unless the Milestone 1 review explicitly changes them:

- Minimum paid listing price: `10_000` micros (`0.01 USDC`).
- Minimum vouch stake: `1_000_000` micros (`1 USDC`).
- Minimum author bond for free listings: `1_000_000` micros (`1 USDC`).
- Dispute bond: `500_000` micros (`0.5 USDC`).
- Purchase split: `60%` author, `40%` voucher reward pool.
- Protocol fee: `0%` in `v0.2.0`; keep config fields/reserved layout room for a future explicit fee.
- Slash percentage: configurable `u8`, default `50`.
- Cooldown and dispute holds: carry forward from v0.1.0 unless explicitly changed during implementation.

### Paid Listing Backing Rule

For protocol-listed paid skills, `purchase_skill` requires positive active voucher stake at purchase time. This prevents the `40%` voucher pool from becoming unallocated revenue and reinforces AgentVouch's trust-backed marketplace design.

If the product later wants paid protocol listings with no voucher backing, define a separate unallocated-revenue policy before Milestone 3. Do not silently let late vouches earn prior revenue.

### Compute And Account Ceilings

- User-facing transactions must fit a `64` static-account planning ceiling without requiring Address Lookup Tables.
- `MAX_ACTIVE_REWARD_POSITIONS_PER_LISTING = 32`.
- `MAX_DISPUTE_POSITIONS_PER_TX = 8`.
- Paid-listing dispute exposure is listing-scoped: link and settle `ListingVouchPosition` accounts for the disputed listing, not every author-wide vouch.
- Upheld paid-listing disputes use batched settlement when linked positions exceed `MAX_DISPUTE_POSITIONS_PER_TX`. The dispute state must track progress across chunks before finalization.
- Dismissed disputes use a fixed-account path.
- Fixed-account flows: direct purchase, voucher claim, link/unlink, revoke, author-bond deposit/withdraw, listing create/remove/close.
- Compute targets before devnet cutover: direct purchase below `250_000` CU, voucher claim below `200_000` CU, link/unlink/revoke below `250_000` CU each, open dispute and dismissed dispute resolution below `300_000` CU, dispute link batch of 8 positions below `500_000` CU, upheld voucher settlement batch of 8 positions below `1_200_000` CU, and future `settle_x402_purchase` below `350_000` CU when implemented.
- If measured compute exceeds targets, reduce batch size rather than depending on larger transactions.

## Account Model

### Vault Lifecycle Policy

- Protocol-owned USDC vaults use explicit token-account PDAs, not ATAs.
- Recipient accounts for user-facing payouts are canonical ATAs and must already exist; clients create them idempotently before submitting transactions.
- Program vault rent payer is fixed by primitive: author for author-bond and listing-reward vaults, voucher for vouch-stake vaults, challenger for dispute-bond vaults, and config initializer for treasury/settlement vaults.
- Rent refunds return to the original primitive rent payer on normal close or force/final close. Slashing never confiscates SOL rent.
- Close/sweep instructions must preserve dispute locks and voucher claim ownership.
- Residual listing reward vault USDC that is not assigned to a claimable voucher position can be swept to the protocol treasury vault only after all claimable rewards are resolved.
- Lost-wallet recovery is not supported in `v0.2.0`; funds stay controlled by the original authority and normal claim/revoke/withdraw/close invariants.

### `ReputationConfig`

PDA: `[b"config"]`

Fields:

- `authority: Pubkey`
- `config_authority: Pubkey`
- `treasury_authority: Pubkey`
- `settlement_authority: Pubkey`
- `pause_authority: Pubkey`
- `usdc_mint: Pubkey`
- `token_program: Pubkey`
- `protocol_treasury_vault: Pubkey`
- `x402_settlement_vault: Pubkey`
- `chain_context: String` bounded to CAIP-2 length, or fixed bytes if implementation chooses compact storage
- `min_vouch_stake_usdc_micros: u64`
- `dispute_bond_usdc_micros: u64`
- `min_author_bond_for_free_listing_usdc_micros: u64`
- `min_paid_listing_price_usdc_micros: u64`
- `author_share_bps: u16` default `6000`
- `voucher_share_bps: u16` default `4000`
- `protocol_fee_bps: u16` default `0`
- `slash_percentage: u8`
- `cooldown_period: i64`
- `stake_weight_per_usdc: u32`
- `vouch_weight: u32`
- `longevity_bonus_per_day: u32`
- `reputation_score_cap: u64`
- `paused: bool`
- `bump: u8`

Invariants:

- `author_share_bps + voucher_share_bps + protocol_fee_bps == 10_000`.
- `token_program` must equal classic SPL Token.
- `usdc_mint` must be the native Circle USDC mint for the cluster.
- Paused config blocks money-moving write instructions except authority rotation, settlement repair/refund paths, and safe claim/withdraw paths explicitly allowed by implementation.

### `AgentProfile`

PDA: `[b"agent", authority]`

Fields:

- `authority: Pubkey`
- `metadata_uri: String`
- optional `agent_registry: String`
- optional `agent_id: String`
- optional `agent_uri: String`
- `reputation_score: u64`
- `total_vouches_received: u32`
- `total_vouches_given: u32`
- `total_vouch_stake_usdc_micros: u64`
- `author_bond_usdc_micros: u64`
- `active_free_skill_listings: u32`
- `open_author_disputes: u32`
- `upheld_author_disputes: u32`
- `dismissed_author_disputes: u32`
- `registered_at: i64`
- `bump: u8`

Notes:

- `registered_at` must be initialized from `Clock::get()` and validated as plausible in any future migration/repair path.
- Author wallet rotation is not supported in `v0.2.0` by default. Listings remain bound to the original author authority unless a future author-signed migration instruction is specified.

### `AuthorBond`

Data PDA: `[b"author_bond", author]`

Vault token account PDA seeds:

- vault authority: `[b"author_bond_vault_authority", author]`
- vault token account: explicit token-account PDA, not an ATA

Fields:

- `author: Pubkey`
- `vault: Pubkey`
- `amount_usdc_micros: u64`
- `created_at: i64`
- `updated_at: i64`
- `bump: u8`
- `vault_authority_bump: u8`

Rules:

- Deposits transfer from author USDC ATA to the author-bond vault.
- Withdrawals fail while `AgentProfile.open_author_disputes > 0`.
- Free listings freeze if the bond falls below `min_author_bond_for_free_listing_usdc_micros`.
- Vault closes only after amount is zero and no dispute can reach it.

### `Vouch`

PDA: `[b"vouch", voucher_profile, vouchee_profile]`

Vault authority seeds:

- `[b"vouch_vault_authority", vouch]`

Vault token account:

- explicit token-account PDA, not an ATA

Fields:

- `voucher: Pubkey` (voucher profile PDA)
- `vouchee: Pubkey` (author profile PDA)
- `voucher_authority: Pubkey`
- `vouchee_authority: Pubkey`
- `vault: Pubkey`
- `stake_usdc_micros: u64`
- `created_at: i64`
- `updated_at: i64`
- `status: VouchStatus`
- `linked_listing_count: u32`
- `cumulative_revenue_usdc_micros: u64`
- `last_payout_at: i64`
- `bump: u8`
- `vault_authority_bump: u8`

Rules:

- Vouches require `stake_usdc_micros >= min_vouch_stake_usdc_micros`.
- Self-vouch remains forbidden.
- Vouches are author-wide trust capital. They do not earn listing revenue until linked to a specific `SkillListing` through `ListingVouchPosition`.
- Revoke fails while the vouchee has active disputes that can slash this vouch.
- Revoke fails while `linked_listing_count > 0`; voucher must unlink listing positions and claim/preserve rewards first.
- Revoke returns remaining stake to voucher canonical USDC ATA and preserves already accrued claim rights in linked positions unless the spec later defines forfeiture.
- Partial slashes reduce future reward weight in proportion to remaining active stake.

### `SkillListing`

PDA: `[b"skill", author, skill_id.as_bytes()]`

Reward vault authority seeds:

- `[b"listing_reward_vault_authority", skill_listing]`

Reward vault token account:

- explicit token-account PDA, not an ATA

Fields:

- `author: Pubkey`
- `author_profile: Pubkey`
- `skill_id: String`
- `skill_uri: String`
- `name: String`
- `description: String`
- `price_usdc_micros: u64`
- `reward_vault: Pubkey`
- `total_downloads: u64`
- `total_revenue_usdc_micros: u64`
- `total_author_revenue_usdc_micros: u64`
- `total_voucher_revenue_usdc_micros: u64`
- `active_reward_stake_usdc_micros: u64`
- `active_reward_position_count: u32`
- `reward_index_usdc_micros_x1e12: u128`
- `unclaimed_voucher_revenue_usdc_micros: u64`
- `created_at: i64`
- `updated_at: i64`
- `status: SkillStatus`
- optional `agent_registry: String`
- optional `agent_id: String`
- `bump: u8`
- `reward_vault_authority_bump: u8`

Rules:

- `price_usdc_micros == 0` means free listing.
- Paid listing price must be at least `min_paid_listing_price_usdc_micros`.
- Free listings require author bond at or above `min_author_bond_for_free_listing_usdc_micros`.
- Paid purchases require active voucher stake greater than zero.
- Removal freezes new purchases/downloads that depend on protocol trust, but claimable voucher rewards remain claimable until emptied.

### `ListingVouchPosition`

PDA: `[b"listing_vouch_position", skill_listing, vouch]`

Purpose: link an author-wide vouch to a specific listing for voucher revenue and dispute exposure.

Fields:

- `skill_listing: Pubkey`
- `vouch: Pubkey`
- `voucher_profile: Pubkey`
- `author_profile: Pubkey`
- `reward_stake_usdc_micros: u64`
- `entry_reward_index_x1e12: u128`
- `pending_rewards_usdc_micros: u64`
- `cumulative_revenue_usdc_micros: u64`
- `status: ListingVouchPositionStatus` (`Active`, `Unlinked`, `Slashed`)
- `created_at: i64`
- `updated_at: i64`
- `bump: u8`

Rules:

- A voucher must create this position before earning revenue from a listing.
- The position starts at the listing's current reward index so it cannot earn prior revenue.
- `SkillListing.active_reward_stake_usdc_micros` sums active listing vouch positions, not all author-wide vouches.
- `purchase_skill` distributes the voucher pool across active `ListingVouchPosition` stake for that listing.
- Paid listing purchases require `active_reward_stake_usdc_micros > 0`.
- Links fail if `active_reward_position_count >= MAX_ACTIVE_REWARD_POSITIONS_PER_LISTING`.
- Unlinking a position first accrues rewards into `pending_rewards_usdc_micros`, reduces listing active reward stake, and decrements `Vouch.linked_listing_count`.
- Disputes for a paid listing can slash linked positions and the underlying vouch stake.

### `Purchase`

PDA: `[b"purchase", buyer, skill_listing]`

Fields:

- `buyer: Pubkey`
- `skill_listing: Pubkey`
- `purchased_at: i64`
- `price_paid_usdc_micros: u64`
- `payment_flow: PaymentFlow` (`DirectPurchase`, `X402Bridge`)
- optional `x402_settlement_receipt: Pubkey`
- `bump: u8`

Rules:

- One purchase PDA per buyer/listing.
- Re-purchase is rejected unless a future versioned purchase model is intentionally added.
- Entitlement identity in the DB remains `(skill_db_id, buyer_pubkey)`.

### `X402SettlementReceipt`

PDA options:

- Preferred: `[b"x402_settlement", payment_reference_hash]`
- Alternative if reference is not stable: `[b"x402_settlement", payment_tx_signature_hash]`

Fields:

- `payment_reference_hash: [u8; 32]`
- `payment_tx_signature: [u8; 64]` or bounded string if easier for API/indexer matching
- `buyer: Pubkey`
- `skill_listing: Pubkey`
- `purchase: Pubkey`
- `amount_usdc_micros: u64`
- `memo_hash: [u8; 32]`
- `settled_at: i64`
- `bump: u8`

Rules:

- Prevents duplicate settlement for the same x402 payment.
- Never authorizes arbitrary withdrawals from the settlement vault.
- Exists only for x402 bridge purchases.

### `AuthorDispute`

PDA: `[b"author_dispute", author, dispute_id.to_le_bytes()]`

Bond vault authority seeds:

- `[b"dispute_bond_vault_authority", author_dispute]`

Bond vault token account:

- explicit token-account PDA, not an ATA

Fields:

- `dispute_id: u64`
- `author: Pubkey`
- `challenger: Pubkey`
- `reason: AuthorDisputeReason`
- `evidence_uri: String`
- `status: AuthorDisputeStatus`
- `ruling: Option<AuthorDisputeRuling>`
- `liability_scope: AuthorDisputeLiabilityScope`
- `skill_listing: Pubkey`
- `skill_price_usdc_micros_snapshot: u64`
- `purchase: Option<Pubkey>`
- `backing_vouch_count_snapshot: u32`
- `linked_vouch_count: u32`
- `bond_amount_usdc_micros: u64`
- `author_bond_snapshot_usdc_micros: u64`
- `voucher_stake_snapshot_usdc_micros: u64`
- `created_at: i64`
- `resolved_at: Option<i64>`
- `bump: u8`
- `bond_vault_authority_bump: u8`

Rules:

- Free listings use `AuthorBondOnly`.
- Paid listings use `AuthorBondThenVouchers`.
- Upheld disputes pay challenger their dispute bond plus slashed funds.
- Dismissed disputes send challenger bond to protocol treasury vault.

### `AuthorDisputeVouchLink`

PDA: `[b"author_dispute_vouch_link", author_dispute, vouch]`

Fields:

- `author_dispute: Pubkey`
- `vouch: Pubkey`
- `stake_snapshot_usdc_micros: u64`
- `added_at: i64`
- `bump: u8`

Rules:

- Used to snapshot which vouches can be slashed by the dispute.
- Open/resolve flows link `ListingVouchPosition` accounts for the disputed listing, not every author-wide vouch.
- Linking and voucher settlement must process at most `MAX_DISPUTE_POSITIONS_PER_TX` positions per transaction. If the disputed listing has more linked positions, implementation must batch linking and/or settlement.

## Instruction Contracts

Every USDC-moving instruction validates:

- expected `config.usdc_mint`
- token account mint
- token account owner
- token program ID
- signer authority
- PDA vault address
- PDA authority seeds
- amount greater than zero
- arithmetic overflow/underflow using `u128` intermediate math where needed
- post-transfer state when logic depends on token deltas

### `initialize_config`

Purpose: initialize config and global treasury/settlement vault references.

Inputs:

- economic floors
- slash percentage
- cooldown
- reputation weights/caps
- authority pubkeys
- USDC mint and token program

Required accounts:

- config PDA
- initializer signer
- USDC mint
- protocol treasury vault
- x402 settlement vault
- system program
- token program

Rules:

- Validates token program is classic SPL Token.
- Validates bps split sums to `10_000`.
- Sets `paused = false`.

### `register_agent`

Purpose: create `AgentProfile`.

Inputs:

- `metadata_uri`
- optional `agent_registry`
- optional `agent_id`
- optional `agent_uri`

Rules:

- Initializes reputation fields to zero.
- Sets `registered_at` from clock.
- Does not require USDC.

### `deposit_author_bond`

Purpose: transfer USDC from author ATA into author bond vault.

Rules:

- Creates or updates `AuthorBond`.
- Increments `AgentProfile.author_bond_usdc_micros`.
- Recomputes reputation.
- Emits `AuthorBondDepositedV2`.

### `withdraw_author_bond`

Purpose: return author bond USDC to author canonical ATA.

Rules:

- Fails if open disputes can reach the bond.
- Fails if withdrawal would leave active free listings below the minimum bond.
- Recomputes reputation.

### `vouch`

Purpose: transfer voucher USDC into vouch stake vault.

Rules:

- Requires voucher and vouchee profiles.
- Forbids self-vouch.
- Requires minimum stake.
- Updates `AgentProfile.total_vouch_stake_usdc_micros`.
- Recomputes reputation.

### `link_vouch_to_listing`

Purpose: opt an author-wide vouch into revenue and dispute exposure for a specific listing.

Rules:

- Creates `ListingVouchPosition`.
- Requires active `Vouch`.
- Requires listing author matches vouchee profile.
- Sets `entry_reward_index_x1e12` to current listing reward index.
- Increments listing active reward stake and `Vouch.linked_listing_count`.

### `unlink_vouch_from_listing`

Purpose: stop earning future revenue from a listing and remove future listing-specific dispute exposure.

Rules:

- Accrues rewards to `pending_rewards_usdc_micros`.
- Decrements listing active reward stake and `Vouch.linked_listing_count`.
- Cannot unlink while an active dispute for that listing can slash the position.
- Claimable rewards remain claimable after unlink.

### `revoke_vouch`

Purpose: deactivate vouch and return remaining stake.

Rules:

- Fails while linked/open disputes can slash the vouch.
- Fails while `linked_listing_count > 0`.
- Preserves accrued rewards.
- Updates future reward weight to zero.
- Recomputes reputation.

### `create_skill_listing`

Purpose: create listing and reward vault.

Rules:

- Uses `skill_id` seed.
- `price_usdc_micros == 0` means free.
- Paid listings require price >= configured floor.
- Free listings require author bond floor.
- Sets reward vault and reward index.

### `update_skill_listing`

Purpose: update metadata and price.

Rules:

- Author authority signs.
- Same price and free-listing bond constraints as create.
- Does not reset reward index.

### `remove_skill_listing`

Purpose: freeze new purchases.

Rules:

- Sets status `Removed`.
- Keeps reward vault claimable.
- Does not close while claimable rewards exist.

### `close_skill_listing`

Purpose: close data/vault accounts only after safe empty state.

Rules:

- Requires no active purchases/disputes needing listing state.
- Requires `unclaimed_voucher_revenue_usdc_micros == 0`.
- Requires no voucher has claimable rewards.
- Returns rent to original rent payer when tracked; otherwise to close authority.

### `purchase_skill`

Purpose: direct protocol-visible paid purchase.

Flow:

1. Buyer pays full `price_usdc_micros` from buyer ATA.
2. Program transfers author share to author canonical USDC ATA.
3. Program transfers voucher share to listing reward vault.
4. Program updates listing totals and reward index.
5. Program creates `Purchase` PDA.

Rules:

- Canonical paid path.
- Requires active listing.
- Requires active voucher stake greater than zero for paid listings.
- Requires author canonical ATA exists and matches `(author, config.usdc_mint)`.
- Does not auto-create recipient ATAs.

### `settle_x402_purchase`

Purpose: split a verified x402 payment that already landed in the protocol settlement vault.

Rules:

- `settlement_authority` signs.
- Verifies payment reference uniqueness through `X402SettlementReceipt`.
- Verifies buyer, listing, price, mint, memo hash, settlement vault, and amount.
- Transfers author share from settlement vault to author canonical ATA.
- Transfers voucher share from settlement vault to listing reward vault.
- Creates normal `Purchase` PDA.
- Creates `X402SettlementReceipt`.
- Emits both purchase and x402 settlement events.

Fallback:

- If the bridge POC fails, do not enable x402 for protocol-listed paid skills. Require `purchase_skill`.
- Allowed x402 flows after failure are repo-only/off-chain paid skills and legacy entitlements explicitly marked as not protocol-visible.

### `claim_voucher_revenue`

Purpose: claim accrued voucher rewards from listing reward vault.

Rules:

- Uses reward index accounting so late vouches do not earn prior revenue.
- Requires the listing's `ListingVouchPosition` for the claiming vouch.
- Requires claimable amount > 0.
- Transfers from listing reward vault to voucher canonical USDC ATA.
- Updates position `pending_rewards_usdc_micros`, position `entry_reward_index_x1e12`, position cumulative revenue, and aggregate `Vouch.cumulative_revenue_usdc_micros`.

### `open_author_dispute`

Purpose: open dispute and escrow challenger bond.

Rules:

- Challenger transfers dispute bond USDC to dispute bond vault.
- Snapshots listing price, purchase if present, author bond, voucher stake, and linked vouches.
- Free listing liability: author bond first/only.
- Paid listing liability: author bond first, then linked vouchers.

### `resolve_author_dispute`

Purpose: resolve dispute and slash/route funds.

Rules:

- Resolver/config authority signs.
- Upheld: challenger receives dispute bond plus slashed funds.
- Dismissed: challenger bond goes to protocol treasury vault.
- Updates dispute counters, author profile, author bond, vouches, reputation, and vault balances.
- Dismissed disputes use a fixed-account path.
- Upheld paid-listing disputes use batched voucher settlement when linked positions exceed `MAX_DISPUTE_POSITIONS_PER_TX`; finalization is allowed only after all required positions are processed.

## Reward Index Model

Use a cumulative reward index per listing with explicit `ListingVouchPosition` accounts.

Definitions:

- `SCALE = 1_000_000_000_000`
- `reward_index_usdc_micros_x1e12: u128` on `SkillListing`
- `entry_reward_index_x1e12: u128` on `ListingVouchPosition`
- `pending_rewards_usdc_micros: u64` on `ListingVouchPosition`
- `active_reward_stake_usdc_micros: u64` on `SkillListing`

On purchase:

```text
voucher_pool = price_usdc_micros * voucher_share_bps / 10_000
index_delta = voucher_pool * SCALE / active_reward_stake_usdc_micros
listing.reward_index_usdc_micros_x1e12 += index_delta
listing.unclaimed_voucher_revenue_usdc_micros += voucher_pool
```

On position mutation:

```text
accrued = reward_stake_usdc_micros * (listing.reward_index_usdc_micros_x1e12 - entry_reward_index_x1e12) / SCALE
pending_rewards_usdc_micros += accrued
entry_reward_index_x1e12 = listing.reward_index_usdc_micros_x1e12
```

Implementation note:

- For `v0.2.0`, use listing-level reward vaults, listing-level reward indexes, and `ListingVouchPosition` PDAs.
- Do not fall back to pro-rata unclaimed pool math that lets late vouches earn prior revenue.
- Paid purchases require `active_reward_stake_usdc_micros > 0` and `index_delta > 0`.
- Use checked `u128` intermediate math; arithmetic overflow fails the instruction and reward accounting must not saturate.
- Link starts at the current listing reward index.
- Unlink, partial slash, full slash, claim, and any reward-stake/status mutation accrue pending rewards first.
- Already accrued pending rewards remain claimable after unlink, revoke, or slash unless a later explicit forfeiture rule is adopted.
- Listing removal freezes new purchases and links, but does not block reward claims.
- Listing close requires `unclaimed_voucher_revenue_usdc_micros == 0` and no claimable position rewards. Residual unassigned dust or accidental direct-transfer USDC may be swept to treasury only after all claim rights are resolved.
- Account growth is bounded by `MAX_ACTIVE_REWARD_POSITIONS_PER_LISTING`; dispute linking and voucher settlement are batched by `MAX_DISPUTE_POSITIONS_PER_TX`.

## Reputation Formula

Default devnet formula:

```text
usd_at_risk = (author_bond_usdc_micros + total_vouch_stake_usdc_micros) / 1_000_000
risk_component = min(usd_at_risk * stake_weight_per_usdc, risk_component_cap)
vouch_component = min(total_vouches_received * vouch_weight, vouch_component_cap)
longevity_component = min(age_days * longevity_bonus_per_day, longevity_component_cap)
dispute_penalty = upheld_author_disputes * upheld_dispute_penalty
score = saturating_sub(risk_component + vouch_component + longevity_component, dispute_penalty)
score = min(score, reputation_score_cap)
```

Recommended defaults:

- `stake_weight_per_usdc = 10`
- `risk_component_cap = 10_000_000`
- `vouch_weight = 10`
- `vouch_component_cap = 10_000`
- `longevity_bonus_per_day = 1`
- `longevity_component_cap = 3_650`
- `upheld_dispute_penalty = 1_000`
- `reputation_score_cap = 10_100_000`

Rationale:

- Reputation is calibrated to USD risk, not lamport units.
- A `10 USDC` vouch contributes visible but not overwhelming trust.
- Upheld disputes materially reduce score without requiring negative numbers.
- All math uses `u128` intermediates and saturating casts to `u64`.

## x402 Bridge POC Spec

Current `@x402/svm` exact flow is an SPL transfer. It does not call the Anchor purchase instruction by default.

POC pass criteria:

- x402 can pay the exact listing price into the selected protocol settlement vault pattern.
- The selected facilitator supports the settlement vault owner model, including PDA/off-curve owner if used.
- Memo/extension binds `protocol_version`, CAIP-2 chain context, program ID, listing PDA, database skill ID, buyer, amount, mint, and nonce/payment reference.
- Backend can reliably identify buyer as payment source, not facilitator fee payer.
- `settle_x402_purchase` can verify idempotency on-chain with `X402SettlementReceipt`.
- Retry path exists when x402 settles but `settle_x402_purchase` fails.
- Refund path exists for stuck settlement vault funds where a purchase cannot be created.
- Browser flow gates wallets that cannot support the partial-sign/sponsored path and routes them to direct `purchase_skill` or agent/API fallback.

Security limits:

- `settlement_authority` cannot change listing price, author, buyer, split, or mint.
- `settlement_authority` cannot withdraw arbitrary settlement vault balances.
- All settlements emit versioned audit events.

Fail policy:

- Protocol-listed paid skills require direct `purchase_skill`.
- `/api/x402/supported` advertises x402 only for repo-only/off-chain paid skills and legacy entitlements.
- x402 direct-to-author remains off-chain entitlement commerce only and does not affect protocol reputation or voucher rewards.

## Authority Model

Devnet `v0.2.0` may use controlled deployer/config keys for iteration.

BPF upgrade authority is separate from `ReputationConfig` fields and must be tracked in the deployment runbook.

Mainnet `v1.0.0` requirements:

- Upgrade authority: multisig or stronger governance.
- Config authority: multisig-controlled.
- Treasury authority: multisig-controlled.
- Settlement authority: rotatable and pausable by config authority.
- Pause authority: multisig or emergency authority with documented scope.

Role semantics:

- `config_authority` controls governance-sensitive config updates and role rotations.
- `treasury_authority` is reserved in `v0.2.0`; no arbitrary treasury-withdrawal instruction ships in Milestone 3.
- `settlement_authority` is reserved for the x402 bridge, cannot withdraw arbitrary settlement funds, and can be paused or rotated by `config_authority`.
- `pause_authority` can only toggle pause state and can be rotated by `config_authority` if separate.
- `paused = true` blocks new risk and purchases while allowing authority rotation, unpause, dispute open/resolve, reward claims, withdrawals, revokes, and close flows only when normal dispute and lock invariants already permit them.

Treasury policy:

- `v0.2.0` protocol fee is zero.
- Treasury receives dismissed dispute bonds and any explicitly governed future fees.
- Treasury withdrawals are not part of Milestone 3. Add them only in a later governance milestone if protocol fees or treasury operations become necessary.

## Toolchain And Generated Artifacts

Pinned Milestone 3 toolchain:

- Anchor CLI: `0.32.1`
- Solana CLI: `3.1.4`
- Rust/MSRV: `1.89.0`
- Node/npm: Node `24.1.0`, npm `11.12.1`
- `anchor-lang = 0.32.1`
- `anchor-spl = 0.32.1`

Generated artifact flow:

```bash
NO_DNA=1 anchor build
cp target/idl/agentvouch.json web/agentvouch.json
npm run generate:client
npm run build --workspace @agentvouch/web
```

Deploy artifact fallback:

```bash
env -u CARGO_TARGET_DIR cargo build-sbf --manifest-path programs/agentvouch/Cargo.toml
```

Rules:

- Use npm as the canonical workspace package manager and align `Anchor.toml` to npm during Milestone 3 implementation.
- Regenerate `target/idl/agentvouch.json`, `target/types/agentvouch.ts`, `target/deploy/agentvouch.so`, `web/agentvouch.json`, and `web/generated/agentvouch`; do not hand-edit generated outputs.

## ERC-8004 / Solana Agent Registry

Fields:

- `agent_registry`: registry contract/program reference or URI namespace.
- `agent_id`: registry-local agent identifier.
- `agent_uri`: optional external registration file URI.
- `registry_ref`: optional compact alternative if account layout pressure makes separate strings too expensive.

Rules:

- AgentVouch is not a competing identity primitive.
- AgentVouch emits economic reputation events that indexers can map to ERC-8004 Reputation/Validation surfaces.
- Events include enough keys for indexers: protocol version, program ID, chain context, author, voucher, buyer, listing, purchase, and registry linkage where present.

## DB And Indexer Implications

Skills table additions:

- `on_chain_protocol_version`
- `on_chain_program_id`
- unique index on `(chain_context, on_chain_program_id, on_chain_address)` where `on_chain_address IS NOT NULL`

Receipt/entitlement behavior:

- Direct `purchase_skill` signatures are submitted to an API endpoint for entitlement indexing.
- API verifies transaction, event, buyer, listing, price, mint, program ID, and CAIP-2 chain context before writing entitlement.
- Background reconciliation backfills missed direct purchases from v0.2.0 events.
- x402 bridge purchases write both on-chain `X402SettlementReceipt` and DB receipt/entitlement rows.
- Existing repo-only/off-chain x402 receipts remain append-only in `usdc_purchase_receipts`; current access remains keyed by `(skill_db_id, buyer_pubkey)`.

Known schema caveat:

- `initializeDatabase()` and `ensureUsdcPurchaseSchema()` currently disagree about the old receipts uniqueness shape. Milestone 8 should make schema initialization and migration converge on append-only receipts plus entitlement upsert.

## Event Contract

Every v0.2.0 event should include:

- `protocol_version`
- `program_id` if practical, otherwise indexer derives from transaction
- `chain_context` if practical, otherwise indexer derives from environment/config
- primary account keys
- `*_usdc_micros` amount fields
- vault keys for money-moving events
- registry linkage fields where present

Events to define:

- `ConfigInitializedV2`
- `AgentRegisteredV2`
- `AuthorBondDepositedV2`
- `AuthorBondWithdrawnV2`
- `VouchCreatedV2`
- `VouchRevokedV2`
- `ListingVouchLinkedV2`
- `ListingVouchUnlinkedV2`
- `SkillListingCreatedV2`
- `SkillListingUpdatedV2`
- `SkillPurchasedV2`
- `X402PurchaseSettledV2`
- `VoucherRevenueClaimedV2`
- `AuthorDisputeOpenedV2`
- `AuthorDisputeResolvedV2`
- `AuthorBondSlashedV2`
- `VouchSlashedV2`
- `AuthorityRotatedV2`
- `ProtocolPausedV2`

## Milestone 1 Verification Checklist

- [x] Every v0.1.0 lamport field has a v0.2.0 replacement or intentional removal.
- [x] Every money-moving instruction lists token mint, owner, token program, signer, PDA seeds, and post-transfer state requirements.
- [x] x402 is explicitly gated behind bridge POC for protocol-listed paid skills.
- [x] Economic floors are specified.
- [x] Reputation formula and caps are specified.
- [x] Reward-index math is specified with first-class `ListingVouchPosition` accounts.
- [x] Dispute liability and payout order are specified.
- [x] Authority roles and mainnet governance requirements are specified.
- [x] DB/indexer implications are specified.

## Remaining Blockers Before Milestone 3

These are not unresolved design forks, but they must be validated before code freeze for the Anchor rewrite:

- Run the x402 bridge POC against the selected facilitator.
- Measure account count and compute for worst-case dispute linking/settlement.
- Confirm exact max string lengths for registry fields and CAIP-2 storage to keep account rent bounded.
- Verify local tools match the pinned toolchain before starting Milestone 3 implementation.

## Handoff To Milestone 2/3

Milestone 2 can create the fresh program identity once this spec is reviewed.

Milestone 3 should begin with a broad on-chain rewrite that changes account structs, PDA constraints, SPL Token CPIs, and event names together. Do not implement temporary SOL compatibility layers.
