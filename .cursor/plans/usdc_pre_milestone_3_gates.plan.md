---
name: Pre-Milestone 3 Gates
overview: Lock the remaining protocol, custody, authority, x402, and tooling decisions before the broad Anchor USDC rewrite starts.
todos:
  - id: gate-x402-bridge
    content: Decide x402 bridge POC pass/fail criteria and fallback behavior
    status: completed
  - id: gate-economics
    content: Lock USDC economic constants and reputation calibration inputs
    status: completed
  - id: gate-authorities
    content: Lock authority, treasury, pause, and rotation policy
    status: completed
  - id: gate-vault-lifecycle
    content: Lock PDA token vault lifecycle, close rules, and rent/refund behavior
    status: completed
  - id: gate-reward-index
    content: Lock voucher reward index rules and edge-case behavior
    status: completed
  - id: gate-compute-accounts
    content: Review account-count and compute ceilings before implementing high-account flows
    status: completed
  - id: gate-toolchain
    content: Pin toolchain, generated-client commands, and verification commands
    status: completed
  - id: gate-cutover
    content: Confirm production cutover guardrails and Phantom-facing metadata timing
    status: completed
isProject: false
---

# Pre-Milestone 3 Gates

## Goal

Resolve the design questions that would be expensive to change after the broad Anchor USDC rewrite starts.

Milestone 3 should not begin until each gate below has a concrete decision, acceptance check, and owner for any remaining POC work.

## Source Of Truth

- Durable migration spec: `docs/USDC_NATIVE_MIGRATION.md`
- Protocol spec: `.cursor/plans/usdc_milestone_1_protocol_spec.plan.md`
- Fresh identity handoff: `.cursor/plans/usdc_milestone_2_fresh_program_identity.plan.md`
- New program identity: `agentvouch`
- New program ID: `CVpe18yvJ4nJxHivqu8G85TSKn8YVZcWaVE3z8afrQnW`

## Gate 1 - x402 Bridge

Decision:

- `settle_x402_purchase` is not part of the first Milestone 3 core Anchor rewrite.
- Milestone 3 should implement the direct `purchase_skill` USDC path as the only protocol-visible paid purchase path.
- The program may reserve config/account fields needed for a future bridge, but no x402 bridge instruction should be enabled until the POC below passes.
- x402 for protocol-listed paid skills remains disabled/fail-closed during devnet testing. x402 remains allowed only for repo-only/off-chain entitlement flows that are explicitly marked as not protocol-visible.
- `/api/x402/supported` must not advertise protocol-listed paid skill support until the bridge POC passes and the API can settle through the on-chain protocol.

Decision needed:

- Whether `settle_x402_purchase` is included in the first Milestone 3 implementation pass or left behind a feature gate until the POC passes.
- Whether x402 for protocol-listed paid skills is disabled, entitlement-only, or bridge-backed during devnet testing.

Pass criteria:

- x402 payment can be bound to protocol references: version, listing, skill id, buyer, amount, nonce, and timestamp.
- Backend can verify the settled USDC transfer, payer, destination settlement vault, amount, mint, and memo without relying on user-submitted claims.
- `settle_x402_purchase` is idempotent and prevents duplicate purchase or reward-credit creation.
- Failure and refund behavior are documented for facilitator failure, partial settlement, duplicate settlement, stale nonce, wrong amount, wrong mint, and wrong listing.

Fallback:

- If the POC fails, x402 remains repo-only/off-chain entitlement flow for paid skills until a trustless or facilitator-supported protocol call path exists.

Milestone 3 implication:

- Build direct USDC `purchase_skill` first.
- Keep x402 bridge work as a separate POC/backlog item before Milestone 8 API alignment.
- Do not let web/API flows create voucher rewards or protocol reputation from x402 receipts until an on-chain `X402SettlementReceipt` and normal `Purchase` PDA are created by a verified bridge path.

## Gate 2 - Economics And Reputation

Decision:

- Lock the listed USDC economic constants for the Milestone 3 rewrite.
- Use one USD-at-risk curve for author bonds and voucher stake. Both represent slashable trust capital and should have the same base weight in `v0.2.0`.
- Keep `total_vouches_received` as a separate count-based social proof component, capped independently from the risk component.
- Keep profile age in the on-chain score through the capped `longevity_component`; it uses `AgentProfile.registered_at`, not wallet/account age.
- Use integer math only: compute risk with `u128` intermediates, divide micro-USDC by `1_000_000`, floor fractional score points, saturate on subtraction, then cap the final score.
- Upheld disputes reduce score in two ways: slashed stake/bond immediately lowers USD-at-risk, and each upheld dispute applies a fixed penalty. Open disputes freeze withdrawals but do not directly reduce score until resolved.
- All constants are config fields or config-derived defaults so devnet can tune them, but changing them after Milestone 3 starts requires updating this plan and `docs/USDC_NATIVE_MIGRATION.md`.

Lock before coding:

- Minimum listing price: `0.01 USDC` (`10_000` micros), unless explicitly changed before Milestone 3.
- Minimum vouch stake: `1 USDC`.
- Minimum author bond for free listings: `1 USDC`.
- Dispute bond: `0.5 USDC`.
- Author/voucher split: `60%` direct author payout, `40%` listing reward vault.
- Protocol fee: `0%` for `v0.2.0`, with account layout room for a future explicit fee.

Resolved reputation questions:

- Exact score formula, caps, integer rounding, overflow bounds, and calibration against the legacy `0.001 SOL` listing floor.
- Whether author bond and voucher stake use the same or separate weighting curves.
- How disputes and slashing reduce score immediately and after any cooldown.

Locked formula:

```text
risk_usdc_micros = author_bond_usdc_micros + total_vouch_stake_usdc_micros
risk_component = min(
  (risk_usdc_micros * stake_weight_per_usdc) / 1_000_000,
  risk_component_cap
)
vouch_component = min(
  total_vouches_received * vouch_weight,
  vouch_component_cap
)
longevity_component = min(
  age_days * longevity_bonus_per_day,
  longevity_component_cap
)
raw_positive_score = risk_component + vouch_component + longevity_component
dispute_penalty = upheld_author_disputes * upheld_dispute_penalty
score = min(saturating_sub(raw_positive_score, dispute_penalty), reputation_score_cap)
```

Locked defaults:

- `stake_weight_per_usdc = 10`
- `risk_component_cap = 10_000_000` (saturates at `1,000,000 USDC` of slashable trust capital)
- `vouch_weight = 10`
- `vouch_component_cap = 10_000` (saturates at `1,000` vouches)
- `longevity_bonus_per_day = 1`
- `longevity_component_cap = 3_650` (saturates at ~10 years of profile age)
- `upheld_dispute_penalty = 1_000`
- `reputation_score_cap = 10_100_000`

Implementation notes:

- Use `u128` for intermediate multiplication and addition.
- Floor division is acceptable; do not use floats.
- Saturating casts to `u64` are acceptable only after cap checks.
- Recompute reputation after every bond deposit/withdraw, vouch, revoke, slash, and dispute resolution.
- Keep amount-based risk and count-based vouch social proof separate. Do not rename `vouch_weight` to a per-USDC weight; vouch stake already contributes through `stake_weight_per_usdc`.
- Wallet age, account age, GitHub age, domain age, and registry age are off-chain/indexed trust context in `v0.2.0`; do not add them to the core on-chain score.

## Gate 3 - Authorities And Treasury

Decision:

- Treat BPF upgrade authority separately from `ReputationConfig` roles. It is not stored in config, but it is part of the deployment runbook.
- Devnet `v0.2.0` may use a controlled deployer/config key for fast iteration, but every deploy must record the upgrade authority, config authority, treasury authority, pause authority, and settlement authority pubkeys in the runbook or environment notes.
- Mainnet `v1.0.0` cannot accept real user funds while any single hot wallet controls upgrade, config, or treasury authority. Upgrade, config, and treasury authority must be multisig or stronger governance before mainnet funds.
- `config_authority` controls governance-sensitive config updates and role rotations.
- `treasury_authority` is reserved in `v0.2.0`, but Milestone 3 should not implement arbitrary treasury withdrawals. Treasury inflows are dismissed dispute bonds and future governed fees.
- `pause_authority` can only toggle the pause state. If it is separate from `config_authority`, it must be rotatable by `config_authority`.
- `settlement_authority` is operationally hotter and narrower than governance roles. It is reserved for the future x402 bridge, must be rotatable and pausable by `config_authority`, and cannot withdraw arbitrary settlement or treasury vault balances.
- `paused = true` blocks new risk and new purchases: create/update paid listings, direct purchases, new vouches, vouch/listing links, author-bond deposits, and x402 settlement. It allows authority rotation, unpause, dispute open/resolve, voucher reward claims, author-bond withdrawals, vouch revokes, and close flows only when the normal dispute/lock invariants already permit them.

Lock before coding:

- `upgrade_authority`, `config_authority`, `treasury_authority`, `pause_authority`, and `x402_settlement_authority` semantics.
- Devnet authority custody and rotation procedure.
- Mainnet requirement: no single hot wallet controls upgrade/config/treasury/settlement authority after real user funds are accepted.
- Whether treasury withdrawals are disabled on devnet and what approval threshold is required before mainnet.

Config fields affected:

- USDC mint
- token program
- protocol treasury vault
- x402 settlement authority
- x402 settlement vault
- role pubkeys
- economic floors
- slash percentages
- pause state
- future protocol fee slots

Milestone 3 implication:

- Add role fields to `ReputationConfig` instead of relying on the legacy single `authority`.
- Add explicit role-rotation instructions gated by `config_authority`.
- Add pause/unpause instructions gated by `pause_authority`.
- Do not add `withdraw_treasury` in Milestone 3; leave it for a mainnet-governance milestone if protocol fees or treasury operations become necessary.

## Gate 4 - Vault Lifecycle

Decision:

- Use explicit token-account PDAs for all protocol-owned USDC vaults. Do not use ATAs for author-bond, vouch-stake, listing-reward, dispute-bond, treasury, or settlement vault token accounts.
- Use canonical recipient ATAs only for user-facing payouts and claims: author payout ATA `(author, config.usdc_mint)`, voucher claim ATA `(voucher_authority, config.usdc_mint)`, challenger payout ATA `(challenger, config.usdc_mint)`, and any governed treasury recipient if a future treasury instruction exists.
- Clients create recipient ATAs idempotently before submitting. The program validates owner, mint, token program, and expected address, but does not CPI-create recipient ATAs.
- Rent payer policy is fixed by primitive: author pays author-bond and listing-reward vault rent, voucher pays vouch-stake vault rent, challenger pays dispute-bond vault rent, and config initializer pays treasury/settlement vault rent.
- Rent refunds go back to the original primitive rent payer on normal close or force/final close. Slashing never confiscates SOL rent; it only moves USDC.
- Author-bond vaults close only after `amount_usdc_micros == 0` and no open dispute can reach the bond.
- Vouch-stake vaults close only through revoke or final post-dispute settlement after the vouch is inactive/unlinked and no open dispute can slash it.
- Listing-reward vaults stay claimable after listing removal and close only after all voucher claim rights are resolved. Any residual unallocated USDC dust or accidental direct transfers that are not assigned to a claimable position can be swept to the protocol treasury vault during a permissionless close/sweep path.
- Dispute-bond vaults settle and close on resolution: upheld sends the dispute bond plus slashed USDC to the challenger; dismissed sends the dispute bond to the protocol treasury vault. Rent returns to the challenger.
- Lost-wallet policy remains no admin recovery in `v0.2.0`; funds remain controlled by the original authority and normal close/claim/revoke invariants.

Lock before coding:

- Per-author author-bond vault creation, close, and rent refund behavior.
- Per-vouch stake vault creation, top-up, slash, revoke, close, and rent refund behavior.
- Per-listing reward vault creation, voucher claim, listing close, stranded dust, and rent refund behavior.
- Per-dispute bond vault creation, upheld/dismissed settlement, close, and rent refund behavior.
- Recipient ATA policy: clients create canonical ATAs idempotently; program validates but does not auto-create recipient ATAs.
- Lost-wallet policy: no admin recovery by default for `v0.2.0`.

Milestone 3 implication:

- Store or derive enough immutable authority/rent-payer information to enforce rent refunds deterministically.
- Add close/sweep instructions only where they preserve claim ownership and dispute locks.
- Add tests for each vault close path, rent refund recipient, full slash close, listing dust sweep, accidental direct token transfer, and missing/wrong recipient ATA.

## Gate 5 - Reward Index

Decision:

- Use first-class `ListingVouchPosition` accounts with PDA seeds `[b"listing_vouch_position", skill_listing, vouch]`.
- Keep listing-level cumulative index accounting: `reward_index_usdc_micros_x1e12: u128` and `active_reward_stake_usdc_micros: u64` on `SkillListing`.
- Keep position-level reward debt: `reward_stake_usdc_micros: u64`, `entry_reward_index_x1e12: u128`, `pending_rewards_usdc_micros: u64`, `cumulative_revenue_usdc_micros: u64`, and `status`.
- Use `SCALE = 1_000_000_000_000`.
- Use checked `u128` intermediates for `voucher_pool`, `index_delta`, accrued rewards, pending additions, and listing index additions. Arithmetic overflow fails the instruction; do not saturate reward accounting.
- Paid `purchase_skill` requires `active_reward_stake_usdc_micros > 0` and `index_delta > 0`.
- Purchase-time update:

```text
voucher_pool = price_usdc_micros * voucher_share_bps / 10_000
index_delta = voucher_pool * SCALE / active_reward_stake_usdc_micros
listing.reward_index_usdc_micros_x1e12 += index_delta
listing.unclaimed_voucher_revenue_usdc_micros += voucher_pool
```

- Position mutation always accrues before changing stake, status, or entry index:

```text
accrued = reward_stake_usdc_micros * (listing.reward_index_usdc_micros_x1e12 - entry_reward_index_x1e12) / SCALE
pending_rewards_usdc_micros += accrued
entry_reward_index_x1e12 = listing.reward_index_usdc_micros_x1e12
```

- Link starts at the current listing reward index so late vouches do not earn prior voucher-pool revenue.
- Unlink accrues first, then reduces `active_reward_stake_usdc_micros`, decrements `Vouch.linked_listing_count`, and preserves pending rewards.
- Revoke requires `linked_listing_count == 0`; it never forfeits already accrued listing rewards.
- Partial slash accrues first, then reduces future reward stake in proportion to remaining active vouch stake. Fully slashed positions become `Slashed` with zero future reward stake, but pending rewards already accrued before the slash remain claimable unless a later explicit forfeiture rule is adopted.
- Claim accrues first, transfers claimable USDC from the listing reward vault to the voucher canonical ATA, decrements `unclaimed_voucher_revenue_usdc_micros` by the actual paid amount, and updates position and aggregate vouch revenue counters.
- Listing removal freezes new purchases and links, but does not block reward claims.
- Listing close requires `unclaimed_voucher_revenue_usdc_micros == 0` and no claimable `ListingVouchPosition` rewards. A permissionless close/sweep path may move only residual unassigned dust or accidental direct-transfer USDC to the protocol treasury after all claim rights are resolved.

Lock before coding:

- `ListingVouchPosition` account fields and PDA seeds.
- Reward index scale factor and overflow bounds.
- Purchase-time reward index update formula.
- Link/unlink/revoke behavior for reward debt.
- Eligibility at purchase time, claim time, close time, and dispute/slash time.
- Handling for zero active listing vouch stake on paid listings.

## Gate 6 - Compute And Account Ceilings

Decision:

- No Milestone 3 instruction may require an unbounded number of accounts. Design to work without Address Lookup Tables; ALTs may optimize clients later but are not required for correctness.
- Use `64` static account keys as the planning ceiling for user-facing transactions.
- Paid-listing dispute exposure is listing-scoped. Dispute linking and voucher slashing operate on `ListingVouchPosition` accounts for the disputed listing, not every author-wide vouch.
- Add or maintain a listing active-position count so the program can enforce `MAX_ACTIVE_REWARD_POSITIONS_PER_LISTING = 32` for `v0.2.0`.
- Use `MAX_DISPUTE_POSITIONS_PER_TX = 8` for any instruction that links, verifies, slashes, or settles dispute-linked voucher positions.
- Paid-listing dispute resolution must be batched if more than `MAX_DISPUTE_POSITIONS_PER_TX` positions are linked. Do not ship a single `resolve_author_dispute` path that expects all voucher/token accounts in one transaction.
- Dismissed disputes may resolve in a fixed-account path. Upheld paid-listing disputes use a stateful flow: record ruling, settle author bond, process linked voucher positions in chunks, then finalize once all required positions are settled.
- Direct `purchase_skill`, `claim_voucher_revenue`, link/unlink, revoke, author-bond deposit/withdraw, and listing create/remove/close must remain fixed-account flows.
- Compute budget targets before devnet cutover:
  - direct purchase: below `250_000` CU
  - voucher claim: below `200_000` CU
  - link/unlink/revoke: below `250_000` CU each
  - open dispute and dismissed dispute resolution: below `300_000` CU
  - dispute link batch of 8 positions: below `500_000` CU
  - upheld voucher settlement batch of 8 positions: below `1_200_000` CU, with client compute budget headroom up to the cluster max
  - future `settle_x402_purchase`: target below `350_000` CU when implemented
- If measured CU exceeds these targets, reduce batch size before devnet cutover instead of relying on larger transactions.

Review before coding:

- Maximum accounts for `resolve_author_dispute`, especially when linked vouches and token accounts arrive through `remaining_accounts`.
- Whether dispute resolution needs batching, capped linked-vouch processing, or multiple resolution instructions.
- Compute budget expectations for purchase, settle x402, claim rewards, and dispute flows.
- Test strategy for upper-bound account counts.

Milestone 3 implication:

- Add constants for `MAX_ACTIVE_REWARD_POSITIONS_PER_LISTING` and `MAX_DISPUTE_POSITIONS_PER_TX`.
- Add dispute progress fields sufficient for batched settlement, for example linked position count, processed position count, total slashed so far, and finalization status.
- Add tests for `N = 0`, `1`, `MAX_DISPUTE_POSITIONS_PER_TX`, `MAX_ACTIVE_REWARD_POSITIONS_PER_LISTING`, and `MAX_ACTIVE_REWARD_POSITIONS_PER_LISTING + 1`.
- Record account count and compute units in tests for direct purchase, claim, open dispute, dismissed dispute, max-size link batch, max-size slash batch, and close/sweep paths.

## Gate 7 - Toolchain And Generated Artifacts

Decision:

- Pin Anchor CLI to `0.32.1`.
- Pin Solana CLI to `3.1.4` for the current Milestone 3 environment.
- Pin Rust/MSRV to `1.89.0` via `rust-toolchain.toml`.
- Pin Node/npm expectation to Node `24.1.0` and npm `11.12.1` for local verification.
- Add `anchor-spl = { version = "0.32.1" }` in Milestone 3, matching `anchor-lang = "0.32.1"`.
- Use npm as the canonical workspace package manager. `Anchor.toml` should be aligned to npm when Milestone 3 implementation starts.
- Treat generated artifacts as build outputs that must be regenerated, not hand-edited: `target/idl/agentvouch.json`, `target/types/agentvouch.ts`, `target/deploy/agentvouch.so`, `web/agentvouch.json`, and `web/generated/agentvouch`.
- If `NO_DNA=1 anchor build` does not leave `target/deploy/agentvouch.so` in the repo because `CARGO_TARGET_DIR` is set externally, run the explicit SBF command below with `CARGO_TARGET_DIR` unset.

Pin before coding:

- Anchor: `0.32.1`
- Solana CLI: current repo environment uses `3.1.4`
- Rust/MSRV: `1.89.0`
- Node/npm: Node `24.1.0`, npm `11.12.1`
- `anchor-spl`: `0.32.1`
- SBF build command for deploy artifact generation:

```bash
env -u CARGO_TARGET_DIR cargo build-sbf --manifest-path programs/agentvouch/Cargo.toml
```

Generated artifact flow:

```bash
NO_DNA=1 anchor build
cp target/idl/agentvouch.json web/agentvouch.json
npm run generate:client
npm run build --workspace @agentvouch/web
```

Verification flow:

```bash
anchor --version
solana --version
rustc --version
cargo --version
node --version
npm --version
NO_DNA=1 anchor build
env -u CARGO_TARGET_DIR cargo build-sbf --manifest-path programs/agentvouch/Cargo.toml
cp target/idl/agentvouch.json web/agentvouch.json
npm run generate:client
npm run build --workspace @agentvouch/web
```

## Gate 8 - Production Cutover

Decision:

- Keep production `agentvouch.xyz` on the current working flow until `v0.2.0` is deployed, initialized, indexed, and smoke-tested end to end on the target cluster.
- Branch artifacts may reference the `v0.2.0` program ID during implementation, but production must not serve public metadata that advertises `v0.2.0` before the deployed program, config, API/indexer, and web flows match it.
- Cut over in this order: deploy program, initialize config, verify program/config authorities, sync IDL/client artifacts, enable API/indexer reads, enable feature-flagged v0.2.0 writes, run devnet smoke tests, update public metadata/docs/protocol constants together, then hard-cut primary writes to `v0.2.0`.
- `web/public/skill.md`, `web/public/.well-known/agentvouch.json`, public docs, `web/agentvouch.json`, `web/generated/agentvouch`, and `@agentvouch/protocol` constants are one release artifact and must flip together.
- `web/public/skill.md` must be internally consistent at cutover: USDC-native copy, v0.2.0 program ID, current paid download contract, x402 capability status, and no stale SOL/lamport publish or purchase claims except explicit legacy notes.
- During transition, APIs and trust surfaces may dual-read `v0.1.0` and `v0.2.0`, but new writes hard-cut to `v0.2.0` only after direct purchase indexing, entitlement repair/backfill, and smoke tests pass.
- Rollback path: keep `main` deploy-safe for the current v0.1 flow until Milestone 10 passes. If cutover smoke fails after a preview deploy, roll production metadata and write flags back to the current v0.1 flow; do not partially roll forward public manifests.
- Phantom acceptance remains tied mostly to domain, app ID, allowlisted URLs, and wallet UX. Do not expose new program ID-dependent wallet flows in production until Phantom connect, direct checkout, and embedded/send-only wallet fallbacks are verified.
- `/api/x402/supported` remains fail-closed for protocol-listed paid skills until the x402 bridge POC passes; repo-only/off-chain x402 support must be labeled as not protocol-visible.
- Private deploy keypairs remain untracked and out of commits.

Confirm before public deployment:

- Production `agentvouch.xyz` stays on the current working flow until `v0.2.0` is deployed, initialized, indexed, and smoke-tested.
- `web/public/skill.md`, `.well-known/agentvouch.json`, public docs, generated IDL/client files, and `@agentvouch/protocol` constants flip together.
- Phantom app acceptance remains tied mostly to domain, app ID, allowlisted URLs, and wallet UX; new program ID exposure waits until the new on-chain flow works.
- Private deploy keypairs remain untracked and out of commits.

Smoke checklist before public cutover:

- Deployed program ID, `declare_id!`, `Anchor.toml`, `web/agentvouch.json`, generated client, protocol package constants, `.well-known/agentvouch.json`, and `skill.md` metadata all agree.
- Config is initialized with the expected USDC mint, token program, role authorities, treasury vault, settlement vault, floors, splits, pause state, and CAIP-2 chain context.
- API/indexer can read v0.2.0 config, profiles, listings, vouches, purchases, voucher claims, disputes, and authority events.
- Devnet smoke passes: register agent, deposit author bond, vouch, link vouch to listing, publish listing, direct USDC purchase, claim voucher revenue, open/resolve dispute, verify reputation delta, and download raw skill content with `X-AgentVouch-Auth`.
- Legacy v0.1 read surfaces remain readable during transition, while all new writes target v0.2.0 after hard cut.
- Production preview confirms Phantom wallet connection, direct purchase checkout, send-only/embedded wallet fallback copy, and no protocol-listed x402 advertisement unless bridge support is live.
- Public docs and `skill.md` have no stale SOL-denominated primary flow claims.

## Acceptance Criteria

- Every gate above has a decision recorded in this plan or promoted into `docs/USDC_NATIVE_MIGRATION.md`.
- No gate remains an implementation fork before Milestone 3 begins.
- Milestone 3 can proceed as a broad rewrite without compatibility shims for unresolved SOL-era behavior.

## Verification Commands

```bash
rg "TODO|TBD|unresolved|decide|optional|fork" .cursor/plans/usdc_pre_milestone_3_gates.plan.md docs/USDC_NATIVE_MIGRATION.md
rg "agentvouch|USDC|x402|settlement_authority|ListingVouchPosition" docs/USDC_NATIVE_MIGRATION.md .cursor/plans/usdc_milestone_1_protocol_spec.plan.md
```
