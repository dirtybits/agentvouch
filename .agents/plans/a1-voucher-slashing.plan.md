---
name: a1-voucher-slashing
overview: "Implement resolve-time voucher slashing (roadmap A1 / readiness P0.1): paged slash of the disputed listing's linked vouch positions into a ring-fenced settlement balance, with listing-scoped link/unlink freezes and permissionless cranking."
todos:
  - id: state-changes
    content: Add SlashingVouchers dispute status, slashed_deposit_usdc_micros to ListingSettlement, rent_payer to AuthorDisputeVouchLink, and locked_by_dispute mirror to SkillListing; adjust LEN constants
    status: completed
  - id: freeze-membership
    content: Set/clear the SkillListing.locked_by_dispute mirror and enforce it in link_vouch_to_listing, unlink_vouch_from_listing, update_skill_listing (revision bumps), and initialize_listing_settlement — closes the settlement-rotation bypass
    status: completed
  - id: reward-accrual-guard
    content: Add a non-live status guard to accrue_author_rewards so Slashed/Revoked vouches stop accruing author-wide rewards on residual stake (prevents reward-vault insolvency)
    status: completed
  - id: resolve-parks-dispute
    content: Rework resolve_author_dispute(Upheld) to park paid disputes with active positions in SlashingVouchers and defer open_author_disputes decrement
    status: completed
  - id: slash-instruction
    content: Add permissionless slash_dispute_vouches instruction (start at ≤4 positions per call — 5 remaining accounts per position; link-PDA init as double-slash guard, transfers to author proceeds vault, finalization on last page)
    status: completed
  - id: ring-fence-refund-pool
    content: Update create_refund_pool and withdraw_author_proceeds so slashed_deposit_usdc_micros is refund-pool-only and excluded from the challenger reward base; relax the available>0 require so slashed-only pools work
    status: completed
  - id: residual-reclaim
    content: Allow revoke_vouch to reclaim residual stake from a Slashed vouch once the author has no open disputes
    status: completed
  - id: events-and-clients
    content: Add VoucherSlashed and AuthorDisputeSlashingFinalized events, register instructions in lib.rs, rebuild IDL, regenerate web client
    status: completed
  - id: tests
    content: Add Anchor test coverage per the test matrix (happy path, multi-page, dodge attempts incl. settlement rotation, double-crank, dismissed no-op, stale-position skip, residual reclaim, ring-fence, post-slash reward accrual)
    status: completed
  - id: docs-sync
    content: Update MAINNET_READINESS.md P0.1 design note and AGENTS.md liability-scope fact to match the decided design
    status: completed
---

# A1 — Voucher Slashing

## Goal

Upheld disputes on paid listings slash the vouchers who linked stake to that listing, making vouching carry real downside (the core stake-backed-reputation mechanism). Slashed funds are ring-fenced for harmed buyers — never withdrawable by the author, never inflating the challenger reward.

Design decisions locked 2026-06-09 (with Andy):

1. **Ring-fence slashed funds** in a new `ListingSettlement.slashed_deposit_usdc_micros` — refund-pool-only.
2. **Dead position on slash** — `VouchStatus::Slashed` stops backing and earning; residual stake reclaimable via `revoke_vouch` once the author has no open disputes.
3. **Listing-scoped membership freeze** — both `link_vouch_to_listing` and `unlink_vouch_from_listing` blocked while the listing is dispute-locked. (The money exit is already locked author-wide by the `revoke_vouch` open-dispute guard; this freeze is about slash-set membership.)
4. **Permissionless crank** — `slash_dispute_vouches` pages execute a recorded ruling deterministically; anyone may call.

Review amendments (2026-06-09, plan review against source — design intent unchanged, mechanics corrected):

- **R1 — rotation-proof freeze.** Checking `locked_by_dispute` on the settlement derived from `skill_listing.current_settlement` is bypassable: `update_skill_listing` bumps `current_revision` with no dispute guard, and `initialize_listing_settlement` then mints a fresh **unlocked** settlement and repoints `current_settlement` at it (both verified in source). Fix: add a `locked_by_dispute: Option<Pubkey>` mirror on `SkillListing` itself, set at `open_author_dispute`, cleared wherever the settlement lock clears; freeze checks read the listing field, and revision bumps + new-settlement init are blocked while it is set. Side benefit: this also closes the pre-existing sell-mid-dispute hole (rotation let purchases resume on the fresh settlement, escaping the refund lock).
- **R2 — slashed vouches do not stop earning for free.** `counts_toward_author_wide_backing_snapshot()` only affects backing snapshots. The reward flow is `purchase_skill` distributing the voucher pool over `author_profile.total_vouch_stake_usdc_micros` (denominator) while `accrue_author_rewards` accrues per-vouch on `vouch.stake_usdc_micros` with **no status check**. Removing the full pre-slash stake from the profile while leaving the residual in `vouch.stake_usdc_micros` makes collective accruals exceed `unclaimed_voucher_revenue` → reward-vault insolvency (last claimer's `checked_sub` underflows). Fix: guard `accrue_author_rewards` — if `!vouch.status.is_live()`, sync `entry_author_reward_index_x1e12` and return. Pre-slash `pending_rewards_usdc_micros` stays claimable (earned pre-slash, per the open-items recommendation).
- **R3 — 5 remaining accounts per position, not 4.** Each slash transfer needs the position's `vouch_vault_authority` PDA as CPI signer, and its seeds are per-voucher (`["vouch_vault_authority", voucher_profile, vouchee_profile]`) so it cannot be shared. 8 positions × 5 + ~11 fixed ≈ 51 unique keys ≈ 1.6 KB of pubkeys — over the 1232-byte tx limit. Start `MAX_DISPUTE_POSITIONS_PER_TX` at 4 (≤ 8 pages at the 32-position cap); test 2 proves the real bound.
- **R4 — skip-settle must also decrement listing aggregates.** A stale position (vouch revoked pre-dispute) still has nonzero `reward_stake_usdc_micros` counted in `active_reward_stake_usdc_micros` / `active_reward_position_count` (`revoke_vouch` never touches positions). The skip-settle branch must decrement both, mirroring `unlink_vouch_from_listing`, or the listing counters stay wrong forever and the dead position keeps a phantom share of the listing reward index. Skip-settle status: `Slashed` (decided — distinguishes dispute-killed from voluntary unlink for indexers).
- **R5 — refund-pool strand.** `create_refund_pool` requires `withdrawable_author_proceeds_usdc_micros > 0`; if the author withdrew everything before the dispute opened, slashed deposits would strand. Relax to `withdrawable + slashed_deposit > 0` and let the pool fund from slashed deposits alone.

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
- `create_refund_pool.rs` computes `available = settlement.withdrawable_author_proceeds_usdc_micros`, takes `max_challenger_reward = available * challenger_reward_bps / 10_000`, capped. Requires `available > 0` — must relax per R5.
- `update_skill_listing.rs` bumps `current_revision` on content change with **no dispute guard**; `initialize_listing_settlement.rs` `init`s a settlement at the new revision seed with `locked_by_dispute = None` and repoints `skill_listing.current_settlement` — the R1 rotation bypass. `open_author_dispute.rs` already has `skill_listing` in its context (not `mut` — add `mut`); `create_refund_pool.rs` has it too (also needs `mut` to clear the mirror).
- `accrue_author_rewards` (`claim_voucher_revenue.rs`) accrues on `vouch.stake_usdc_micros` with no status check; `purchase_skill.rs` computes the reward index delta over `author_profile.total_vouch_stake_usdc_micros` — the R2 insolvency pair.
- `vouch_vault_authority` PDA seeds are `["vouch_vault_authority", voucher_profile, vouchee_profile]` (`revoke_vouch.rs`) — per-voucher, so each slash page position needs its own authority account (R3).

## Files To Change

### State

- `state/author_dispute.rs`: add `AuthorDisputeStatus::SlashingVouchers` variant (append; existing discriminants unchanged).
- `state/settlement.rs`: add `slashed_deposit_usdc_micros: u64` to `ListingSettlement`; bump `LEN` by 8.
- `state/author_dispute_vouch_link.rs`: add `rent_payer: Pubkey`; bump `LEN` by 32. Seeds: `[b"dispute_vouch_link", author_dispute.key(), vouch.key()]` — **PDA init is the double-slash guard** (second attempt on the same vouch fails account-exists).
- `state/vouch.rs`: no layout change. `VouchStatus::Slashed` already returns `false` from `is_live()` and `counts_toward_author_wide_backing_snapshot()` — but that only covers backing snapshots, **not** reward accrual (see R2; the accrual guard is a separate change in `claim_voucher_revenue.rs`).
- `state/skill_listing.rs`: add `locked_by_dispute: Option<Pubkey>` to `SkillListing` (R1 mirror of the settlement lock); bump `LEN` by 33. Reduce `MAX_DISPUTE_POSITIONS_PER_TX` from 8 to 4 (R3).

### Instructions

- `instructions/open_author_dispute.rs`: mark `skill_listing` as `mut`; alongside the existing settlement lock, set `skill_listing.locked_by_dispute = Some(author_dispute.key())` (require it `None` first, same as the settlement check).
- `instructions/link_vouch_to_listing.rs` + `instructions/unlink_vouch_from_listing.rs`: `require!(skill_listing.locked_by_dispute.is_none(), ...ListingDisputeLocked)` — the listing is already in both contexts, so no settlement account is needed (R1: do **not** key this on `current_settlement`, that's the rotation bypass).
- `instructions/update_skill_listing.rs`: when `revision_changed`, require `skill_listing.locked_by_dispute.is_none()` (R1 — revision bumps are the rotation primitive; non-revision updates stay allowed).
- `instructions/initialize_listing_settlement.rs`: require `skill_listing.locked_by_dispute.is_none()` (R1 — no fresh unlocked settlement mid-dispute).
- Clearing the mirror: wherever `settlement.locked_by_dispute` clears today — `resolve_author_dispute` (Dismissed) and `create_refund_pool` — also clear `skill_listing.locked_by_dispute` (`skill_listing` needs `mut` in both; resolve gains the account below anyway).
- `instructions/resolve_author_dispute.rs` (Upheld + `AuthorBondThenVouchers` only):
  - Add `skill_listing` account (`mut`) to the context; validate against `author_dispute.skill_listing`.
  - Set `linked_vouch_count = skill_listing.active_reward_position_count` (frozen since open by the membership locks).
  - If `linked_vouch_count > 0`: set `status = SlashingVouchers`, do **not** decrement `open_author_disputes`, do **not** clear `settlement.locked_by_dispute`. Bond slash, dispute-bond transfer, and ruling recording happen as today.
  - If `linked_vouch_count == 0` (or Dismissed): behave exactly as today (straight to `Resolved`).
- **New** `instructions/slash_dispute_vouches.rs`:
  - Fixed accounts: `author_dispute` (status == `SlashingVouchers`), `author_profile`, `config`, `usdc_mint`, `skill_listing`, `listing_settlement` (the disputed one, `locked_by_dispute == Some(dispute)`), `author_proceeds_vault` + its authority PDA, `cranker: Signer` (pays link rent, no authority check — permissionless), `token_program`, `system_program`.
  - Remaining accounts: up to `MAX_DISPUTE_POSITIONS_PER_TX` (now 4, per R3) groups of `(listing_vouch_position, vouch, vouch_vault, vouch_vault_authority, link PDA to init)` — **5 accounts per position** (the vault authority is a per-voucher PDA signer and cannot be shared). 4 positions × 5 + ~11 fixed ≈ 31 unique keys fits the 1232-byte limit with headroom; test 2 proves whether 5 also fits.
  - Per position: validate `position.skill_listing == dispute.skill_listing` and position status `Active`; init link PDA (`settled = true`, `rent_payer = cranker`).
    - If `vouch.status == Active`: call `accrue_author_rewards` (mirror `revoke_vouch` — settle reward index before stake mutation), compute `slash = vouch.stake_usdc_micros * config.slash_percentage / 100`, transfer vouch vault → `author_proceeds_vault` (vouch-vault-authority PDA signer, same seeds as `revoke_vouch`), then: `vouch.stake_usdc_micros -= slash`, `vouch.status = Slashed`, `position.status = Slashed`, `vouchee profile total_vouch_stake_usdc_micros -= slash`... **correction:** decrement the profile by the **full pre-slash stake**, not just the slash amount — a Slashed vouch no longer counts toward backing at all (decision 2), and `counts_toward_author_wide_backing_snapshot()` already excludes it; profile aggregate must match. Also settle the position itself: call `accrue_position_rewards` (from `unlink_vouch_from_listing.rs` — preserves earned listing rewards), zero `position.reward_stake_usdc_micros`, and decrement `skill_listing.active_reward_stake_usdc_micros` by the position stake and `active_reward_position_count` by 1.
    - If `vouch.status != Active` (stale position from a pre-dispute revoke): skip-settle — link created, zero transfer, `position.status = Slashed` (decided, R4), counts toward `processed_vouch_count`. **Also decrement the listing aggregates** (R4): call `accrue_position_rewards` first (mirror `unlink_vouch_from_listing`), then zero `position.reward_stake_usdc_micros` and decrement `skill_listing.active_reward_stake_usdc_micros` / `active_reward_position_count` — same as the Active branch.
  - Page bookkeeping: `processed_vouch_count += n`, `voucher_slashed_usdc_micros += sum`, `settlement.slashed_deposit_usdc_micros += sum`.
  - Finalization when `processed_vouch_count == linked_vouch_count`: `status = Resolved`, decrement `author_profile.open_author_disputes`, recompute `reputation_score`. Keep `settlement.locked_by_dispute` **and** the listing mirror set (matches today's Upheld behavior; `create_refund_pool` operates on the locked settlement and clears both).
  - Emit `VoucherSlashed` event per position (voucher, vouch, dispute, slash amount, residual), and `AuthorDisputeSlashingFinalized` on the last page with the final `voucher_slashed_usdc_micros` total — the `AuthorDisputeResolved` event fired at resolve time reports `voucher_slashed_usdc_micros = 0` for parked disputes, so indexers need the finalization event for the true total.
- `instructions/claim_voucher_revenue.rs`: guard `accrue_author_rewards` (R2) — if `!vouch.status.is_live()`, sync `entry_author_reward_index_x1e12` to the profile index and return without accruing. Pre-slash `pending_rewards_usdc_micros` remains claimable through the existing handler (no status constraint on claim — intentional, the rewards were earned pre-slash).
- `instructions/create_refund_pool.rs`:
  - Require `dispute.status == Resolved` (already does — `SlashingVouchers` disputes can't create pools early; add a test).
  - Challenger reward base: `withdrawable_author_proceeds_usdc_micros` **only** (unchanged variable, now explicitly excluding slashed deposits).
  - Pool capacity: `withdrawable_author_proceeds - max_challenger_reward + slashed_deposit_usdc_micros`; fund the refund vault from both buckets, drain `slashed_deposit_usdc_micros` first (ring-fenced money must be the first money out), zero it as consumed.
  - Relax the gate (R5): replace `require!(available > 0)` with `require!(withdrawable + slashed_deposit > 0)` so a pool can be created from slashed deposits alone (author withdrew all proceeds pre-dispute); `refund_pool_amount > 0` check follows from the combined capacity.
  - Mark `skill_listing` as `mut` and clear `skill_listing.locked_by_dispute` alongside `settlement.locked_by_dispute`.
- `instructions/withdraw_author_proceeds.rs`: confirm withdrawal amount derives from `withdrawable_author_proceeds_usdc_micros` and never touches `slashed_deposit_usdc_micros` (it should already, since the new field is separate — add an explicit test).
- `instructions/revoke_vouch.rs`: change the status constraint from `is_live()` to `matches!(status, Active | Slashed)` for **reclaim**: when status is `Slashed`, the R2 guard makes `accrue_author_rewards` a no-op (no special-casing needed in the handler), transfer the residual `stake_usdc_micros`, set status `Revoked`, and do **not** double-decrement `total_vouch_stake_usdc_micros` (already removed at slash time). The existing `open_author_disputes == 0` guard stays and is what makes reclaim safe. Also update the handler comment that claims "the dispute resolves atomically... no window between resolution and slashing" — false under paging; the guard remains safe because `open_author_disputes` stays > 0 through `SlashingVouchers` until the final page.
- `events.rs`: add `VoucherSlashed { author_dispute, vouch, voucher, vouchee, slash_usdc_micros, residual_stake_usdc_micros, timestamp }` and `AuthorDisputeSlashingFinalized { author_dispute, author, processed_vouch_count, voucher_slashed_usdc_micros, timestamp }`.
- `lib.rs`: register `slash_dispute_vouches`.

### After program changes

- `NO_DNA=1 anchor build`; copy `target/idl/agentvouch.json` → `web/agentvouch.json`; `npm run generate:client` (curated entrypoints per AGENTS.md — no hand-edits to Codama output).

## Test Matrix (`tests/agentvouch-usdc-disputes.ts`, extending the existing upheld → bond-slash → refund-claim coverage)

1. **Happy path:** 2 linked vouchers, upheld → one crank page slashes both at `slash_percentage`, funds land in `slashed_deposit_usdc_micros`, dispute `Resolved`, `open_author_disputes == 0`, reputation recomputed, profile `total_vouch_stake` drops by full stakes.
2. **Multi-page:** 10+ positions → first cranks (4/page) leave `SlashingVouchers`, last completes; assert intermediate state (locks still live mid-slash: revoke and unlink both fail between pages). Also proves the real per-page tx-size bound (R3 — try 5 before settling on 4).
3. **Dodge attempts:** unlink during open dispute fails; link during open dispute fails; revoke during `SlashingVouchers` fails; **rotation dodge (R1):** `update_skill_listing` with a revision-bumping change fails while dispute-locked, and `initialize_listing_settlement` fails while dispute-locked.
4. **Double-crank:** same position in two pages → second fails on link PDA init; no double transfer.
5. **Dismissed:** no link PDAs, no transfers, statuses/locks identical to current behavior (regression).
6. **Stale position:** revoke vouch pre-dispute (legal), open dispute, uphold → skip-settle page converges, zero slash for that position, **listing `active_reward_stake` / `active_reward_position_count` decremented** (R4).
7. **Residual reclaim:** post-resolution, slashed voucher revokes → receives exactly `stake - slash`, profile aggregates unchanged by the reclaim.
8. **Ring-fence:** post-slash, `withdraw_author_proceeds` cannot touch slashed deposits; `create_refund_pool` challenger reward computed on proceeds-only base; refund pool drains slashed deposits first; `create_refund_pool` rejected while still `SlashingVouchers`; **slashed-only pool (R5):** author withdraws all proceeds pre-dispute → pool still creatable from slashed deposits alone.
9. **Free-listing dispute (regression):** `AuthorBondOnly` path untouched end to end.
10. **Post-slash reward solvency (R2):** after a slash, a new purchase on another of the author's listings distributes the voucher pool; the slashed vouch accrues nothing on its residual stake, remaining active vouchers can claim their full share, and `unclaimed_voucher_revenue_usdc_micros` never underflows. Pre-slash `pending_rewards` remain claimable by the slashed voucher.

Verification commands: `NO_DNA=1 anchor build`, `anchor test` (full suite — bonds-vouches, disputes, marketplace, usdc must stay green), then `npx tsc --noEmit` + `npm run test` in `web/` after client regen.

## Rollout

**Decided 2026-06-09 (with Andy): full clean break — new program ID, no migration instructions.** Rationale: the `SkillListing.locked_by_dispute` mirror (R1) changes the layout of **every existing listing account**, so a bare same-ID upgrade would break deserialization of all live listings and settlements; M15-style migration instructions would have to realloc/backfill every `SkillListing` and `ListingSettlement` and then be carried as dead code — not worth it for disposable devnet state. `AuthorDisputeVouchLink` layout changes ride along (zero existing instances). Execution per the AGENTS.md clean-break runbook: deploy under a fresh program ID, wipe and re-seed devnet state, update the program ID in web config and DB (same process as the `AGNt...yVdg` change).

## Rollback

Pre-mainnet, devnet-only: redeploy previous program build and restore DB links per the clean-break runbook. No mainnet rollback path needed yet — that's the point of doing this now.

## Blockers / Open Items

- ~~Tx-size check~~ resolved by R3 (2026-06-09 review): 5 accounts per position, start at 4 per page; test 2 proves whether 5 fits.
- ~~`accrue_author_rewards` interaction~~ resolved by R2 (2026-06-09 review): status guard in `accrue_author_rewards`; slashed voucher keeps pre-slash `pending_rewards` (both vouch-level and position-level) — assert in tests 1 and 10.
- A2 will redirect the author-bond slash destination (challenger → refund pool). This plan deliberately leaves the bond destination unchanged to keep A1 reviewable; do not "fix" it here.
- Pre-existing hole noted during review (R1 side effect, fixed here): settlement rotation also let authors keep selling mid-dispute on a fresh settlement, escaping the refund lock. The R1 guards close it; if A1 slips, consider shipping the rotation guards alone as a hotfix.

## Outcome (2026-06-09, implementation complete)

All todos done. `NO_DNA=1 anchor build` clean, full Anchor suite green (29 passing: 21 pre-existing + 8 new slashing tests), `web/` typecheck and workspace build green after client regen (one call-site fix in `web/hooks/useReputationOracle.ts` for the new `skill_listing` account on resolve).

Measured: a 4-position slash page = **31 accounts** — fits the tx limit, so `MAX_DISPUTE_POSITIONS_PER_TX = 4` stands (R3 confirmed; did not attempt 5).

Divergences from the plan body, all small:

- Slash time also decrements `author_profile.total_vouches_received` (it feeds `compute_reputation`'s vouch component — leaving it inflated would have understated the slash). Reclaim via `revoke_vouch` then touches only the voucher's own `total_vouches_given`; vouchee aggregates are untouched by reclaim (asserted in tests).
- `resolved_at` stays `None` while parked in `SlashingVouchers` and is set on the final slash page — the resolve-time `AuthorDisputeResolved` event still fires with `voucher_slashed = 0`; indexers should use `AuthorDisputeSlashingFinalized` for totals (as planned).
- The link-PDA init handles lamport-pre-funding griefing (transfer/allocate/assign path instead of bare `create_account`) — without this, 1 lamport sent to a link address would have bricked dispute finalization permanently.
- The unused `AuthorDisputeVouchLinked` event is now emitted per link creation.
- The `initialize_listing_settlement` dispute guard is defense-in-depth only: it is unreachable through the public flow (revision bumps are blocked first, and the current-revision settlement PDA already exists), so it has no direct test.
- `web/public/skill.md` deliberately **not** updated: it describes the live devnet program, and the branch is not deployed. Update it as part of the clean-break redeploy.

Follow-ups (not in this plan): devnet clean-break deploy per Rollout; A2 dispute governance; cleanup instruction for stale Revoked-vouch positions (skip-settle handles them inside disputes, but they still linger on undisputed listings).
