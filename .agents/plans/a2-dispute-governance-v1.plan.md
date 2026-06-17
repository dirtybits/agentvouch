---
name: a2-dispute-governance-v1
overview: "Implement roadmap A2 / readiness P0.2: split resolver authority from config authority, replace instant dispute resolution with propose/execute timelock governance, route slashed value toward buyer refunds first, and add governed config/authority rotation paths before mainnet-RC."
todos:
  - id: design-lock
    content: Lock A2 design decisions, constants, account-layout strategy, and rollback assumptions against current roadmap/readiness docs
    status: pending
  - id: state-and-events
    content: Add resolver authority/timelock fields and pending-resolution state to ReputationConfig/AuthorDispute; add governance/config events; adjust LEN constants
    status: pending
  - id: config-authority-instructions
    content: Add governed config/economic setter, authority rotation, and treasury sweep instructions with strict authority checks and invariant validation
    status: pending
  - id: propose-resolution
    content: Replace authority-keyed resolve entrypoint with propose_author_dispute_resolution that records ruling, refund request, and executable timestamp without moving funds
    status: pending
  - id: execute-resolution
    content: Add execute_author_dispute_resolution to enforce the timelock, move dispute bonds/author bond slash/refund-first buckets, and preserve A1 voucher-slashing parking semantics
    status: pending
  - id: refund-pool-integration
    content: Update create_refund_pool so resolver discretion is bounded by proposal state and refund capacity; keep slashed deposits and proceeds accounting separated
    status: pending
  - id: clients-and-surfaces
    content: Rebuild IDL, sync web/agentvouch.json, regenerate curated web client, and update CLI/web helper call sites for proposed/executed resolution
    status: pending
  - id: tests
    content: Add Anchor coverage for resolver split, timelock, bounded refunds/rewards, authority rotation, treasury sweep, and A1 slashing regressions
    status: pending
  - id: docs-and-runbook
    content: Update MAINNET_READINESS.md, ROADMAP.md, PRODUCTION_RUNBOOK.md, docs/DEVNET_STATE.md, and web/public/skill.md after implementation/deploy decisions are real
    status: pending
  - id: verification
    content: Run NO_DNA=1 anchor build/test, sync/generated-client checks, web/CLI tests and builds, devnet smoke, and final diff/security review
    status: pending
isProject: false
---

# A2 — Dispute Governance v1

## Goal

Convert dispute settlement from "one hot key instantly resolves and pays the challenger" into a governed, observable flow: a resolver authority proposes a ruling and refund parameters, a timelock gives the world time to react, then execution moves funds according to bounded rules that prioritize harmed buyers over resolver/challenger extraction.

Design target as of 2026-06-17:

1. **Resolver authority is separate from config authority.** Dispute resolution and economic/config mutation are distinct powers.
2. **Resolution is two-phase.** `propose_author_dispute_resolution` records the proposed ruling, refund request, challenger reward intent, and `executable_at`; `execute_author_dispute_resolution` enforces the delay and performs state/fund movement.
3. **Refund-first routing for paid disputes.** Paid-listing author-bond slash and voucher slashes increase buyer refund capacity before paying a challenger reward. Challenger reward remains capped by config.
4. **Resolver discretion is bounded.** Refund pool sizing must derive from escrow/proceeds/slashed value and purchase price snapshots, not arbitrary authority input.
5. **A1 semantics survive.** Upheld paid disputes with active linked positions still park in `SlashingVouchers`, use permissionless `slash_dispute_vouches`, and keep listing/settlement locks until `create_refund_pool` consumes the refund settlement path.
6. **Free-listing v1 has bounded challenger upside.** `AuthorBondOnly` free-listing disputes have no purchase, settlement, author-proceeds vault, or refund pool. For A2 v1, upheld free-listing author-bond slash returns the challenger's dispute-bond principal, pays a capped challenger reward from the slashed author bond, and routes the residual slash to `protocol_treasury_vault`; A4 can later define a broader reserve/backstop policy.
7. **Settlement locks remain load-bearing.** For paid disputes, `ListingSettlement.locked_by_dispute` and `SkillListing.locked_by_dispute` must remain set across propose -> timelock -> execute -> slash pages -> refund-pool creation. No author proceeds withdrawal is allowed while a resolution is proposed or pending.
8. **A2 devnet is a clean break.** A2 changes `ReputationConfig`, `AuthorDispute`, and `ListingSettlement` layouts. Do not stack same-program realloc migrations on top of M13 unless a separate migration design proves compatibility; use a fresh devnet program ID and DB cleanup for A2 implementation/smoke.
9. **Paid disputes are buyer-first before challenger reward.** For purchase-attached paid disputes, buyer refund exposure is allocated from available capacity before any challenger reward is reserved. Challenger reward can only use remaining eligible proceeds after the buyer-first pool, and paid slash buckets are never author-withdrawable.
10. **Economic parameters are snapshotted.** Proposal records slash percentage, challenger reward bps/cap, and any other settlement-economic values needed by execute/slash/refund. Settlement recomputes from live token buckets, but uses the dispute snapshots rather than mutable live config.

## Scope

- In scope: Anchor program state/instructions/tests under `programs/agentvouch/` and `tests/`, IDL/client regeneration, helper call sites, readiness/runbook/docs sync.
- In scope: config setters and authority rotation because they are required to point resolver/config/treasury/pause/settlement authorities at a multisig without redeploy.
- In scope: a governed treasury sweep path for dismissed dispute bonds and future protocol fees, with explicit destination and eventing.
- Out of scope: A3 `set_paused` implementation except where authority rotation must include `pause_authority`; ship A3 as its own plan or adjacent tiny branch.
- Out of scope: LLM-jury / optimistic-oracle adjudication beyond storing/validating human/operator proposal state.
- Out of scope: mainnet deployment itself. This plan produces a mainnet-RC-capable branch and devnet evidence.

## Source Context

Verified 2026-06-16 against the local worktree:

- `ReputationConfig` currently has `authority`, `config_authority`, `treasury_authority`, `settlement_authority`, `pause_authority`, economic values, `paused`, and `bump`; it has **no** `resolver_authority` and no timelock field.
- `resolve_author_dispute.rs` and `create_refund_pool.rs` are both gated by `config.config_authority`.
- `resolve_author_dispute.rs` currently transfers the dispute bond to the challenger on Upheld and to protocol treasury on Dismissed.
- `slash_author_bond_if_present` currently transfers author-bond slash directly to the challenger USDC account.
- A1 added `SlashingVouchers`, paged `slash_dispute_vouches`, `ListingSettlement.slashed_deposit_usdc_micros`, and listing/settlement locks that stay set until `create_refund_pool`.
- `create_refund_pool.rs` already computes challenger reward only on withdrawable author proceeds and excludes slashed deposits from the reward base.
- Solana/Anchor docs checked through local Solana skills and MCP search on 2026-06-16: Anchor supports account `realloc`, PDA seed/bump constraints, `Clock::get()` for timelock checks, and IDL/client generation should remain product artifacts.

## Files To Change

### State

- `programs/agentvouch/src/state/config.rs`
  - Add `resolver_authority: Pubkey`.
  - Add `resolution_timelock_seconds: i64` with default 48-72h once the value is chosen.
  - Consider adding `min_resolution_timelock_seconds` / `max_resolution_timelock_seconds` only if config setters allow mutating the timelock; otherwise enforce a constant min in setter logic.
  - Keep role fields explicit: `config_authority`, `resolver_authority`, `treasury_authority`, `settlement_authority`, `pause_authority`.
  - Treat `authority` as legacy/inert root metadata unless implementation finds a live privilege path. It should not be a hidden mainnet authority. If kept, document that it has no authorization checks; if any instruction starts using it, add it to `rotate_authorities` and the runbook.
  - Update `LEN` and initialization defaults.

- `programs/agentvouch/src/state/author_dispute.rs`
  - Add pending-resolution fields, likely:
    - `proposed_ruling: Option<AuthorDisputeRuling>`
    - `proposed_refund_pool_usdc_micros: u64`
    - `proposed_challenger_reward_usdc_micros: u64` as an advisory preview only; source of truth is recomputation at settlement from live buckets and config.
    - `slash_percentage_snapshot: u8`
    - `challenger_reward_bps_snapshot: u16`
    - `challenger_reward_cap_usdc_micros_snapshot: u64`
    - `resolution_proposed_at: Option<i64>`
    - `resolution_executable_at: Option<i64>`
    - `resolution_proposer: Option<Pubkey>`
  - Decide whether to add `AuthorDisputeStatus::ResolutionProposed` or keep `status = Open` until execution. Recommendation: add `ResolutionProposed` so UI/indexers can distinguish open evidence from pending execution. Append enum variant to preserve existing variant encodings.
  - Update `LEN`.

- `programs/agentvouch/src/state/settlement.rs`
  - Add `bond_slashed_deposit_usdc_micros: u64` for paid-listing author-bond slash routed into the disputed listing settlement as refund-only capacity.
  - Keep this distinct from `slashed_deposit_usdc_micros`, which remains voucher-slash money. Do **not** mix author-bond slash into the voucher field.
  - Update `LEN` and refund-pool accounting.

### Instructions

- Add `instructions/propose_author_dispute_resolution.rs`
  - Accounts: `author_dispute`, `author_profile`, `skill_listing`, optional `listing_settlement`, `config`, `resolver_authority: Signer`.
  - Require `resolver_authority == config.resolver_authority`.
  - Require dispute is `Open`.
  - Validate PDA/config/listing/settlement relationships just like the current resolver path.
  - Store proposed ruling, requested refund pool amount, proposed challenger reward amount or bps-derived preview, proposal timestamp, and executable timestamp.
  - Snapshot settlement economics from config at proposal time: slash percentage, challenger reward bps, challenger reward cap, and any other mutable config value that affects fund movement.
  - Do **not** move tokens or mutate author reputation counters.
  - For Dismissed, proposed refund amount must be zero.
  - For Upheld paid disputes with an attached verified purchase, cap requested refund by formula; see "Refund Formula".
  - For Upheld paid disputes without an attached verified purchase, require proposed refund and proposed reward to be zero in A2 v1. This path is reputation-only and must not enter voucher slashing or create a refund pool until an A4/indexer-backed affected-buyer scope exists.
  - Emit `AuthorDisputeResolutionProposed`.

- Add `instructions/execute_author_dispute_resolution.rs`
  - Accounts mostly mirror current `resolve_author_dispute.rs`, but authority is the executor/payer and need not be resolver if the proposal is already recorded. Decide whether execution is permissionless after timelock; recommendation: permissionless execute after proposal matures, because it lowers liveness risk.
  - Require status `ResolutionProposed`, `Clock::get()?.unix_timestamp >= executable_at`, and all proposal fields present.
  - For Dismissed:
    - Transfer dispute bond to protocol treasury as today.
    - Clear listing/settlement locks.
    - Decrement `open_author_disputes`, increment dismissed count, recompute reputation.
  - For Upheld:
    - Return the challenger’s original dispute bond first, or explicitly route it through treasury/refund if product policy says otherwise. Recommendation: return bond principal to challenger; reward is separate and capped.
    - Slash author bond if present. For paid `AuthorBondThenVouchers`, transfer the slash into the disputed listing's author proceeds vault and increment `listing_settlement.bond_slashed_deposit_usdc_micros`. For free `AuthorBondOnly`, compute a capped challenger reward from the author-bond slash, transfer that reward to the challenger, and route the residual slash to `protocol_treasury_vault` because there is no settlement/refund pool.
    - Increment upheld counters and recompute reputation.
    - If paid and linked vouches exist, set status `SlashingVouchers` as A1 does; final `Resolved` remains the last slash page.
    - If purchase-attached paid and no linked vouches, keep locks until `create_refund_pool` consumes the settlement path or explicitly finalizes a zero-capacity path.
    - If free-listing `AuthorBondOnly` or paid reputation-only with no attached purchase, move to `Resolved` immediately and clear locks without creating a refund pool.
  - Emit `AuthorDisputeResolutionExecuted`.

- Replace or retain `resolve_author_dispute`
  - Recommendation: keep the public instruction name only as a compatibility wrapper during local/devnet if cheap, but mainnet-RC should prefer explicit `propose_*` / `execute_*` entrypoints.
  - If retained, make it fail with a clear `UseGovernedResolutionFlow` error or call propose+execute only when timelock is zero in local tests. Avoid shipping an instant hot-key bypass.

- Add `instructions/update_config.rs` or split into narrow setters
  - Gated by `config.config_authority`.
  - Update economic values: floors, slash percentage, reward shares, challenger reward bps/cap, author proceeds lock, refund claim window, resolution timelock.
  - Enforce invariants:
    - shares sum to 10_000
    - `slash_percentage <= 100`
    - bps values <= 10_000
    - lock/window/timelock nonnegative
    - chain context length <= `MAX_CHAIN_CONTEXT_LEN` if mutable
  - Emit `ReputationConfigUpdated`.

- Add `instructions/rotate_authorities.rs`
  - Gated by `config.config_authority`.
  - Rotate one or more live role pubkeys: config, resolver, treasury, settlement, pause.
  - Do not rotate legacy `config.authority` unless implementation discovers a live authorization path. If that field remains inert metadata, emit and document that it is deprecated/non-authorizing before mainnet-RC.
  - If rotating `config_authority`, write all other requested changes before setting the new config authority, or use a two-step handoff. Recommendation for v1: one-step rotate with old authority signer and event, plus devnet test; document as multisig-controlled.
  - Emit `AuthorityRotated` per changed role.

- Add `instructions/sweep_treasury.rs`
  - Gated by `config.treasury_authority`.
  - Only sweeps from `protocol_treasury_vault` to a specified USDC token account owned by the treasury authority or approved recipient.
  - Validate mint and token program.
  - Emit `TreasurySwept`.
  - Do not sweep refund vaults, settlement author proceeds vaults, x402 settlement vault, voucher reward vaults, or author/vouch vaults.

### Existing instructions to edit

- `instructions/initialize_config.rs`
  - Add `resolver_authority` and `resolution_timelock_seconds` args or default resolver to `config_authority` in local/devnet init.
  - Tests/helpers must pass the new field.

- `instructions/create_refund_pool.rs`
  - Change authority check from `config_authority` to `resolver_authority` or allow permissionless execution if the proposal has matured and records refund parameters.
  - Recommendation: make `create_refund_pool` executable by anyone after dispute `Resolved`, but it must consume bounded proposal values from `AuthorDispute`. If a payer creates the refund vault, any cranker can pay rent; protocol state determines amounts.
  - Reject requested pool amounts above the matured proposal and formula cap.
  - Add `listing_settlement.bond_slashed_deposit_usdc_micros` to pool capacity, drain it as refund-only money, and decrement it on use.
  - Drain refund-only buckets before withdrawable author proceeds. Recommended ordering: `bond_slashed_deposit_usdc_micros`, then voucher `slashed_deposit_usdc_micros`, then withdrawable proceeds. The exact order is less important than test-proving neither slash bucket can become author-withdrawable or inflate challenger reward.
  - Compute the buyer refund pool before challenger reward. If available capacity is less than the purchase exposure, all available capacity goes to buyer refund and challenger reward is zero.
  - After the buyer-first refund pool is funded, compute capped challenger reward only from remaining eligible proceeds, using the economic snapshots stored on the dispute.
  - Route any residual paid-dispute slash bucket amount that exceeds buyer exposure to protocol treasury/reserve before clearing locks. It must not remain in settlement as author-withdrawable money.
  - Add or pair with an expiry/close path for unclaimed refund-pool funds after `refund_claim_window_seconds`; residual refund vault balance should route to protocol treasury/reserve with eventing, not strand permanently.
  - Keep current separation:
    - challenger reward base excludes `slashed_deposit_usdc_micros`
    - challenger reward base also excludes `bond_slashed_deposit_usdc_micros`
    - slashed deposits and bond-slashed deposits are refund-pool-only
    - withdrawable author proceeds stay separately accounted

- `instructions/slash_dispute_vouches.rs`
  - No authority changes expected; ensure finalization still leaves locks for `create_refund_pool` if a refund pool is required.
  - If A2 stores refund capacity/proposal fields that depend on voucher slash totals, update finalization to avoid marking a dispute fully settled before refund-pool creation constraints are satisfiable.
  - Use `author_dispute.slash_percentage_snapshot` rather than live `config.slash_percentage`, so slash pages cannot change economics after proposal or between pages.

- `instructions/migrate_config_m13.rs`
  - Do not extend M13 for A2 unless a separate migration plan redesigns same-program compatibility. A2 implementation should use a devnet clean break because `ReputationConfig`, `AuthorDispute`, and `ListingSettlement` all change layout, and the existing M13 migration gates on a moving `ReputationConfig::LEN`.

- `programs/agentvouch/src/lib.rs` and `instructions/mod.rs`
  - Register new instruction modules and entrypoints.

- `programs/agentvouch/src/events.rs`
  - Add:
    - `AuthorDisputeResolutionProposed`
    - `AuthorDisputeResolutionExecuted`
    - `ReputationConfigUpdated`
    - `AuthorityRotated`
    - `TreasurySwept`

## Refund Formula

The exact formula should be locked before implementation. Recommended v1:

- `max_purchase_refund_exposure = author_dispute.skill_price_usdc_micros_snapshot` when a purchase is attached; otherwise `0` until API/indexer can provide affected-revision volume.
- `available_refund_capacity = withdrawable_author_proceeds_usdc_micros + slashed_deposit_usdc_micros + bond_slashed_deposit_usdc_micros`.
- `proceeds_reward_base = withdrawable_author_proceeds_usdc_micros` only; slashed voucher deposits and paid-listing author-bond refund deposits must not inflate challenger reward.
- `buyer_first_refund_pool = min(requested_refund_pool_usdc_micros, max_purchase_refund_exposure, available_refund_capacity)`.
- `proceeds_used_for_refund = buyer_first_refund_pool.saturating_sub(slashed_deposit_usdc_micros + bond_slashed_deposit_usdc_micros)`.
- `remaining_eligible_proceeds_after_refund = withdrawable_author_proceeds_usdc_micros.saturating_sub(proceeds_used_for_refund)`.
- `max_challenger_reward = min(author_dispute.challenger_reward_cap_usdc_micros_snapshot, remaining_eligible_proceeds_after_refund * author_dispute.challenger_reward_bps_snapshot / 10_000)`.
- `max_free_listing_challenger_reward = min(author_dispute.challenger_reward_cap_usdc_micros_snapshot, author_bond_slash_usdc_micros * author_dispute.challenger_reward_bps_snapshot / 10_000)` for `AuthorBondOnly` disputes; residual slash goes to treasury/reserve.
- All reward math uses floor division in micro-USDC. The one-unit rounding residual remains with the source bucket until the instruction's residual routing step moves it to the correct owner.

Open question: paid listings can have many purchases per revision, but the current `AuthorDispute` stores only one optional `purchase` and one price snapshot. If A2 wants refund capacity for all affected buyers, implementation needs either an indexer-provided affected-volume input with stronger bounds or a later refund-reserve policy (A4). For mainnet-RC v1, keep the formula conservative and tied to the stored purchase/price snapshot unless A4 expands it.

Important A1 interaction: for paid disputes with linked vouches, actual voucher-slash funds are not known until `slash_dispute_vouches` finishes all pages. The proposal should record the ruling and a refund ceiling/intention; `create_refund_pool` must cap against the matured proposal **and** the actual post-slash settlement buckets (`withdrawable_author_proceeds_usdc_micros`, `slashed_deposit_usdc_micros`, and `bond_slashed_deposit_usdc_micros`).

Free-listing v1 answer: `AuthorBondOnly` disputes do not create refund pools. Upheld author-bond slash returns the challenger dispute-bond principal, pays a capped challenger reward from the author-bond slash, and routes the residual slash to protocol treasury/reserve with eventing that makes the split auditable. A4 may later redirect treasury/reserve policy, but A2 should not imply free-skill buyer refunds exist.

Paid no-purchase v1 answer: paid-listing disputes without an attached verified purchase are reputation-only in A2 v1. They do not create refund pools, do not slash vouchers, do not pay challenger rewards, and must clear listing/settlement locks at resolution. Financial settlement for affected paid buyers without a single attached purchase is deferred to A4/indexer-backed affected-buyer scope.

Residual funds answer: paid slash funds are buyer-refund-first, then capped challenger reward from remaining eligible proceeds, then protocol treasury/reserve. Expired unclaimed refund-pool balances must have an explicit close/sweep path after the claim window. No paid slash bucket or expired refund balance may become author-withdrawable by default.

## Implementation Steps

1. **Lock constants and account-layout strategy.**
   - Choose `DEFAULT_RESOLUTION_TIMELOCK_SECONDS` (48h = 172_800 or 72h = 259_200).
   - For local Anchor tests, initialize or set the timelock to a very short nonzero value so early-execute failure and post-delay success are both testable without waiting hours.
   - Use a clean-break devnet program ID rather than config realloc/migration for A2. Same-program migration is out of scope unless a separate migration plan proves compatibility for config, disputes, and settlements.
   - Decide whether `execute_author_dispute_resolution` is permissionless after timelock. Recommendation: yes.

2. **Add state and events.**
   - Update `ReputationConfig` and `AuthorDispute`.
   - Update initialization and tests helper defaults.
   - Add event structs with enough fields for indexers: dispute, author, proposer/executor, ruling, executable timestamp, refund amount, reward amount, slash totals.

3. **Add config governance instructions.**
   - Implement `update_config` with all invariant checks.
   - Implement `rotate_authorities`.
   - Implement `sweep_treasury`.
   - Add tests before touching dispute flow so authority invariants are isolated.

4. **Split dispute resolution.**
   - Move current validation from `resolve_author_dispute.rs` into shared helpers if it keeps propose/execute small.
   - `propose_*` records only.
   - `execute_*` performs the current state/fund transitions after timelock, with A2 routing changes.
   - Keep A1 `SlashingVouchers` behavior intact.

5. **Route author-bond slash to refund-first capacity.**
   - Stop transferring author-bond slash directly to challenger.
   - Paid disputes: transfer author-bond slash into the disputed listing's author proceeds vault and track it in `bond_slashed_deposit_usdc_micros`.
   - Free disputes: pay a capped challenger reward from the author-bond slash and transfer only the residual slash to `protocol_treasury_vault`; there is no settlement/refund pool to fund.
   - Document the chosen custody path in readiness docs and tests.

6. **Constrain refund pool creation.**
   - Require mature proposal state.
   - Cap requested amount against formula and proposal.
   - Apply buyer-first allocation before challenger reward in underfunded cases.
   - Add residual slash and expired refund-pool routing to protocol treasury/reserve.
   - Preserve slashed-deposit first-drain behavior from A1.

7. **IDL and clients.**
   - Run `NO_DNA=1 anchor build`.
   - Copy `target/idl/agentvouch.json` to `web/agentvouch.json`.
   - Run `npm run generate:client`.
   - Update curated web entrypoints and call sites, especially `web/hooks/useReputationOracle.ts` resolver authorization copy and actions.

8. **Docs/runbooks.**
   - Update readiness docs only after behavior is implemented and verified.
   - Update `web/public/skill.md` after the program/client state reflects the new flow.
   - Add authority policy and smoke commands to `docs/PRODUCTION_RUNBOOK.md`.

## Test Matrix

Add/extend Anchor tests, likely in `tests/agentvouch-usdc-disputes.ts` plus slashing regressions in `tests/agentvouch-usdc-slashing.ts`:

1. **Resolver split:** `config_authority` cannot propose/execute unless it is also `resolver_authority`; resolver cannot update config.
2. **Propose only:** proposal records ruling/refund/executable timestamp and moves no USDC; dispute remains unfinalized.
3. **Timelock and locks:** execution before `executable_at` fails; after clock advance / local validator wait succeeds; author proceeds withdrawal remains blocked during the full proposed/pending window.
4. **Dismissed execution:** dispute bond moves to treasury, locks clear, counters/reputation update, no refund pool.
5. **Upheld free-listing:** author bond slash returns challenger principal, pays only the capped challenger reward, routes residual slash to protocol treasury, performs no voucher slashing, creates no refund pool, and resolves without `SlashingVouchers`.
6. **Upheld paid listing with vouchers:** proposal → execute parks in `SlashingVouchers`; slash pages still work; refund pool respects proposal/formula.
7. **Buyer-first underfunded paid dispute:** when capacity is below purchase exposure, all capacity goes to the refund pool and challenger reward is zero.
8. **Challenger reward cap:** reward never exceeds snapshot bps/cap, pays only after buyer-first refund allocation, and excludes slashed voucher/bond refund buckets.
9. **Refund amount bounds:** impossible overlarge proposed/requested refund fails or clamps per decided behavior.
10. **Paid no-purchase dispute:** upheld paid dispute without attached purchase clears locks without voucher slashing, refund pool creation, or challenger reward.
11. **Residual/expired funds:** slash over buyer exposure and unclaimed refund-pool balances after the claim window route to protocol treasury/reserve and cannot be withdrawn by the author.
12. **Economic snapshots:** config changes after proposal do not alter slash percentage, challenger reward bps/cap, or multi-page slash outcomes for that dispute.
13. **Authority rotation:** rotate resolver/config/treasury/settlement/pause authorities; old authority fails, new authority succeeds; events emitted.
14. **Legacy root authority:** prove `config.authority` is not accepted for any new A2 privileged path, or if made live, prove it rotates and old authority fails.
15. **Config setters:** invalid share sums, slash >100, negative windows/timelock, and bps >10_000 fail.
16. **Treasury sweep:** treasury authority can sweep only protocol treasury vault; wrong mint/owner/authority fail.
17. **A1 regressions:** multi-page slash, stale position skip-settle, ring-fenced slashed deposits, and remove/close dispute locks remain green.

## Verification

Local:

- `NO_DNA=1 anchor build`
- `NO_DNA=1 anchor test`
- Copy `target/idl/agentvouch.json` to `web/agentvouch.json`
- `npm run generate:client`
- `npm run test --workspace @agentvouch/web`
- `npm run test --workspace @agentvouch/cli`
- `npm run build --workspace @agentvouch/web`
- `npm run build --workspace @agentvouch/cli`
- `npm run build`
- `git diff --check`

Devnet smoke before mainnet-RC:

- Clean-state publish/vouch/purchase/report/propose/wait-or-test-timelock/execute/slash/refund/claim path.
- Authority rotation smoke on devnet, including resolver authority and config authority.
- Treasury sweep smoke only with a tiny known treasury balance and explicit operator approval.

Security review checklist:

- All USDC-moving instructions validate token mint, token owner, PDA seeds, and authority signer.
- Timelock uses `Clock::get()` and handles nonpositive/default config sanely.
- No instant dispute-resolution bypass remains.
- No authority can silently mutate user claims outside documented scope.
- Refund/reward accounting remains conservation-of-value testable.

## Rollout

Recommended rollout path:

1. Implement and verify on local validator.
2. Deploy to devnet as a clean break if account layout migration would require broad realloc/backfill.
3. Initialize config with separate role keys, then rotate resolver/config/treasury/pause/settlement to the intended devnet multisig/test signers.
4. Run clean devnet smoke twice from fresh state.
5. Update `docs/DEVNET_STATE.md` with program ID, config pubkeys, smoke txs, IDL hash, and known limitations.
6. Only then update `docs/MAINNET_READINESS.md` from "blocked" to "A2 devnet-live / pending review" if evidence supports it.

Mainnet remains no-go until A3 pause, A4 refund reserve policy, external/senior security review, authority custody, and repeated clean smokes are complete.

## Rollback

Pre-mainnet:

- If deployed as clean-break devnet program, rollback by pointing web/env/docs back to the previous devnet program/config and restoring the previous Neon state snapshot or cleanup script output.
- If same-program upgrade is used, rollback requires redeploying the previous `.so` and ensuring clients/IDL match; do not use same-program upgrade unless account compatibility is proven.
- Never use `git reset --hard` or destructive DB cleanup as rollback without explicit operator approval and a saved state/export.

Mainnet:

- Not applicable for this plan until mainnet-RC gates pass. Mainnet rollback policy must be written in the production runbook before deployment.

## Blockers / Open Questions

- **Timelock duration:** choose 48h or 72h for mainnet default. Tests can use shorter local config if setter supports it.
- **Affected buyer scope:** current dispute stores one optional purchase and price snapshot; full affected-revision refund pools need API/indexer support or a later A4 reserve policy.
- **Multisig integration:** on-chain program can store a Squads multisig pubkey as authority, but actual Squads setup/rotation is operational work outside the program. Runbook must name signer set, threshold, and emergency rotation procedure.

Resolved by 2026-06-17 extra review:

- **Compatibility strategy:** A2 is a devnet clean break. Same-program migration is out of scope unless a separate plan proves compatibility for config, dispute, and settlement account layouts.
- **Paid refund-first formula:** buyer refund exposure is allocated before challenger reward; reward is zero in underfunded cases.
- **Paid no-purchase disputes:** reputation-only in A2 v1; no voucher slashing, no refund pool, no challenger reward, and locks clear at resolution.
- **Residual/expired funds:** residual paid slash funds and expired unclaimed refund-pool balances route to protocol treasury/reserve, never to author withdrawals.
- **Economic snapshots:** proposal snapshots settlement economics; execute, voucher slash pages, and refund creation use those snapshots instead of live mutable config.
