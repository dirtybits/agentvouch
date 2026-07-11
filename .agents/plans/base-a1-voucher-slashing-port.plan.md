---
name: base-a1-voucher-slashing-port
overview: "Port the A1 voucher-slashing mechanism (live on Solana devnet since 2026-06-10) into the Base v1 candidate contract, EVM-simplified but invariant-preserving, so upheld paid-listing reports slash linked vouch stake — landing BEFORE the Phase 9c external security review so one review covers the complete mechanism. Approved 2026-07-06 (supersedes the base-port plan's disputes/slashing deferral for Base v1)."
todos:
  - id: design-lock-a1-evm
    content: "DONE 2026-07-06, amended and founder-acked 2026-07-10 — Base vouching is AUTHOR-WIDE (no link_vouch_to_listing exists), financial reports bind one verified paid purchase, slashPercentage is snapshotted with no resolver discretion, and park + permissionless calldata-driven crank is the only slash path. The 2026-07-10 settlement amendment supersedes the original reporter-reward/shared-pool routing: the initiating buyer is the sole A1 refund beneficiary; there is no additional reporter reward and author proceeds are untouched; claims use a finite window; excess slash and expired buyer entitlement become pull-based credit for a dedicated restitution reserve recipient, never unrestricted operating-treasury revenue."
    status: completed
  - id: implement-contract
    content: "Implement the locked design in contracts/base-poc/src/AgentVouchEvm.sol + libraries/AgentVouchTypes.sol + new linked external library libraries/A1Settlement.sol: keep storage, public selectors/modifiers, financial-report opening validation, legacy report flow, and commerce on the facade; delegate financial resolve/park, slash-crank, final allocation, initiating-buyer claim, expiry close, and restitution-reserve claim to A1Settlement without changing storage order. Enable via_ir at optimizer runs=200; keep the live getAuthorReport legacy getter; remove all active reporter-reward accounting; leave author proceeds untouched; calculate buyerEntitlement=min(totalSlash, initiatingPurchasePrice), credit excess/expired entitlement to the dedicated restitution reserve, and keep every payout pull-based."
    status: in_progress
  - id: forge-tests
    content: "Forge suite for the final economics and split architecture: slash math, multi-call crank, completeness, two-sided membership lock, revision/listing dodge blocks, per-(report,voucher) idempotency, dead-position reward solvency, zero-vouch path, pause and reentrancy behavior; initiating purchase is the only eligible refund, entitlement is price-capped and may be partial, no reporter reward or author-proceeds debit occurs, excess slash is reserve credit, expiry moves only unclaimed entitlement to reserve credit, buyer/reserve claims are independent and pull-based, and no arbitrary caller can redirect funds. Add runtime-size assertions for both AgentVouchEvm and A1Settlement and retain the lockedByDispute flag-path regression."
    status: in_progress
  - id: sync-artifacts
    content: "Sync Deploy.s.sol for library-first deployment/linking and explicit nonzero claim-window/slash/restitution-recipient inputs; record and verify both deployed artifacts; sync contracts/base-poc/ui/src/abi.ts, harness ABI fragments, web/lib/adapters/agentVouchEvmAbi.ts, baseAuthorTrust.ts, and chain-map expectations. Preserve the deployed legacy getConfig/getProfile/getAuthorReport read ABI, keep inactive legacy reward fields zero, and keep BaseAdapter server-safe."
    status: in_progress
  - id: web-trust-surfaces
    content: "Expose slashing honestly in web reads: Base skill/author trust shows stake-at-risk and slash history; no synthesized trust; chain-qualified joins preserved. UI actions (vouch/report) remain the Phase 9 report/vouch UI todo — this plan only guarantees the read surfaces reflect the new mechanism."
    status: in_progress
  - id: verify-and-record
    content: "Full gate: forge test and forge build --sizes with AgentVouchEvm <=23,500 runtime bytes and both artifacts <=24,576; web format/lint/typecheck/vitest and next build --webpack; deploy and verify a fresh linked Sepolia library+facade candidate; run backed-purchase -> upheld-report -> multi-call slash -> buyer claim -> expiry/reserve-credit -> reserve claim -> residual-vouch reclaim with tx hashes and USDC deltas; update CHAIN_CAPABILITY_MAP, MAINNET_READINESS, phase-9/10 plans, BASE_DEPLOY, and web/public/skill.md. No Base mainnet enablement."
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

   > **Founder clarification (2026-07-10):** author-wide exposure is a deliberate reputation
   > model, not merely an artifact of the current Base contract. A voucher underwrites the
   > author/agent's portfolio: it shares in reward upside across the author's work and accepts
   > qualifying downside across that work. Product and protocol copy must state that the vouch
   > covers existing and future author work until revoked, rather than implying the voucher
   > reviewed or insured one listing. Do not replace this with listing-scoped allocation in the
   > Base A1 port.

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
   enumeration or exposure snapshot is needed because buyer-first is proven by _sequencing_
   (decision 2), not by counters. Docs must state the cohort explicitly: claims-on-demand,
   first-come within the window.
2. **Funding order and reporter payout — RESOLVED: window-expiry sequencing; financial-branch
   author bond joins the refund reserve.** Financial branch: at `resolveReport(Upheld)` the
   reporter's own bond is returned, but the slashed author bond goes into the ring-fenced refund
   bucket as first-loss buyer protection (invariant 9), NOT to the reporter. The reputation-only
   branch keeps the current PR #78 routing (slashed bond → reporter) unchanged. The reporter
   reward becomes payable only after the refund claim window expires — buyer exposure is then
   satisfied by construction — computed as `min(snapshotted bps × total slashed amount, snapshotted absolute cap, available non-slashed author proceeds of the referenced listing)`
   and funded solely from those proceeds (preserved mid-report by Implementer Review amendment
   4's `withdrawAuthorProceeds` dispute-lock), followed by the one-time residual sweep to the
   treasury recipient. The financial-branch bond-routing change is a dated divergence from
   design-lock resolution 1's "existing `min(authorBond, reportBond)` behavior" phrase (which
   locked the _amount_, not the _destination_) — flag it explicitly in the PR description for
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
   Do not introduce a proxy or any unapproved build-toolchain change. **Superseded 2026-07-10:
   `via_ir = true` at optimizer runs=200 is explicitly approved by the scope amendment below; the
   proxy prohibition remains absolute.**

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

## Scope Amendment (2026-07-10 — post-EIP-170 review)

The 2026-07-09 implementation hit the EIP-170 stop gate: full A1 compiled to 27,931 runtime
bytes, 3,355 over the 24,576 cap. The `base-a1-lite-economics-decision` memo proposed reopening
the locked economics to shrink the contract. This amendment separates the two things that memo
conflated — **code size is an engineering problem, and it should not force an economics
decision** — and resolves them independently. It supersedes the memo (which is retained as a
historical record, banner added).

**Implementation precedence:** this amendment plus the current frontmatter override every earlier
reference in this plan to a shared/multi-buyer A1 claim pool, reporter reward, author-proceeds
reward source, unrestricted `treasuryRecipient`, dropping `getAuthorReport`, or requiring new
approval for `via_ir`. Those earlier passages remain as dated review history and must not be
implemented.

**Measured before deciding** (forge 1.7.1, on this branch; only `out/`+`cache` touched):

| Config                | Runtime bytes | Over cap |
| --------------------- | ------------- | -------- |
| current (`runs=200`)  | 27,931        | +3,355   |
| `runs=1`              | 27,465        | +2,889   |
| `via_ir` (`runs=200`) | 26,545        | +1,969   |
| `via_ir` + `runs=1`   | 26,308        | +1,732   |

Compiler levers alone do not fit. This is architectural — but the standard architectural answer
is packaging, not economics.

### A — Size architecture (engineering directives; no approval needed)

1. **Extract the A1 settlement internals into an external `library` (delegatecall).** A linked
   library gets its own 24 KB budget, so moving the financial-report settlement bodies
   (`slashReportVouches` crank math, refund-bucket accounting, restitution-reserve computation,
   report close) into `library A1Settlement` operating on passed storage refs should land the
   core contract at ~22–23 KB with headroom. This preserves all deployed legacy ABI and the final
   economics locked below; the additive, not-yet-deployed A1 ABI may change to match the final
   fixed-entitlement/reserve lifecycle. It adds a link step and one more artifact to the Phase 9c
   review surface. Verify by measurement, not intuition.
2. **Set `via_ir = true` permanently in `contracts/base-poc/foundry.toml`.** Keep `runs` at 200
   unless a measured reason to drop it appears; the headroom is worth more than marginal runtime
   gas here.
3. **Keep the `LegacyAuthorReport` compatibility getter.** Recon on 2026-07-10 found live
   consumers in the Base UI/harness ABI, web adapter ABI and phase-8 boundary test, Forge report
   tests, deploy verification, and the currently deployed Sepolia report smoke. Removing it would
   break a deployed legacy read surface; recover size through the library split instead.
4. **Add a runtime-size CI gate** (`forge build --sizes` assertion) so a candidate can never
   again exceed EIP-170 silently.
5. **Use pull-based finalization** (buyer/restitution-reserve credits claimed independently; no
   transfer during finalization or expiry close) so a blacklisted or reverting recipient cannot
   brick report finalization or listing unlock.

#### A1Settlement extraction map (locked 2026-07-10)

- Add `contracts/base-poc/src/libraries/A1Settlement.sol` as a linked external library. Its
  state-mutating public library calls must compile to `DELEGATECALL`; do not use an all-`internal`
  library whose code is merely inlined back into `AgentVouchEvm`.
- `AgentVouchEvm` remains the sole storage/custody owner and the only user-facing contract address.
  Keep all existing mappings and fields in their current order; do not consolidate them into a new
  root storage struct or introduce proxy-style storage slots.
- Keep on the facade: initialization and roles, pause/reentrancy modifiers, registration, bonds,
  vouch/revoke, listings, purchase/x402 lanes, author/voucher withdrawals, ID helpers, deployed
  legacy getters/events, `openReport`, the reputation-only resolve branch, and
  `openFinancialReport` validation plus lock-on-open.
- Keep thin facade entry points for `resolveReport`, `slashReportVouches`,
  `claimFinancialReportRefund`, `closeFinancialReportReserve`, and the new fixed-destination
  restitution-reserve claim. `resolveReport` performs the role check and dispatches legacy versus
  financial behavior; every USDC-moving public entry retains the facade's `nonReentrant` guard.
- Move into the linked library: financial upheld/dismissed resolution and parking, author-bond
  first-loss accounting for the financial branch, the voucher slash loop and completeness check,
  final fixed-credit allocation, initiating-buyer claim accounting/transfer, expiry close that
  converts an unclaimed buyer entitlement into reserve credit, and reserve-recipient claim
  accounting/transfer. Keep finalization as an internal helper inside the library.
- Pass the existing concrete `storage` references/mappings plus the facade's immutable USDC value
  into library calls. Under `DELEGATECALL`, `msg.sender`, `address(this)`, token custody, and emitted
  log address must remain those of `AgentVouchEvm`.
- Keep reward-index accrual single-sourced: a small `internal` storage-ref helper in
  `A1Settlement` may be inlined into both artifacts, but do not copy two independently maintained
  accrual formulas or introduce an external self-call back into the facade.
- Preserve custom-error and event selectors in synced ABIs. Events emitted by delegated library
  code must appear from the facade address and must not be double-emitted by wrappers.
- Update `Deploy.s.sol` to deploy/link the library before the facade. Record both addresses,
  bytecode hashes, compiler settings, and verified source/link metadata in `docs/BASE_DEPLOY.md`;
  application env continues to point only at the facade.
- Acceptance gate: `via_ir = true`, optimizer runs=200, `AgentVouchEvm` runtime ≤23,500 bytes, and
  both facade and library runtime ≤24,576 bytes. A breach stops implementation; it does not
  authorize a proxy or another economics cut.

The economics below were decided independently of code size. The library split resolves the size
blocker; it does not justify weakening the final settlement rules.

### B — Economics decisions (FOUNDER-ACKED 2026-07-10)

These decisions supersede only the financial-settlement routing from the 2026-07-06 lock and the
superseded A1-lite memo. Voucher downside, author-wide slash scope, snapshot completeness,
two-sided locks, dead-position semantics, and permissionless cranking remain unchanged.

- **B1 — APPROVED: delete the reporter/challenger reward from financial reports.** The branch
  collapsed reporter == initiating buyer (`openFinancialReport` requires
  `purchase.buyer == msg.sender`), so the refund IS the reporting incentive and a separate reward
  is redundant. Deleting it **removes** the P0.2 resolver+challenger collusion vector entirely
  rather than merely capping it. The upheld report bond principal returns, but there is no profit
  bounty, no debit to author proceeds, and no active A1 reward bps/cap. A separately funded,
  opt-in bug-bounty mechanism is future scope and must not draw from disputed stake.
- **B2 — APPROVED: initiating-purchase-only refund for capped alpha; multi-buyer claims deferred
  to A4.**
  The branch already refunds only the initiating purchase (no multi-buyer pool was ever built).
  The initiating purchase is the sole enforceable Base A1 claim. Other buyers are an explicit A4
  obligation; product/docs must not imply that A1 refunds every harmed buyer. Slash above the
  initiating entitlement is credit for a dedicated, custody-approved restitution reserve
  recipient, never unrestricted operating-treasury revenue. The founder explicitly accepts for
  capped alpha that the configured author-wide slash can exceed one purchase price; that excess is
  a reputation penalty reserved for restitution, not protocol income. This does not complete the
  A4 mainnet-alpha gate.
- **B3 — APPROVED: reject perpetual claims and unrestricted treasury ownership.** Use a finite,
  nonzero deployment-configured buyer claim window. Finalization records credits and unlocks
  without transferring USDC. The buyer pulls during the window; after expiry, a permissionless
  close converts any unclaimed buyer entitlement into restitution-reserve credit without
  transferring it. The immutable restitution reserve recipient pulls its credit independently.
  A blacklisted/reverting buyer or reserve recipient can never block report finalization, listing
  unlock, or the other claimant.

#### Locked financial settlement lifecycle

1. On upheld resolution, return the reporter's original bond principal, slash the author bond
   first, snapshot the author-wide voucher stake and configured slash percentage, and park when
   voucher processing remains.
2. On final crank (or immediately when the backing snapshot is zero), compute:
   `totalSlash = slashedAuthorBond + slashedVoucherStake`;
   `buyerEntitlement = min(totalSlash, initiatingPurchase.priceUsdcMicros)`; and
   `restitutionReserveCredit = totalSlash - buyerEntitlement`.
3. Record the fixed buyer entitlement, finite deadline, and reserve credit; finalize accounting,
   clear protocol locks, and perform no external transfer.
4. Only the initiating purchase buyer can pull the entitlement, once, while the claim window is
   open. A shortfall is an explicitly partial refund; A1 provides no protocol backstop.
5. After the deadline, anyone may close the claim window. Close moves any unclaimed buyer
   entitlement into restitution-reserve credit and performs no transfer.
6. Only the immutable, nonzero, custody-approved restitution reserve recipient can pull reserve
   credit; no resolver, closer, arbitrary caller, author, or operating treasury can redirect it.
7. Buyer claim, close, reserve claim, resolve, and slash-crank remain callable while paused as
   liveness paths. Dismissed-report bond forfeit/return behavior remains unchanged and creates no
   refund or reserve credit.

The inactive legacy challenger-reward fields may remain zero-valued only where required to
preserve deployed legacy tuple/selectors; they are not deployment inputs, snapshots, accounting
fields, events, or payout paths for Base A1. Rename the A1-only appended destination/getter from
generic treasury terminology to restitution-reserve terminology so code and docs cannot treat
dispute-derived funds as operating revenue.

### Net scope after this amendment

Locked mechanism (author-wide slash, ring-fenced bucket, two-sided membership lock, snapshot
completeness, `lockedByDispute` set-at-open + `withdrawAuthorProceeds` freeze + `Slashed` revoke
branch from the pre-loop review) **− reporter reward** **− multi-buyer pool now, deferred to A4**
**+ fixed initiating-buyer entitlement** **+ dedicated restitution-reserve credit** **+ library
packaging + `via_ir` + size gate + pull-based claim/close paths**.

### Solana A1 boundary (verified 2026-07-10)

These B decisions are Base-only and do not authorize edits to the deployed Solana program. Solana
devnet A1 is already live and uses listing-linked vouch positions, ≤4-position permissionless
slash pages, per-dispute/vouch PDA double-slash guards, and
`ListingSettlement.slashed_deposit_usdc_micros` ring-fenced for
`create_refund_pool`/`claim_purchase_refund`. Its current challenger/author-bond routing and broader
reserve/governance gaps remain Solana A2/A4 work if Solana becomes a mainnet target; do not
silently retrofit Base B1–B3 into the Solana rollback path.

### Todo deltas

- `implement-contract`: remains `in_progress`; implement the extraction map and all founder-acked
  B1–B3 settlement decisions together. Keep the legacy report getter; remove active reporter
  reward behavior and generic treasury ownership.
- `forge-tests`, `sync-artifacts`, and `verify-and-record`: remain `in_progress` and must validate
  the final fixed-entitlement/restitution-reserve lifecycle, linked deployment, and dual-artifact
  size gates before Phase 9c review.
- The EIP-170 stop is resolved only when measured section-A gates pass. No economics decision,
  compiler flag alone, or source-level estimate makes the candidate deployable.
