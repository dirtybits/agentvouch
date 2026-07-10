---
name: base-a1-voucher-slashing-port
overview: "Port the A1 voucher-slashing mechanism (live on Solana devnet since 2026-06-10) into the Base v1 candidate contract, EVM-simplified but invariant-preserving, so upheld paid-listing reports slash linked vouch stake — landing BEFORE the Phase 9c external security review so one review covers the complete mechanism. Approved 2026-07-06 (supersedes the base-port plan's disputes/slashing deferral for Base v1)."
todos:
  - id: design-lock-a1-evm
    content: "DONE 2026-07-06 — design locked and acked (founder delegated the ack in-session after merging PR #81). Resolutions recorded in the 'Design-lock resolutions' section, grounded in contract recon: Base vouching is AUTHOR-WIDE (no link_vouch_to_listing exists; Vouch.linkedListingCount is vestigial), there is NO on-chain vouch enumeration (only totalVouchStakeReceivedUsdcMicros), and revokeVouch already carries the openDisputes>0 DisputeLocked exit lock. Decisions: (1) optional paid-listing + verified-purchase reference on reports splits the financial branch (bond-first then author-wide voucher slash) from reputation-only; (2) buyer-first routing with minimal on-chain refund claim, residual to treasury, capped reporter reward from author proceeds only; (3) config slashPercentage snapshotted at resolution, no resolver discretion; (4) park + permissionless calldata-driven crank as the ONLY slash path, completeness proven by stake accounting, with a new vouch() open-report lock freezing membership symmetrically."
    status: completed
  - id: implement-contract
    content: "Implement in contracts/base-poc/src/AgentVouchEvm.sol (+ AgentVouchTypes.sol) per the locked design: optional listingId + purchase reference on AuthorReport (financial vs reputation-only branch); vouch() lock while vouchee has open reports (symmetric to the existing revokeVouch DisputeLocked guard); resolveReport(Upheld) O(1) parking with snapshot of slashPercentage/reward caps and totalVouchStakeReceivedUsdcMicros; permissionless slashReportVouches(reportId, vouchers[]) crank verifying eligibility per vouch, slashing at the snapshotted percentage into a ring-fenced refund-only bucket, setting VouchStatus.Slashed dead positions (accrual-excluded), and closing the report when accounted stake equals the snapshot; minimal refund claim for verified buyers of the referenced listing with claim window; residual-to-treasury close path with events; residual voucher stake reclaimable via revokeVouch after close."
    status: in_progress
  - id: forge-tests
    content: "Forge suite mirroring the Solana A1 coverage under the locked design: slash math at snapshot percentage, multi-voucher crank across multiple calls, stake-accounting completeness (report closes only when accounted == snapshot), two-sided membership lock (vouch() and revokeVouch both revert mid-report; totalVouchStakeReceived frozen), revision/listing dodge blocks, per-(report,voucher) double-slash guard, ring-fence (slash bucket never author-withdrawable, never in reporter-reward base), buyer-first refund claim + one-claim-per-purchase + window expiry + residual-to-treasury, reputation-only branch (no listing/purchase ref => no voucher slash, locks clear), reward-vault solvency with Slashed positions, zero-vouch path, pause interaction, reentrancy on USDC moves, gas snapshot for the recommended crank page size; once listing-referenced reports set `lockedByDispute`, add the updateSkillListing bump-guard flag-path test (flag set → bump reverts DisputeLocked even with `openDisputes == 0`)."
    status: in_progress
  - id: sync-artifacts
    content: "Sync Deploy.s.sol config, contracts/base-poc/ui/src/abi.ts, harness ABI fragments, and web/lib/adapters/agentVouchEvmAbi.ts + baseAuthorTrust.ts read surfaces (slashed-stake counters, report exposure) — keeping BaseAdapter server-safe."
    status: in_progress
  - id: web-trust-surfaces
    content: "Expose slashing honestly in web reads: Base skill/author trust shows stake-at-risk and slash history; no synthesized trust; chain-qualified joins preserved. UI actions (vouch/report) remain the Phase 9 report/vouch UI todo — this plan only guarantees the read surfaces reflect the new mechanism."
    status: in_progress
  - id: verify-and-record
    content: "Full gate: forge test --root contracts/base-poc, web format/lint/typecheck/vitest, next build --webpack; deploy a fresh Sepolia candidate, run a scripted backed-purchase -> upheld-report -> slash -> residual-reclaim smoke with recorded tx hashes and USDC deltas; update MAINNET_READINESS Base track, the phase-9/10 plans, and web/public/skill.md if product semantics change."
    status: in_progress
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
   - new `vouch()` entry lock) freezes `totalVouchStakeReceivedUsdcMicros` for the vouchee while
   a report is open. No inline-slash fast path: one mechanism, one audit surface; gas per crank
   call is bounded by the caller's array (forge gas snapshot informs the recommended page size
   in docs, not a contract constant). Rejected alternative: an on-chain voucher enumeration
   array — more storage and a new growth-unbounded structure for no gain over calldata + the
   accounting proof.

Consequence noted for UX copy: blocking new `vouch()` during an open report is also buyer/voucher
protection (no staking into an active dispute), but the UI must say why vouching is temporarily
unavailable — track under the Phase 9 report/vouch UI todo.

## Implementer Review (2026-07-09 — reviewed against `main` at `98712d9`)

### Recon evidence and sequencing

- The prerequisite is satisfied: PR #86 / `a6791cd4` is an ancestor of `main`, and its completed
  plan confirms `updateSkillListing` is present.
- Baseline verification passed without source changes: `forge test --root contracts/base-poc`
  reported 85 passing tests across seven suites.
- The following requirements bind the existing todo IDs and statuses; they do not authorize
  implementation before the stated economics/custody decisions are recorded.

### Required contract amendments

1. Preserve `openReport(address,string)` as the existing reputation-only entry point. It is called
   by `web/lib/adapters/baseWallet.ts` and the author page, and the current passkey deployment
   check hard-codes selector `0x92e928f4`. Add a distinct additive financial-report entry point
   rather than replacing that ABI. Until the Phase 9 UI todo is separately implemented, the
   browser report form must continue to create reputation-only reports.

2. A financial report must require both references or neither. Validate before collecting the
   reporter bond that:

   - the referenced listing exists and belongs to `author`;
   - the referenced purchase exists, belongs to `msg.sender`, and names that listing;
   - the purchase is paid; and
   - a removed listing with a valid historical paid purchase remains reportable. Requiring
     `ListingStatus.Active` here would let an author remove a listing before a buyer opens a
     financial report.

   Reject partial references, a purchase from another buyer, a purchase for another listing, and
   a second report while `profiles[author].openDisputes > 0`. The last guard must serialize all
   bond-exposing reports, not merely the financial branch, so two reports cannot snapshot or
   slash the same author-wide vouch set.

3. Add `ReportStatus.SlashingVouchers` by appending it to the existing `ReportStatus` enum. Do
   not rely on the currently unused `DisputeStatus` enum. Append report fields needed for the
   financial branch: listing/purchase reference, pre-slash backing snapshot, processed
   pre-slash stake, slash amount, snapshotted economics, refund state, and terminal timestamps.

4. Set `SkillListing.lockedByDispute` when the financial report opens, not when it is upheld.
   Current source reads that flag in `_purchasableListing`, `updateSkillListing`, and
   `removeSkillListing`, but writes it nowhere. Clear it only on a defined terminal path:

   - dismissed financial report;
   - upheld financial report with zero live backing once its refund state is funded; or
   - final successful slash crank once its refund state is funded.

   Do not use `settlements[id][revision].locked` as the primary lock; it is also never written
   today. Add a `lockedByDispute` check to `withdrawAuthorProceeds` for every revision of the
   referenced listing, since its current checks are only settlement lock and time lock. This is
   load-bearing because the candidate deploy config currently sets
   `authorProceedsLockSeconds = 0`.

5. Slash accounting must distinguish pre-slash stake from transferred slash amount. For every
   live vouch processed:

   - accrue earned voucher revenue while the vouch is still `Active`;
   - increment report completeness by the full pre-slash stake;
   - decrement `totalVouchStakeReceivedUsdcMicros` by that full pre-slash stake so the dead
     position no longer backs later purchases or reports;
   - transfer only `preSlashStake * snapshottedSlashPercentage / 100` into the refund-only
     bucket;
   - leave the residual in the `Slashed` vouch for reclaim; and
   - permit `revokeVouch` to reclaim that residual after report closure without decrementing the
     profile aggregate a second time.

   The current `revokeVouch` accepts only `Active`, so the Slashed residual branch is required.
   Define repeated/duplicate voucher calldata explicitly as a no-op skip or a clean revert; it
   must never increase processed stake or slash funds twice.

6. Snapshot the percentage, reward bps/cap, and all refund inputs before parking. Current config
   is immutable after `initializeConfig`, so do not add a config setter merely to manufacture a
   mutation test. Still store and use report snapshots as the forward-safe invariant. Extend
   `initializeConfig` validation to reject `slashPercentage > 100` and
   `challengerRewardBps > 10_000`; live deployment must additionally verify a non-zero slash
   percentage.

7. `resolveReport` is intentionally callable while paused. Define `slashReportVouches`,
   buyer refund claims, and expiry close/sweep as liveness paths that can complete a parked
   report while paused; keep new report opening and purchases paused. Test this exact pause
   matrix.

### Blocking financial-settlement decisions

The current plan cannot safely implement its buyer-first and residual-routing claims until these
are written as a dated, acknowledged decision:

1. **Claim cohort and exposure snapshot.** The contract has no purchase enumeration.
   `totalRevenueUsdcMicros` is listing-wide across revisions, while settlements expose only
   currently unwithdrawn proceeds for a specific revision. Choose either:

   - a narrow claim cohort of the referenced purchase only, with docs that say exactly that; or
   - all eligible purchases for a stated listing/revision cohort, with new O(1) exposure counters
     captured before the listing lock is released.

   A simple `min(remainingBucket, purchase.price)` claim is not enough to prove buyer-first
   treatment or to calculate a reporter reward after buyer exposure.

2. **Funding order and reporter payout.** In the financial branch, the current contract sends the
   slashed author bond directly to the reporter. Specify whether that first-loss amount joins the
   buyer refund reserve, how eligible author proceeds may top it up, and when a reporter reward
   becomes payable. It must never be paid at upheld resolution merely because a later buyer might
   claim; it may use only non-slashed author proceeds after the selected buyer-exposure rule is
   satisfied.

3. **Treasury recipient.** `TREASURY_ROLE` currently has no stored recipient and is unused.
   Residual funds must not be sent to `msg.sender` or an arbitrary close caller. Add a
   human-approved, deployment-recorded treasury recipient or an equivalently constrained
   treasury mechanism, then test the recipient and one-time sweep.

4. **Live parameters.** `Deploy.s.sol` currently sets `refundClaimWindowSeconds`,
   `challengerRewardBps`, and `challengerRewardCapUsdcMicros` to zero. The owner must provide
   non-placeholder values and the treasury recipient before a fresh candidate deploy. Do not
   invent production economics in this implementation.

### Artifact and web-read requirements

- Update all changed tuple layouts and events in `contracts/base-poc/ui/src/abi.ts`,
  `contracts/base-poc/harness/src/abi.ts`, `web/lib/adapters/agentVouchEvmAbi.ts`, and the
  passkey write ABI. Add ABI compatibility coverage for the preserved generic report entry point.
- Keep `BaseAdapter` server-safe. Do not expand `ChainAdapter` or `ChainWallet` for financial
  reporting without separate approval; the current UI action is deliberately out of scope.
- `baseAuthorTrust.ts` currently reads only `getProfile`, and the EVM author route currently
  returns `author_disputes: []`. To truthfully show slash history without archive-log scans, add
  an aggregate slashed-stake/report counter to the profile and map it through `AuthorTrust` with
  explicit zero defaults for Solana. Do not promise a per-report history unless an indexed,
  chain-qualified source is added.
- Update affected `AuthorTrust` mocks, API fixtures, cache serialization, trust badges, and
  `web/public/skill.md`. Base rows must remain `Review`-oriented trust surfaces, never synthetic
  `Trusted` status.

### Required Forge coverage

Extend `forge-tests` with behavioral tests for:

- old reputation-only report ABI behavior; all malformed financial reference combinations; a
  valid historical purchase on a removed listing; and serialized report opening;
- immediate listing lock at financial open: all purchase lanes, removal, revision bump, and
  proceeds withdrawal reject; metadata-only update remains allowed;
- dismiss, zero-vouch upheld, and final crank lock cleanup;
- partial slash math, pre-slash stake completeness, multi-call crank, duplicate calldata/retry,
  zero percentage handling, and no double slash;
- pre-slash voucher rewards remaining claimable, post-slash rewards not accruing, residual reclaim,
  and a conservation invariant covering report bonds, author bonds, live vouch stake, slashed
  residuals, voucher-reward liabilities, proceeds, and refund reserves;
- refund provenance, one claim per allowed purchase, buyer identity, expiry, one-time residual
  sweep, reporter reward exclusion from slash buckets, and exact treasury recipient;
- pause liveness and a malicious ERC-20 reentrancy fixture for every new USDC-moving path.

### Verification and rollback amendments

- The fresh candidate must use a distinct `PROTOCOL_VERSION`, record its address, block, config
  values, treasury recipient, and transaction hashes in `docs/BASE_DEPLOY.md`, and update
  `docs/PRODUCTION_RUNBOOK.md`, the Phase 9/10 plans, and the Base A1 readiness row. Do not mark
  the Base Mainnet gate complete or enable `eip155:8453`.
- The combined live smoke must prove the web path as well as contract accounting: a buyer purchase
  verified through `/api/skills/{id}/purchase/verify`, signed raw download success for that buyer,
  rejection for a non-buyer, then the financial report/crank/refund/reclaim evidence with USDC
  deltas at explicit blocks. Record environment variable names only:
  `BASE_SEPOLIA_RPC_URL`, `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL`,
  `NEXT_PUBLIC_BASE_AGENTVOUCH_ADDRESS`, and `NEXT_PUBLIC_BASE_AGENTVOUCH_FROM_BLOCK`.
- The existing rollback statement is incomplete for Base. Skill rows bind
  `evm_contract_address` and purchase verification rejects a row bound to a different configured
  contract. Before changing the global contract env, inventory candidate-bound rows and use an
  isolated development smoke or an approved rollback treatment for those rows. Do not assume an
  env-pointer reversal alone restores new candidate listings.

## Reviewer Follow-up (2026-07-09 — plan gate, reviewed against `main` at `98712d9`)

Contract facts re-verified before ruling: `resolveReport` currently pays
`returnedReporterBond + slashedAuthorBond` straight to the reporter
(`AgentVouchEvm.sol:563-565`); `initializeConfig` is init-once with no treasury recipient field;
`Deploy.s.sol` sets `slashPercentage = 100`, `refundClaimWindowSeconds = 0`,
`challengerRewardBps = 0`; the `0x92e928f4` selector hard-code is real
(`web/lib/adapters/baseWallet.ts:71`). The Implementer Review's facts hold. Two classes of
change are required before implementation starts; both are resolved below so the loop can
proceed on the next pass without re-litigating.

### 1. Restore content dropped from the committed plan

This enhanced plan replaced the "Final pre-loop review (2026-07-09)" section committed to
`.agents/plans/base-a1-voucher-slashing-port.plan.md` at `7f63a13` and reverted that commit's
enriched `implement-contract` / `verify-and-record` todo texts. Most facts were independently
re-covered by the Implementer Review; the following were lost and are restored here as binding:

- **Supersede the live candidate.** The fresh Sepolia deploy supersedes the PR #85 candidate
  `0x5992dD52Ee2015f558D0A690777C55e27b05B7d1`: repoint the envs PR #85 pointed at it, record
  both addresses in `docs/BASE_DEPLOY.md`, and bump `PROTOCOL_VERSION` (matching the Implementer
  Review's distinct-version requirement) so PR #90's live provenance reads distinguish
  pre/post-slashing rows.
- **Publisher-auth scope (PR #88).** Any new web mutation this plan introduces must follow
  `assertPublisherAuthMessageScope`. Current scope adds none — this binds against scope creep.
- **Text-corruption note.** Design-lock resolution 4's "existing revoke exit lock - new
  `vouch()` entry lock" is a mangling of the committed "exit lock **plus** the new `vouch()`
  entry lock". Read it as "plus" — both locks are required; do not implement an either-or.

### 2. Blocking financial-settlement decisions — resolved

Decisions 1–2 below are resolved from the founder-acked design-lock (2026-07-06) so
`implement-contract` and `forge-tests` may start. Decisions 3–4 are re-scoped as deploy-time
human gates on `verify-and-record`; they do not block contract code.

1. **Claim cohort — RESOLVED: all verified paid purchases of the referenced listing (any
   revision), narrow-claim formula, no exposure counters.** Per-claim =
   `min(remaining bucket, that purchase's paid price)`, one claim per purchase id, inside the
   window — design-lock resolution 2 verbatim and the `7f63a13` todo text. No purchase
   enumeration or exposure snapshot is needed because buyer-first is proven by *sequencing*
   (decision 2), not by counters. Docs must state the cohort explicitly: claims-on-demand,
   first-come within the window.
2. **Funding order and reporter payout — RESOLVED: window-expiry sequencing; financial-branch
   author bond joins the refund reserve.** Financial branch: at `resolveReport(Upheld)` the
   reporter's own bond is returned, but the slashed author bond goes into the ring-fenced refund
   bucket as first-loss buyer protection (invariant 9), NOT to the reporter. The reputation-only
   branch keeps the current PR #78 routing (slashed bond → reporter) unchanged. The reporter
   reward becomes payable only after the refund claim window expires — buyer exposure is then
   satisfied by construction — computed as `min(snapshotted bps × total slashed amount,
   snapshotted absolute cap, available non-slashed author proceeds of the referenced listing)`
   and funded solely from those proceeds (preserved mid-report by Implementer Review amendment
   4's `withdrawAuthorProceeds` dispute-lock), followed by the one-time residual sweep to the
   treasury recipient. The financial-branch bond-routing change is a dated divergence from
   design-lock resolution 1's "existing `min(authorBond, reportBond)` behavior" phrase (which
   locked the *amount*, not the *destination*) — flag it explicitly in the PR description for
   founder veto.
3. **Treasury recipient — RESOLVED as mechanism, human-gated as value.** Add
   `treasuryRecipient` to the `Config` struct, validated non-zero in `initializeConfig`,
   immutable like the rest of config. Tests use a fixture address. The concrete address is a
   founder-provided deploy input recorded in `docs/BASE_DEPLOY.md` before the
   `verify-and-record` deploy — never `msg.sender`, never the close caller.
4. **Live parameters — human gate on `verify-and-record` only.** Before the fresh Sepolia
   deploy the founder supplies non-placeholder `refundClaimWindowSeconds`,
   `challengerRewardBps`, `challengerRewardCapUsdcMicros`, the treasury address, and confirms or
   revises `slashPercentage` (currently 100 in `Deploy.s.sol` — a 100% voucher slash is a
   deliberate economics choice, not a default to inherit silently). Forge tests must not depend
   on production values and must include a non-100 partial-slash fixture.

### Additional binding notes

- **Serialization griefing accepted for v1.** Implementer Review amendment 2's
  serialize-all-reports guard means a cheap hostile report blocks a real buyer's financial
  report until resolved. Accepted: the resolver's `forfeitReporterBond` lever is the documented
  deterrent; note the resolver-responsiveness dependency in the `docs/MAINNET_READINESS.md` A1
  row at closeout.
- With decisions 1–4 recorded above, the Implementer Review's "do not authorize implementation
  before the stated economics/custody decisions are recorded" gate is cleared for
  `implement-contract`, `forge-tests`, `sync-artifacts`, and `web-trust-surfaces`;
  `verify-and-record` remains human-gated on decision 4. Any implementation-time divergence from
  these resolutions gets a dated note appended here, per the design-lock rule.

## Implementation Enhancements (2026-07-09 — final pre-implementation audit)

These requirements are additive to the existing todo IDs and statuses. No implementation has
started. Current source verification passed `forge test --root contracts/base-poc` (85/85), and
`forge build --root contracts/base-poc --sizes` reports `AgentVouchEvm` at 20,663 runtime bytes,
leaving 3,913 bytes below the EIP-170 limit.

### Parked financial-report lifecycle and replay bounds

1. A financial `resolveReport(Upheld)` must park rather than close. It may return the reporter
   bond and move the author-bond first-loss amount into the report reserve, but it must leave
   `profiles[author].openDisputes` nonzero, retain `lockedByDispute`, and retain the two-sided
   membership freeze until terminal finalization. The current unconditional decrement in
   `resolveReport` cannot be reused for this branch.

2. Only these paths may decrement `openDisputes`, clear the listing lock, and move the financial
   report to terminal `Resolved`:

   - a dismissed financial report;
   - an upheld financial report with a zero backing snapshot after its reserve is funded; or
   - the final successful crank after `processedPreSlashStake == snapshottedPreSlashStake`.

   Increment `upheldDisputes` exactly once at that same terminal transition so trust totals never
   count a parked report twice. During `SlashingVouchers`, a new vouch, revocation, author-bond
   withdrawal, second report, listing removal, revision bump, and all purchase lanes must remain
   blocked.

3. Bind each paid receipt to one financial report permanently with an init-once
   `financialReportIdByPurchase[purchaseId]`-style guard. A dismissed or terminal report still
   consumes that receipt; reopening it is out of scope. Without this, the same historical purchase
   can repeatedly create author-wide slash opportunities after locks clear.

4. Preserve the existing `openReport(address,string)` selector and `AuthorReportOpened` event
   shape for the browser/passkey reputation-only flow. Add a distinctly named financial-report
   entry point and additive financial lifecycle events; do not overload or mutate the legacy
   receipt-parsed event.

5. `slashReportVouches` must require `report.status == SlashingVouchers`, a live vouch whose
   `vouchee == report.author`, and a report-local unslashed marker. Repeated calldata may cleanly
   revert or skip, but cannot change processed stake or reserve funds twice. Define slash rounding
   as per-position floor, retain `preSlashStake - slashAmount` as the reclaimable residual, and
   use overflow-safe multiplication/division.

6. The Slashed exit must transition `Slashed → Revoked` after terminal report close, transfer only
   the residual, zero `stakeUsdcMicros`, and not decrement the author aggregate a second time.
   A subsequent fresh vouch by that voucher must work.

### Report-scoped reserve, claim-window, and reward accounting

1. The claim cohort spans every paid purchase of the referenced listing across revisions, while
   `ListingSettlement.slashedDepositUsdcMicros` is scoped to `(listingId, revision)`. Therefore,
   refund accounting must be report-scoped: use a report reserve and a
   `(reportId, purchaseId)` claim guard, or otherwise prohibit a later report until the earlier
   pool has fully closed. Do not use one revision settlement bucket as the authoritative reserve
   for all-revision claims or for sequential reports.

2. A claim takes `(reportId, purchaseId)` and validates in O(1): the purchase exists, belongs to
   `msg.sender`, names the report listing, has a paid price, predates or is contemporaneous with
   report opening, and has not claimed from that report. It pays
   `min(reportRemainingReserve, purchase.priceUsdcMicros)`. This avoids web-style revision scans
   and ensures a later revision bump cannot strand an otherwise eligible receipt.

3. Set `refundFundedAt` and `refundDeadline` only after the zero-snapshot finalization or final
   crank has funded the complete reserve. Claims and expiry sweep must reject before funding;
   the deadline must never run from upheld resolution while an incomplete permissionless crank is
   still pending. A financial-report-capable configuration requires a positive claim window; the
   A1 deploy must fail closed instead of inheriting the current zero-second placeholder.

4. Before clearing `lockedByDispute`, calculate and debit a report-owned reporter-reward reserve
   from explicitly eligible non-slashed author proceeds. The existing post-window formula cannot
   read an unreserved settlement balance after the listing unlocks, because the author could
   withdraw it first. Record the exact O(1) source scope in the implementation: absent an approved
   maintained listing-wide aggregate, use the referenced purchase revision's settlement rather than
   iterating every historical revision. Pay that reserve only after the claim window; it is not a
   refund-reserve asset and cannot reduce buyer claims.

5. The close path must be one-time and permissionless after the deadline: pay the reserved reporter
   reward, send only the remaining report refund reserve to immutable `treasuryRecipient`, mark
   the report reserve closed, and emit both payments. Neither `msg.sender` nor the author may
   receive unclaimed slash funds.

### ABI, Base-read, and candidate-cutover requirements

1. Appending fields to `Config`, `AgentProfile`, or `AuthorReport` changes the ABI encoding of
   `getConfig`, `getProfile`, and `getAuthorReport`. The web hard-codes their complete tuples in
   `web/lib/adapters/agentVouchEvmAbi.ts`, and both `baseAuthorTrust.ts` and the passkey write path
   read them directly. Preserve the legacy getter layouts with additive A1-specific views, or
   choose `PROTOCOL_VERSION`-selected legacy/new ABIs before reading an expanded tuple. Test the
   new web against both the previous immutable candidate and the new candidate so an env rollback
   cannot turn trust/config reads into decode failures.

2. Append `treasuryRecipient` rather than inserting it into `Config`; update every current Solidity
   config factory (`State`, `BondsVouchesListings`, `Purchase`, `Reports`, `UpdateListing`, `X402`,
   and `Gasless4337`), `Deploy.s.sol`, all ABI tuple fragments, and the passkey write ABI.

3. Base trust must stay chain-qualified and `Review`-oriented. Thread an explicit Base chain context
   through `buildAgentTrustSummary` callers in the author/detail surfaces, keep Base fallback
   verdicts out of generic Solana `allow`/`Trusted` presentation, and extend affected API/detail/
   browse tests for an EVM author with no resolved identity. Continue to avoid Solana trust
   snapshots for `0x` authors.

4. Separate a live listing's **purchasability** check from an existing buyer's **receipt**
   verification in `web/lib/basePurchaseVerification.ts`. A financial listing lock must reject new
   purchase verification but must not make an existing, matching receipt unverifiable merely
   because `lockedByDispute` is true. Test the signed raw-download/entitlement recovery path while
   a report is parked, as well as rejection for a non-buyer.

5. Treat the Sepolia candidate replacement as an explicit forward cutover choice. A row bound to
   the old `evm_contract_address` is rejected by direct verification after an env switch, while
   marketplace reads may use the globally configured contract. Before changing shared envs, choose
   either an isolated fresh-DB smoke with no production pointer change or an approved relink/
   republish/cutover plan that proves old and new rows plus existing entitlements behave correctly.

### Deployment, observability, and verification additions

1. `Deploy.s.sol` must hard-revert unless `block.chainid == 84532`; a hard-coded
   `eip155:84532` config string alone does not prevent an accidental Base mainnet broadcast.
   Do not introduce a proxy, `via_ir`, or build-toolchain change as a code-size workaround without
   explicit approval.

2. Require explicit non-placeholder A1 deployment inputs for the claim window, reward bps/cap,
   slash percentage, and nonzero treasury recipient. Record the selected values and role holders
   in `docs/BASE_DEPLOY.md`; never print private keys. Update selector/event/config verification
   steps for the financial report, crank, claim, reserve close, and Base
   `NEXT_PUBLIC_BASE_AGENTVOUCH_FROM_BLOCK`.

3. Add indexed park/progress/finalization/refund-claim/reward/sweep events and ABI coverage.
   Commit a resumable A1 smoke/crank script or harness that accepts the deployment from-block,
   derives or accepts an explicit voucher set, deduplicates, chunks calls, resumes from on-chain
   report progress, and verifies final accounting. It must respect Base Sepolia public RPC
   historical-log limits; do not rely on an unbounded archive log query.

4. Extend Forge coverage with:

   - parked-state locks after resolution but before final crank, including vouch, revoke, bond
     withdrawal, second report, all purchase lanes, and listing mutation;
   - permanent same-purchase report rejection, report-pool isolation across sequential reports, and
     claim/sweep rejection before reserve funding;
   - claim deadline start only after finalization, positive-window deployment validation, and
     post-finalization reporter-reward reservation before the author can withdraw proceeds;
   - wrong-vouchee/revoked/duplicate crank inputs, non-divisible partial-slash rounding, final
     accounting equality, and Slashed-to-Revoked-to-revouch;
   - legacy ABI reads against the previous candidate plus version-aware/new ABI reads against the
     new deployment;
   - a Base existing-purchase verification path that survives a listing dispute lock while new
     purchases remain rejected;
   - the full financial pause matrix, malicious-token reentrancy, and a conservation invariant
     including report bonds, author bonds, live stakes, residual stakes, voucher liabilities,
     reporter reserve, refund reserve, and treasury sweep.

5. Keep the `forge build --root contracts/base-poc --sizes` checkpoint in the PR verification
   record. Stop implementation for approval if runtime bytecode reaches or exceeds 24,576 bytes.

## Fixer Run Note (2026-07-09 — review 2)

- Sequencing constraints were re-verified before edits: `base-update-skill-listing` is already in
  the branch ancestry, this loop ran second, and the founder-acked claim-cohort/funding-order
  decisions were treated as fixed.
- Reviewable local progress before the protected size gate fired:
  `withdrawAuthorProceeds` now rejects a listing locked by a financial report; `Deploy.s.sol`
  hard-rejects non-Base-Sepolia chain IDs and requires explicit nonzero A1 deployment inputs; and
  the isolated UI/harness ABIs include the additive financial-report lifecycle and rollback-safe
  legacy views.
- **STOP-THE-LINE:** `forge build --root contracts/base-poc --sizes` reports
  `AgentVouchEvm` runtime size `27,931` bytes, which is `3,355` bytes above the EIP-170
  `24,576`-byte limit. Per Deployment, observability, and verification addition 5, implementation
  stopped for operator approval. No proxy, `via_ir`, build-toolchain change, feature deletion, or
  contract split was selected autonomously.
- All unfinished todos remain `in_progress` because work began but their done-when conditions are
  unmet. No A1 behavioral suite or web trust/receipt patch was completed before the stop.

## Closeout

Verified:

- `cwd=/Users/andysustic/Repos/agentvouch` — `git diff --check` passed.
- `cwd=/Users/andysustic/Repos/agentvouch` — `npm run format:check` passed.
- `cwd=/Users/andysustic/Repos/agentvouch` — `forge test --root contracts/base-poc` passed all
  85 existing tests across seven suites; this is regression evidence only because the required
  A1 behavioral suite does not exist yet.
- `cwd=/Users/andysustic/Repos/agentvouch/contracts/base-poc` —
  `forge fmt --check script/Deploy.s.sol` passed.
- `cwd=/Users/andysustic/Repos/agentvouch/contracts/base-poc/harness` —
  `npm run typecheck` passed.
- `cwd=/Users/andysustic/Repos/agentvouch/contracts/base-poc/ui` — `npm run typecheck` passed.

Attempted-blocked (cause):

- `cwd=/Users/andysustic/Repos/agentvouch` —
  `forge build --root contracts/base-poc --sizes` compiled, then exited 1 because
  `AgentVouchEvm` is `27,931` runtime bytes, `3,355` over EIP-170. This protected gate blocks a
  deployable candidate and requires an operator-approved size strategy.
- `cwd=/Users/andysustic/Repos/agentvouch` —
  `forge fmt --check --root contracts/base-poc` remains non-green on existing formatting deltas
  in `AgentVouchEvm.sol`; no source-wide formatting rewrite was made after the stop.

Deferred (tracked in):

- Operator decision on a code-size strategy that preserves the locked economics and ABI, or
  explicit approval for an otherwise-prohibited architecture/toolchain change — this plan's
  EIP-170 stop gate.
- Full A1 Forge coverage, web A1 trust/receipt surfaces, the resumable crank harness, compiled ABI
  parity automation, readiness/runbook updates, and the full web gate — existing todos
  `forge-tests`, `sync-artifacts`, `web-trust-surfaces`, and `verify-and-record`.
- Founder-provided live values for `SLASH_PERCENTAGE`, `REFUND_CLAIM_WINDOW_SECONDS`,
  `CHALLENGER_REWARD_BPS`, `CHALLENGER_REWARD_CAP_USDC_MICROS`, and `TREASURY_RECIPIENT`, followed
  by an explicitly approved Base Sepolia deploy and combined live evidence run —
  `verify-and-record`.

Not claimed:

- The A1 candidate is deployable, merged, deployed, live-smoked, externally reviewed, or ready
  for Base mainnet.
- The A1 Forge suite, web trust surfaces, existing-receipt-under-lock regression, docs/cutover
  updates, full web gate, or human wallet smoke is complete.
- Base mainnet (`eip155:8453`) was enabled or any live transaction was sent.
