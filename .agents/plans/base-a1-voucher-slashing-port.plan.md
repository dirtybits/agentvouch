---
name: base-a1-voucher-slashing-port
overview: "Port the A1 voucher-slashing mechanism (live on Solana devnet since 2026-06-10) into the Base v1 candidate contract, EVM-simplified but invariant-preserving, so upheld paid-listing reports slash linked vouch stake — landing BEFORE the Phase 9c external security review so one review covers the complete mechanism. Approved 2026-07-06 (supersedes the base-port plan's disputes/slashing deferral for Base v1)."
todos:
  - id: design-lock-a1-evm
    content: "DONE 2026-07-06 — design locked and acked (founder delegated the ack in-session after merging PR #81). Resolutions recorded in the 'Design-lock resolutions' section, grounded in contract recon: Base vouching is AUTHOR-WIDE (no link_vouch_to_listing exists; Vouch.linkedListingCount is vestigial), there is NO on-chain vouch enumeration (only totalVouchStakeReceivedUsdcMicros), and revokeVouch already carries the openDisputes>0 DisputeLocked exit lock. Decisions: (1) optional paid-listing + verified-purchase reference on reports splits the financial branch (bond-first then author-wide voucher slash) from reputation-only; (2) buyer-first routing with minimal on-chain refund claim, residual to treasury, capped reporter reward from author proceeds only; (3) config slashPercentage snapshotted at resolution, no resolver discretion; (4) park + permissionless calldata-driven crank as the ONLY slash path, completeness proven by stake accounting, with a new vouch() open-report lock freezing membership symmetrically."
    status: completed
  - id: implement-contract
    content: "Implement in contracts/base-poc/src/AgentVouchEvm.sol (+ AgentVouchTypes.sol) per the locked design AND the 2026-07-09 pre-loop review: optional listingId + purchase reference on AuthorReport (financial vs reputation-only branch); financial openReport SETS l.lockedByDispute on the referenced listing (today the flag is read by _purchasableListing/updateSkillListing/removeSkillListing but NEVER written) and the report close path clears it; withdrawAuthorProceeds gains a lockedByDispute check for the referenced listing (currently only time-locked — without this the author drains the refund/reward funding mid-report); serialize financial reports per author (openReport rejects a new bond-exposing report while openDisputes > 0); vouch() lock while vouchee has open reports (symmetric to the existing revokeVouch DisputeLocked guard); resolveReport(Upheld) O(1) parking with snapshot of slashPercentage/reward caps and totalVouchStakeReceivedUsdcMicros; permissionless slashReportVouches(reportId, vouchers[]) crank verifying eligibility per vouch, slashing at the snapshotted percentage into a ring-fenced refund-only bucket, setting VouchStatus.Slashed dead positions (accrual-excluded, residual stake removed from totalVouchStakeReceivedUsdcMicros at slash time so it stops backing), and closing the report when accounted pre-slash stake equals the snapshot; minimal refund claim for verified buyers of the referenced listing (per-claim = min(remaining bucket, purchase price), one claim per purchase, claim window); residual-to-treasury close path with events; residual voucher stake reclaimable after close via a revokeVouch branch for VouchStatus.Slashed (the current Active-only guard would strand residuals)."
    status: pending
  - id: forge-tests
    content: "Forge suite mirroring the Solana A1 coverage under the locked design: slash math at snapshot percentage, multi-voucher crank across multiple calls, stake-accounting completeness (report closes only when accounted == snapshot), two-sided membership lock (vouch() and revokeVouch both revert mid-report; totalVouchStakeReceived frozen), revision/listing dodge blocks, per-(report,voucher) double-slash guard, ring-fence (slash bucket never author-withdrawable, never in reporter-reward base), buyer-first refund claim + one-claim-per-purchase + window expiry + residual-to-treasury, reputation-only branch (no listing/purchase ref => no voucher slash, locks clear), reward-vault solvency with Slashed positions, zero-vouch path, pause interaction, reentrancy on USDC moves, gas snapshot for the recommended crank page size; once listing-referenced reports set `lockedByDispute`, add the updateSkillListing bump-guard flag-path test (flag set → bump reverts DisputeLocked even with `openDisputes == 0`)."
    status: pending
  - id: sync-artifacts
    content: "Sync Deploy.s.sol config, contracts/base-poc/ui/src/abi.ts, harness ABI fragments, and web/lib/adapters/agentVouchEvmAbi.ts + baseAuthorTrust.ts read surfaces (slashed-stake counters, report exposure) — keeping BaseAdapter server-safe."
    status: pending
  - id: web-trust-surfaces
    content: "Expose slashing honestly in web reads: Base skill/author trust shows stake-at-risk and slash history; no synthesized trust; chain-qualified joins preserved. UI actions (vouch/report) remain the Phase 9 report/vouch UI todo — this plan only guarantees the read surfaces reflect the new mechanism."
    status: pending
  - id: verify-and-record
    content: "Full gate: forge test --root contracts/base-poc, web format/lint/typecheck/vitest, next build --webpack; deploy a fresh Sepolia candidate that SUPERSEDES the PR #85 candidate 0x5992dD52Ee2015f558D0A690777C55e27b05B7d1 (record it in docs/BASE_DEPLOY.md, repoint the envs PR #85 pointed at it, and bump PROTOCOL_VERSION so PR #90's live provenance reads distinguish pre/post-slashing rows); run a scripted backed-purchase -> update-bump -> upheld-report -> crank-slash -> refund-claim -> residual-reclaim smoke with recorded tx hashes and USDC deltas (the combined smoke per the sequencing note, covering the merged updateSkillListing flow too); flip the A1 row in the docs/MAINNET_READINESS.md Base Mainnet Gate Table, update the phase-9/10 plans, and web/public/skill.md if product semantics change."
    status: pending
isProject: false
---

# Base A1 Voucher-Slashing Port

## Decision (2026-07-06)

The founder approved a **full mechanism port** of A1 voucher slashing from Solana to the Base v1
candidate. This supersedes, for Base v1, the base-port plan's "disputes/slashing deferred" scope
line and the Phase 9 "defer full voucher slashing parity unless explicitly re-approved" clause —
it is now re-approved. Rationale:

1. **Review economics.** The Phase 9c internal + external security review is the mainnet long
   pole. Every USDC-moving path added _after_ that review forces a re-review; landing slashing
   _before_ it means one review covers the complete mechanism.
2. **EVM shrinks A1.** Most Solana A1 complexity was chain-shaped: the ≤4-position paged
   `slash_dispute_vouches` crank, `SlashingVouchers` parking, and per-(dispute,vouch) link PDAs
   exist because of Solana tx account limits and rent. The _economics_ port cleanly; the
   _machinery_ gets simpler.
3. **The moat claim.** Base currently slashes at most `min(authorBond, reportBond)` from the
   author bond; vouching on Base is reward-only — the exact P0.1 condition the 2026-05-30 audit
   flagged on Solana. "Stake-backed reputation" requires enforced voucher downside at mainnet.

Sequencing: this plan is **Phase 9b-2** — after the PR #78/#79 report primitive (9b-1), before
the 9c review closeout. It must not block Phase 9 Part A live smokes (x402 relayer/funded-EOA
setup is human-gated and runs in parallel).

> **SEQUENCING vs `base-update-skill-listing` (2026-07-07, founder-acked):** run this plan
> **SECOND**, after `.agents/plans/base-update-skill-listing.plan.md` merges. Do NOT run the two
> a2a loops in parallel — both edit `AgentVouchEvm.sol`, `AgentVouchTypes.sol`, the forge
> suites, `ui/src/abi.ts`, and `web/lib/adapters/agentVouchEvmAbi.ts`. Additionally, this plan's
> revision-dodge-block forge test (row 6) is only meaningful once `updateSkillListing` exists —
> no bump function means nothing to block. The fresh Sepolia candidate deploy + live smoke in
> `verify-and-record` should be **combined with the update plan's smoke into one deploy and one
> evidence run after both plans merge** (create → buy rev 1 → update price/bump → buy rev 2 →
> backed purchase → upheld report → crank slash → refund claim → residual reclaim). Part A
> human-gated items (x402 relayer key, funded agent EOA, fresh author passkey smoke) proceed in
> parallel with either loop.

> **2026-07-08 (PR #86 review follow-up):** `updateSkillListing` already guards bumps on
> `l.lockedByDispute || profiles[author].openDisputes > 0`, but nothing in the pre-A1 contract
> sets `lockedByDispute`, so the flag half of the bump guard is untestable today. Once this
> plan's listing-referenced reports set that flag, the `forge-tests` suite must cover the flag
> path explicitly (flag set → bump reverts `DisputeLocked` even when `openDisputes == 0`).
> Metadata-only updates while locked remain allowed (Solana parity; accepted at #86 review).

## Baseline (what exists in the v1 candidate today)

- `PROTOCOL_VERSION = "base-v1-candidate"`; `openReport`/`resolveReport` under `RESOLVER_ROLE`;
  reporter USDC bond; `forfeitReporterBond` dismissal anti-griefing lever; upheld slash bounded to
  `min(authorBond, reportBond)`; open/upheld/dismissed profile counters (PR #78).
- `vouch`/`revokeVouch`, author bonds, the 60/40 reward-index accrual, and
  `claimVoucherRevenue` carried from the POC — vouches currently face **no slash path**.
- Reports are **author-wide**; Solana disputes are **listing-scoped**. Resolved in design-lock
  (2026-07-06): see resolutions section.
- **Contract recon (verified 2026-07-06 against source):** Base vouching is **author-wide** —
  `vouch(vouchee, stake)` keyed by `vouchId(voucher, vouchee)`; **no** `link_vouch_to_listing`
  analog exists and `Vouch.linkedListingCount` is a vestigial parity field never written. There
  is **no on-chain vouch enumeration** (only the `AgentProfile.totalVouchStakeReceivedUsdcMicros`
  aggregate), so any slash crank must be calldata-driven. `revokeVouch` already reverts with
  `DisputeLocked` while `profiles[vouchee].openDisputes > 0` — the exit-lock half of the
  membership freeze exists; the entry-lock half (blocking new `vouch()` during an open report)
  does not yet.

## Invariant mapping — Solana A1 → EVM (each encodes a shipped bug or review finding)

| #   | Solana A1/A2 invariant                                                                                                                                                                | EVM translation                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Slash set = the disputed listing's linked vouch positions, frozen at resolution                                                                                                       | **Author-wide slash set** (Base vouchers back the author, not a listing — recon above): all Live vouches on the vouchee, frozen by the two-sided membership lock (row 5) and snapshotted as total stake at `resolveReport(Upheld)`                                                 |
| 2   | Paged permissionless `slash_dispute_vouches` crank (tx account limits)                                                                                                                | **Park + permissionless calldata-driven crank as the ONLY path** (resolution stays O(1)): `slashReportVouches(reportId, vouchers[])` verifies each supplied vouch, bounded per call by the array; completeness proven by stake accounting (accounted == snapshot), not enumeration |
| 3   | Slashed funds ring-fenced (`slashed_deposit_usdc_micros`): refund-pool-only, excluded from author withdrawals AND the challenger/reporter-reward base                                 | Dedicated slash-bucket accounting per listing settlement; assert in tests it never enters `withdrawAuthorProceeds` or reporter-reward math (the Solana sketch that let authors reclaim slash via refund pools inflated the collusion prize)                                        |
| 4   | Partial slash at `slash_percentage`; vouch → `Slashed` dead position (stops backing + earning); residual reclaimable via revoke after close                                           | Same status semantics in `AgentVouchTypes`; residual reclaim gated on no open reports against the author                                                                                                                                                                           |
| 5   | `link_vouch_to_listing` AND `unlink` blocked while dispute-locked (revoke lock alone freezes money, not membership)                                                                   | Two-sided membership lock on the vouchee while a report is open: `revokeVouch` exit lock **already exists** (`DisputeLocked`); ADD the entry lock — `vouch()` reverts too — so the resolve-time stake snapshot exactly equals the crankable set                                    |
| 6   | `locked_by_dispute` mirror on the listing: revision bumps + new-settlement init blocked mid-dispute (rotation dodge: a fresh settlement is unlocked and lets the author keep selling) | Listing-level lock flag checked by `updateSkillListing` and settlement-revision paths                                                                                                                                                                                              |
| 7   | `accrue_author_rewards` guard for non-live vouches (else reward vault goes insolvent — index denominator drops pre-slash stake while residual keeps accruing)                         | Reward-index accrual must exclude `Slashed` positions; solvency property test                                                                                                                                                                                                      |
| 8   | Double-slash guard (`AuthorDisputeVouchLink` PDA init-once)                                                                                                                           | Per-(report, vouch) slashed flag / mapping; idempotent crank                                                                                                                                                                                                                       |
| 9   | A2: buyer-first before reporter reward; reward capped by bps/cap; funded only from eligible author proceeds, never slash buckets                                                      | Apply now — this is the P0.2 collusion lesson; do not launch 100%-to-reporter routing                                                                                                                                                                                              |
| 10  | A2: economics snapshotted at resolution (config can mutate mid-crank)                                                                                                                 | Snapshot `slashPercentage` + reward bps/cap into the report at `resolveReport`                                                                                                                                                                                                     |
| 11  | A2: serialized author-bond exposure (reject new bond-exposing reports while one is open)                                                                                              | Already partially implied by profile counters; make it explicit                                                                                                                                                                                                                    |
| 12  | A2: upheld paid reports without a verified purchase are reputation-only (no slash-to-refund pool that can strand locks)                                                               | Zero-refund branch clears locks at resolution                                                                                                                                                                                                                                      |

EVM-specific additions the Solana plan never needed: **reentrancy** on every USDC transfer in the
slash/claim paths (OZ guards + checks-effects-interactions), and gas-bounded iteration (the
calldata-bounded crank in row 2).

## Files

- `contracts/base-poc/src/AgentVouchEvm.sol`, `src/libraries/AgentVouchTypes.sol`
- `contracts/base-poc/test/AgentVouchEvm.Slashing.t.sol` (new), extensions to Reports/X402 suites
- `contracts/base-poc/script/Deploy.s.sol`, `ui/src/abi.ts`, `harness/src/abi.ts`
- `web/lib/adapters/agentVouchEvmAbi.ts`, `web/lib/baseAuthorTrust.ts`, trust read surfaces
- `.agents/plans/base-port-chain-adapter.plan.md`, `base-port-chain-adapter-phase-9.plan.md`,
  `base-port-chain-adapter-phase-10.plan.md`, `docs/MAINNET_READINESS.md`, `web/public/skill.md`

## Verification

- `forge test --root contracts/base-poc` — new Slashing suite green plus all existing suites.
- Web gate: `npm run format:check`, lint, typecheck, vitest, `next build --webpack`.
- Fresh Base Sepolia candidate deploy + scripted live smoke: register → bond → vouch (author-wide)
  → paid purchase (backed, so the 60/40 split is finally observed live) → open report with
  listing + purchase reference → resolve upheld → crank slash → verify ring-fence + dead position
  → buyer refund claim → residual-to-treasury close → residual voucher stake reclaim after close.
  Record tx hashes and USDC deltas at explicit block numbers.

## Rollback

Contract-only until deployed: revert the PR. Once a new Sepolia candidate is deployed, the web
config points back at the previous contract address (rows are chain-qualified; no DB migration).
Nothing here touches the Phase 8a default-chain rollback seam.

## Design-lock resolutions (2026-07-06 — acked; founder delegated the ack in-session)

Grounded in the contract recon recorded in the Baseline section. Solidity may start; any
implementation-time divergence from these gets a dated note here, not a silent change.

1. **Report scope — RESOLVED: optional listing + purchase reference, two mutually exclusive
   branches.** `openReport` gains an optional paid-listing reference and verified-purchase
   reference. With both → the **financial branch**: author bond slashed first (existing
   `min(authorBond, reportBond)` behavior), then the **author-wide** voucher slash at the
   snapshotted `slashPercentage` — author-wide because Base vouchers stake on the author, not a
   listing (recon: no link machinery exists), so author-wide exposure is the honest semantics of
   what a Base voucher signed up for, and it preserves Solana's `AuthorBondThenVouchers`
   ordering. Without a listing/purchase reference → **reputation-only** (current PR #78
   behavior): bond-bounded author slash, no voucher slashing, no refund pool, locks clear at
   resolution (A2 findings 3 + 7: the branches must be mutually exclusive and the no-purchase
   branch must not strand locks). Do NOT port the Solana listing-link machinery.
2. **Routing — RESOLVED: buyer-first, minimal on-chain refund claim, capped reporter reward.**
   This answers PR #78's open "reporter-vs-treasury bounty routing" question with the P0.2
   lesson. Slash buckets are refund-only: verified buyers of the referenced listing claim from
   the bucket within a claim window (price-capped per purchase, one claim per purchase);
   unclaimed residual after the window routes to the protocol treasury reserve with events —
   never back to the author, never to the reporter (A2 findings 4 + 10). The reporter reward is
   computed only after buyer exposure is satisfied, capped by snapshotted bps + absolute cap,
   and funded solely from eligible author proceeds (A2 finding 2). A minimal refund-claim path
   is therefore **in scope** for this plan — harmed-party-first is unenforceable without it, and
   the Launch Trust Bar (MAINNET_READINESS) requires it; this consciously narrows the Phase 9
   "defer refund-pool machinery" line to "defer anything beyond this minimal claim".
3. **Slash percentage — RESOLVED: config `slashPercentage`, snapshotted at resolution.** No
   per-report resolver input — resolver discretion over slash size is a P0.2-shaped risk
   (invariant 10 covers the mid-crank config-mutation case). Bounded at config-set time
   (validated ≤ 100%), Solana parity.
4. **Crank — RESOLVED: park + permissionless calldata-driven crank as the only slash path.**
   `resolveReport(Upheld)` on the financial branch stays O(1): it snapshots economics plus the
   vouchee's `totalVouchStakeReceivedUsdcMicros` and parks the report (SlashingVouchers-
   equivalent status). A permissionless `slashReportVouches(reportId, address[] vouchers)`
   settles positions: per supplied voucher it verifies the vouch exists, is Live, and is
   unslashed for this report (per-(report,voucher) flag — row 8), slashes at the snapshot
   percentage, marks the position `Slashed`, and adds to the ring-fenced bucket. **Completeness
   is proven by stake accounting**: the report closes when accounted (slashed-from) stake equals
   the snapshot — sound because the two-sided membership lock (row 5: existing revoke exit lock
   plus the new `vouch()` entry lock) freezes `totalVouchStakeReceivedUsdcMicros` for the vouchee
   while a report is open. No inline-slash fast path: one mechanism, one audit surface; gas per
   crank call is bounded by the caller's array (forge gas snapshot informs the recommended page
   size in docs, not a contract constant). Rejected alternative: an on-chain voucher enumeration
   array — more storage and a new growth-unbounded structure for no gain over calldata plus the
   accounting proof.

Consequence noted for UX copy: blocking new `vouch()` during an open report is also buyer/voucher
protection (no staking into an active dispute), but the UI must say why vouching is temporarily
unavailable — track under the Phase 9 report/vouch UI todo.

## Final pre-loop review (2026-07-09 — contract facts re-verified against current main)

The design-lock (2026-07-06) predates PRs #85, #86, #88, #89, #90, and #93. This review re-checked
every contract fact the design leans on against `main` as of `98712d9` and found three gaps that
are now folded into the `implement-contract` and `verify-and-record` todos above. The a2a loop
must treat these as in-scope, not optional hardening:

1. **`withdrawAuthorProceeds` is NOT dispute-locked (verified: it checks only the rolling
   `authorProceedsLockSeconds` time-lock and the never-written `s.locked` flag).** Without a
   `lockedByDispute` check, the author can drain the referenced listing's proceeds the moment the
   time-lock elapses mid-report — emptying both the buyer-first refund source and the
   reporter-reward funding source. Freeze it while the referenced listing is dispute-locked.
2. **`lockedByDispute` is read in three places (`_purchasableListing`, `updateSkillListing` bump
   guard, `removeSkillListing`) but written NOWHERE.** The financial `openReport` branch must set
   it on the referenced listing and the report close path must clear it. Setting it at OPEN (not
   resolve) is load-bearing: `_purchasableListing` already rejects locked listings, so the flag
   freezes buyer exposure for refund sizing, blocks the revision-rotation dodge, and blocks
   removal — all for the whole dispute window. Clear it when the report closes (dismissed at
   resolve; upheld once the crank completes and the refund bucket is funded); the refund claim
   window runs independently of the listing lock so the author can sell again post-close.
3. **`revokeVouch` reverts for any non-`Active` status (verified), so "residual reclaimable via
   revokeVouch" needs an explicit `VouchStatus.Slashed` branch** — and the slash must remove the
   residual from `totalVouchStakeReceivedUsdcMicros` at slash time (dead positions stop backing),
   which also keeps any later report's snapshot consistent.

Also confirmed while reviewing: `openReport` has no per-author serialization guard yet (invariant
11 is real work, and it is what makes the single-snapshot completeness proof safe from concurrent
financial reports); `settlements[id][revision].locked` is a second never-written parity flag —
the loop may use it or ignore it, but must not assume it does anything today; and purchases are
already correctly frozen by `_purchasableListing` once the flag is set, so no purchase-path change
is needed beyond writing the flag.

Environment deltas since the design-lock: the live Sepolia candidate is `0x5992…B7d1`
(PR #85, envs repointed; recorded in `docs/BASE_DEPLOY.md`); `updateSkillListing` /
`removeSkillListing` now exist (PRs #86/#89), so the row-6 dodge-block and the flag-path forge
test are implementable as written; publisher-auth scope is enforced per Base mode (PR #88 — any
new web mutation this plan adds must follow `assertPublisherAuthMessageScope`); protocol-version
provenance is read live from the contract (PR #90), so the A1 deploy should bump
`PROTOCOL_VERSION` deliberately; and the launch gate record is now the
`docs/MAINNET_READINESS.md` Base Mainnet Gate Table (PR #93) — flip the A1 row at closeout.
