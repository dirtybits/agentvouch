---
name: a1-voucher-slashing
overview: "Implement resolve-time voucher slashing (roadmap A1 / readiness P0.1): paged slash of the disputed listing's linked vouch positions into a ring-fenced settlement balance, with listing-scoped link/unlink freezes and permissionless cranking."
todos:
  - id: state-changes
    content: Add SlashingVouchers dispute status, slashed_deposit_usdc_micros to ListingSettlement, and rent_payer to AuthorDisputeVouchLink; adjust LEN constants
    status: pending
  - id: freeze-membership
    content: Add listing-scoped dispute locks to link_vouch_to_listing and unlink_vouch_from_listing (settlement.locked_by_dispute)
    status: pending
  - id: resolve-parks-dispute
    content: Rework resolve_author_dispute(Upheld) to park paid disputes with active positions in SlashingVouchers and defer open_author_disputes decrement
    status: pending
  - id: slash-instruction
    content: Add permissionless slash_dispute_vouches instruction (≤8 positions per call, link-PDA init as double-slash guard, transfers to author proceeds vault, finalization on last page)
    status: pending
  - id: ring-fence-refund-pool
    content: Update create_refund_pool and withdraw_author_proceeds so slashed_deposit_usdc_micros is refund-pool-only and excluded from the challenger reward base
    status: pending
  - id: residual-reclaim
    content: Allow revoke_vouch to reclaim residual stake from a Slashed vouch once the author has no open disputes
    status: pending
  - id: events-and-clients
    content: Add VoucherSlashed event, register instructions in lib.rs, rebuild IDL, regenerate web client
    status: pending
  - id: tests
    content: Add Anchor test coverage per the test matrix (happy path, multi-page, dodge attempts, double-crank, dismissed no-op, stale-position skip, residual reclaim, ring-fence)
    status: pending
  - id: docs-sync
    content: Update MAINNET_READINESS.md P0.1 design note and AGENTS.md liability-scope fact to match the decided design
    status: pending
---

# A1 — Voucher Slashing

## Goal

Upheld disputes on paid listings slash the vouchers who linked stake to that listing, making vouching carry real downside (the core stake-backed-reputation mechanism). Slashed funds are ring-fenced for harmed buyers — never withdrawable by the author, never inflating the challenger reward.

Design decisions locked 2026-06-09 (with Andy):

1. **Ring-fence slashed funds** in a new `ListingSettlement.slashed_deposit_usdc_micros` — refund-pool-only.
2. **Dead position on slash** — `VouchStatus::Slashed` stops backing and earning; residual stake reclaimable via `revoke_vouch` once the author has no open disputes.
3. **Listing-scoped membership freeze** — both `link_vouch_to_listing` and `unlink_vouch_from_listing` blocked while the listing's settlement is `locked_by_dispute`. (The money exit is already locked author-wide by the `revoke_vouch` open-dispute guard; this freeze is about slash-set membership.)
4. **Permissionless crank** — `slash_dispute_vouches` pages execute a recorded ruling deterministically; anyone may call.

## Scope

- In scope: `programs/agentvouch/` state + instructions, Anchor tests, IDL/client regen, readiness-doc design note sync.
- Out of scope: A2 governance changes (resolver split, timelock, multisig), refund reserve policy (A4), web UI for slash records, cleanup instruction for stale Revoked-vouch positions (note as follow-up), devnet redeploy/migration execution (plan assumes the established clean-break process in AGENTS.md when it ships).

## Key existing structures (verified 2026-06-09)

- `AuthorDispute` already has `linked_vouch_count`, `processed_vouch_count`, `voucher_slashed_usdc_micros` (all currently set to 0 and never updated) — the paging bookkeeping exists.
- `AuthorDisputeVouchLink` (`state/author_dispute_vouch_link.rs`) is defined, never created. Has `settled: bool`. **No `rent_payer` field — add one** (permissionless cranker pays rent; record who, for any future close path).
- `MAX_DISPUTE_POSITIONS_PER_TX = 8` and `MAX_ACTIVE_REWARD_POSITIONS_PER_LISTING = 32` in `state/skill_listing.rs` — slash set ≤ 32 positions, ≤ 4 crank pages.
- `VouchStatus::Slashed` and `ListingVouchPositionStatus::Slashed` exist, never assigned.
- `resolve_author_dispute.rs` slashes only the author bond (to the challenger — A2 changes that destination, not this plan) and decrements `open_author_disputes` immediately.
- `unlink_vouch_from_listing.rs` has **no dispute lock** (verified: constraints only check wiring) — the dodge hole this plan closes.
- `revoke_vouch.rs` requires `vouch.status.is_live()` and `vouchee_profile.open_author_disputes == 0`; calls `accrue_author_rewards` before mutating stake.
- `revoke_vouch` does **not** require `linked_listing_count == 0`, so `Active` positions with a `Revoked` underlying vouch can exist — slash pages need skip-settle semantics.
- `create_refund_pool.rs` computes `available = settlement.withdrawable_author_proceeds_usdc_micros`, takes `max_challenger_reward = available * challenger_reward_bps / 10_000`, capped.

## Files To Change

### State

- `state/author_dispute.rs`: add `AuthorDisputeStatus::SlashingVouchers` variant (append; existing discriminants unchanged).
- `state/settlement.rs`: add `slashed_deposit_usdc_micros: u64` to `ListingSettlement`; bump `LEN` by 8.
- `state/author_dispute_vouch_link.rs`: add `rent_payer: Pubkey`; bump `LEN` by 32. Seeds: `[b"dispute_vouch_link", author_dispute.key(), vouch.key()]` — **PDA init is the double-slash guard** (second attempt on the same vouch fails account-exists).
- `state/vouch.rs`: no layout change. Note `VouchStatus::Slashed` already returns `false` from `is_live()` and `counts_toward_author_wide_backing_snapshot()` — backing/reward exclusion is free.

### Instructions

- `instructions/link_vouch_to_listing.rs` + `instructions/unlink_vouch_from_listing.rs`: require the listing's current settlement account and `require!(settlement.locked_by_dispute.is_none(), ...ListingDisputeLocked)`. Settlement PDA is derivable from `skill_listing.current_settlement`.
- `instructions/resolve_author_dispute.rs` (Upheld + `AuthorBondThenVouchers` only):
  - Add `skill_listing` account to the context; validate against `author_dispute.skill_listing`.
  - Set `linked_vouch_count = skill_listing.active_reward_position_count` (frozen since open by the membership locks).
  - If `linked_vouch_count > 0`: set `status = SlashingVouchers`, do **not** decrement `open_author_disputes`, do **not** clear `settlement.locked_by_dispute`. Bond slash, dispute-bond transfer, and ruling recording happen as today.
  - If `linked_vouch_count == 0` (or Dismissed): behave exactly as today (straight to `Resolved`).
- **New** `instructions/slash_dispute_vouches.rs`:
  - Fixed accounts: `author_dispute` (status == `SlashingVouchers`), `author_profile`, `config`, `usdc_mint`, `skill_listing`, `listing_settlement` (the disputed one, `locked_by_dispute == Some(dispute)`), `author_proceeds_vault` + its authority PDA, `cranker: Signer` (pays link rent, no authority check — permissionless), `token_program`, `system_program`.
  - Remaining accounts: up to `MAX_DISPUTE_POSITIONS_PER_TX` (8) triples of `(listing_vouch_position, vouch, vouch_vault)` plus the link PDA to init per position (4 accounts per position; 8 positions ≈ 32 remaining accounts — verify tx size in tests; drop the per-page max to 6 if needed).
  - Per position: validate `position.skill_listing == dispute.skill_listing` and position status `Active`; init link PDA (`settled = true`, `rent_payer = cranker`).
    - If `vouch.status == Active`: call `accrue_author_rewards` (mirror `revoke_vouch` — settle reward index before stake mutation), compute `slash = vouch.stake_usdc_micros * config.slash_percentage / 100`, transfer vouch vault → `author_proceeds_vault` (vouch-vault-authority PDA signer, same seeds as `revoke_vouch`), then: `vouch.stake_usdc_micros -= slash`, `vouch.status = Slashed`, `position.status = Slashed`, `vouchee profile total_vouch_stake_usdc_micros -= slash`... **correction:** decrement the profile by the **full pre-slash stake**, not just the slash amount — a Slashed vouch no longer counts toward backing at all (decision 2), and `counts_toward_author_wide_backing_snapshot()` already excludes it; profile aggregate must match. Also decrement `skill_listing.active_reward_stake_usdc_micros` by `position.reward_stake_usdc_micros` and `active_reward_position_count` by 1.
    - If `vouch.status != Active` (stale position from a pre-dispute revoke): skip-settle — link created, zero transfer, `position.status = Slashed` (or `Unlinked`; pick one and assert it in tests), counts toward `processed_vouch_count`.
  - Page bookkeeping: `processed_vouch_count += n`, `voucher_slashed_usdc_micros += sum`, `settlement.slashed_deposit_usdc_micros += sum`.
  - Finalization when `processed_vouch_count == linked_vouch_count`: `status = Resolved`, decrement `author_profile.open_author_disputes`, recompute `reputation_score`. Keep `settlement.locked_by_dispute` set (matches today's Upheld behavior; `create_refund_pool` operates on the locked settlement).
  - Emit `VoucherSlashed` event per position (voucher, vouch, dispute, slash amount, residual).
- `instructions/create_refund_pool.rs`:
  - Require `dispute.status == Resolved` (already does — `SlashingVouchers` disputes can't create pools early; add a test).
  - Challenger reward base: `withdrawable_author_proceeds_usdc_micros` **only** (unchanged variable, now explicitly excluding slashed deposits).
  - Pool capacity: `withdrawable_author_proceeds - max_challenger_reward + slashed_deposit_usdc_micros`; fund the refund vault from both buckets, drain `slashed_deposit_usdc_micros` first (ring-fenced money must be the first money out), zero it as consumed.
- `instructions/withdraw_author_proceeds.rs`: confirm withdrawal amount derives from `withdrawable_author_proceeds_usdc_micros` and never touches `slashed_deposit_usdc_micros` (it should already, since the new field is separate — add an explicit test).
- `instructions/revoke_vouch.rs`: change the status constraint from `is_live()` to `matches!(status, Active | Slashed)` for **reclaim**: when status is `Slashed`, skip `accrue_author_rewards` reward accrual into pending (position already dead), transfer the residual `stake_usdc_micros`, set status `Revoked`, and do **not** double-decrement `total_vouch_stake_usdc_micros` (already removed at slash time). The existing `open_author_disputes == 0` guard stays and is what makes reclaim safe.
- `events.rs`: add `VoucherSlashed { author_dispute, vouch, voucher, vouchee, slash_usdc_micros, residual_stake_usdc_micros, timestamp }`.
- `lib.rs`: register `slash_dispute_vouches`.

### After program changes

- `NO_DNA=1 anchor build`; copy `target/idl/agentvouch.json` → `web/agentvouch.json`; `npm run generate:client` (curated entrypoints per AGENTS.md — no hand-edits to Codama output).

## Test Matrix (`tests/agentvouch-usdc-disputes.ts`, extending the existing upheld → bond-slash → refund-claim coverage)

1. **Happy path:** 2 linked vouchers, upheld → one crank page slashes both at `slash_percentage`, funds land in `slashed_deposit_usdc_micros`, dispute `Resolved`, `open_author_disputes == 0`, reputation recomputed, profile `total_vouch_stake` drops by full stakes.
2. **Multi-page:** 10+ positions → first crank (8) leaves `SlashingVouchers`, second completes; assert intermediate state (locks still live mid-slash: revoke and unlink both fail between pages).
3. **Dodge attempts:** unlink during open dispute fails; link during open dispute fails; revoke during `SlashingVouchers` fails.
4. **Double-crank:** same position in two pages → second fails on link PDA init; no double transfer.
5. **Dismissed:** no link PDAs, no transfers, statuses/locks identical to current behavior (regression).
6. **Stale position:** revoke vouch pre-dispute (legal), open dispute, uphold → skip-settle page converges, zero slash for that position.
7. **Residual reclaim:** post-resolution, slashed voucher revokes → receives exactly `stake - slash`, profile aggregates unchanged by the reclaim.
8. **Ring-fence:** post-slash, `withdraw_author_proceeds` cannot touch slashed deposits; `create_refund_pool` challenger reward computed on proceeds-only base; refund pool drains slashed deposits first; `create_refund_pool` rejected while still `SlashingVouchers`.
9. **Free-listing dispute (regression):** `AuthorBondOnly` path untouched end to end.

Verification commands: `NO_DNA=1 anchor build`, `anchor test` (full suite — bonds-vouches, disputes, marketplace, usdc must stay green), then `npx tsc --noEmit` + `npm run test` in `web/` after client regen.

## Rollout

Devnet clean break per AGENTS.md if account layouts force it — note `ListingSettlement` and `AuthorDisputeVouchLink` layout changes affect only new accounts (`AuthorDisputeVouchLink` has zero existing instances; existing `ListingSettlement` accounts would deserialize short). Decide at implementation time: fresh program ID + DB cleanup (established process) vs. an M15-style settlement migration instruction. Default to clean break while devnet-only.

## Rollback

Pre-mainnet, devnet-only: redeploy previous program build and restore DB links per the clean-break runbook. No mainnet rollback path needed yet — that's the point of doing this now.

## Blockers / Open Items

- Tx-size check for 8 positions × 4 accounts + fixed accounts (~40 total) — if over the limit, reduce `MAX_DISPUTE_POSITIONS_PER_TX`. Test 2 proves the real bound.
- `accrue_author_rewards` interaction: confirm reward-index accrual on the *author-wide* vouch is correct when the position (listing-level reward stake) is being killed in the same instruction — read `claim_voucher_revenue.rs` accrual math before implementing; if position rewards have unclaimed `pending_rewards_usdc_micros`, decide whether the slashed voucher keeps them (recommend: yes, earned pre-slash) — assert in test 1.
- A2 will redirect the author-bond slash destination (challenger → refund pool). This plan deliberately leaves the bond destination unchanged to keep A1 reviewable; do not "fix" it here.
