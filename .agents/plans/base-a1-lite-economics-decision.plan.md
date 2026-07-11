---
name: base-a1-lite-economics-decision
overview: "PROPOSED / UNAPPROVED — narrow Base A1 financial settlement to one initiating-purchase refund entitlement with no reporter reward or expiry, while preserving the locked author-wide voucher-slashing safety mechanism and legacy ABI."
todos:
  - id: approve-economic-scope
    content: "Operator explicitly approves or rejects initiating-purchase-only restitution, no reporter reward, no author-proceeds reward source, and a perpetual fully funded buyer entitlement."
    status: pending
  - id: accept-penalty-boundary
    content: "Operator explicitly accepts or rejects preserving the configured author-wide slash percentage when total slash can greatly exceed the sole buyer entitlement, with the excess credited to the immutable treasury recipient."
    status: pending
  - id: accept-a4-alpha-boundary
    content: "Operator decides whether no protocol backstop, possible partial buyer refund, perpetual liabilities, and treasury ownership of excess are acceptable for capped alpha only or also for full mainnet."
    status: pending
  - id: amend-authoritative-plan
    content: "Only after approval, append a dated supersession note to the locked Base A1 plan and reconcile readiness, roadmap, A2/A4, and Phase 9 language without erasing historical decisions."
    status: pending
  - id: implement-lite-lifecycle
    content: "After the decision gates pass, simplify Base A1 state and additive ABI; implement the fixed buyer entitlement and deferred treasury-credit pull paths while preserving every retained slash-safety invariant."
    status: pending
  - id: verify-and-record
    content: "Run Forge unit/fuzz/invariant coverage, ABI/storage comparisons, web gates, runtime-size gate, and an approved fresh Base Sepolia deploy/smoke before changing any launch status."
    status: pending
isProject: false
---

# Proposed Decision Memo: Base A1-Lite Economics

> **Status: SUPERSEDED — 2026-07-10.** Retained as the historical record of the EIP-170 size
> crisis; **do not implement from this memo.** Its central premise — that code size forces an
> economics cut — was refuted by measurement: an external-library (delegatecall) extraction gets
> A1 under EIP-170 with the locked economics intact (see the **Scope Amendment (2026-07-10)**
> section of `.agents/plans/base-a1-voucher-slashing-port.plan.md`, which is now the authoritative
> resolution). Two of this memo's ideas were adopted on their own merits — deleting the reporter
> reward (B1) and pull-based finalization (A5) — and are captured in that amendment behind the
> normal founder-ack gate. Its other narrowings (perpetual no-expiry entitlement, excess
> unconditionally to treasury) were rejected. This file changes nothing on its own.
>
> **Original status (2026-07-09): PROPOSED / UNAPPROVED.**
>
> This memo is not implementation authority. It does not modify or supersede
> `.agents/plans/base-a1-voucher-slashing-port.plan.md`. No contract, ABI, deployment input,
> readiness status, or locked economic behavior changes until the operator explicitly accepts
> every decision gate in this memo.

## Proposed Decision

For a capped Base alpha, preserve the complete voucher-downside safety mechanism but narrow the
financial settlement to the single verified purchase that initiated the report:

1. An upheld financial report still slashes the author bond first and then the author's frozen,
   author-wide active vouch set at the snapshotted slash percentage.
2. The initiating purchase buyer is the only refund beneficiary.
3. Finalization creates one fixed, fully funded, no-expiry buyer entitlement capped at that
   purchase's recorded price.
4. Financial reports pay no reporter/challenger reward and never debit author proceeds.
5. Slash value above the buyer entitlement becomes a report-scoped treasury credit owed only to
   the immutable configured treasury recipient.
6. Finalization performs no buyer or treasury USDC transfer. Buyer and treasury credits use
   independent pull paths so a reverting or blacklisted recipient cannot prevent report
   finalization or listing unlock.

This keeps “vouches carry enforceable monetary downside” while removing the all-buyer first-come
pool, reporter-reward reserve, claim deadline, expiry close, and historical-revision settlement
dependency.

## Why Reopen The 2026-07-06 Lock

The current partial implementation is 27,931 runtime bytes, 3,355 bytes over EIP-170. The
pre-A1 contract was already 20,663 bytes. Size attribution shows that Base A1 added an entire
financial-report settlement workflow, not only a slash operation.

The simplification is primarily a protocol/audit decision, not a bytecode trick:

- A module or contract split can make the current mechanism deployable, but does not reduce its
  economic or audit surface.
- The current broad claim cohort lets one purchase initiate a report whose reserve can be claimed
  first-come by unrelated historical buyers of the same listing across revisions.
- Because the financial reporter must own the initiating purchase, a refund entitlement already
  supplies the reporting incentive. A separate reporter reward is not required for capped alpha.
- Base A4 reserve/backstop policy remains unresolved. A1 should not silently promise full recovery
  or a shared protocol backstop.

Expected source-level savings are approximately 2.3–3.4 KB, but this is not verified and may not
create the required 2 KiB safety headroom. Failure of the size gate returns to a separately
approved module/split decision; it does not authorize `via_ir`, a proxy, or feature deletion.

## Goal

Ship the smallest credible Base alpha mechanism in which a verified paid purchase can trigger
deterministic author-wide voucher slashing and receive a bounded on-chain refund entitlement,
without expanding A1 into a multi-buyer claims market or reporter-bounty system.

## Non-Goals

- No refund eligibility for any purchase other than the initiating verified purchase.
- No first-come shared refund pool across buyers or revisions.
- No reporter/challenger reward on the financial branch.
- No author-proceeds-funded reward or refund backstop.
- No refund deadline, abandoned-claim sweep, or expiry-close lifecycle.
- No guarantee that the initiating buyer recovers the full purchase price.
- No protocol-funded reserve or pro-rata distribution to other harmed buyers; those remain A4.
- No change to legacy reputation-only report economics or ABI.
- No voucher enumeration array, synchronous active-voucher cap, epoch/share haircut, Merkle root,
  proxy, upgrade authority, or Base mainnet enablement.
- No change to the configured slash percentage, per-position floor rounding, dead-position
  semantics, or residual reclaim without a separate approved decision.

## Actors, Assets, And Trust

- **Initiating buyer/reporter:** owns the paid receipt, posts the report bond, and is the sole
  buyer-refund beneficiary.
- **Reported author:** exposes the author bond first, followed by author-wide voucher backing after
  an upheld ruling.
- **Vouchers:** expose author-wide active stake; a processed position becomes dead `Slashed`, stops
  backing/earning, and can reclaim only its residual after terminal finalization.
- **Resolver:** selects only Upheld or Dismissed under existing role controls. The resolver cannot
  select slash percentage, beneficiary, entitlement, treasury recipient, or payout destination.
- **Permissionless cranker:** supplies voucher addresses and advances the deterministic recorded
  ruling without receiving funds or settlement authority.
- **Treasury recipient:** immutable configured recipient of report value exceeding the fixed buyer
  entitlement. Treasury receives a pull credit, not custody or resolver authority.
- **USDC:** custodied by `AgentVouchEvm`; buyer entitlements and treasury credits are explicit
  internal liabilities until successfully claimed.

The proposal does not make adjudication trustless. Resolver custody, role separation, pause
custody, monitoring, and later A2 governance remain launch gates.

## Explicit Economic Deviations Requiring Approval

Approval of this memo would supersede only the financial-settlement portion of the 2026-07-06
Base A1 design lock:

1. **Claim cohort:** every eligible pre-report purchase of the listing across revisions becomes
   exactly the initiating paid purchase.
2. **Allocation:** the first-come shared reserve becomes one fixed entitlement:
   `min(totalReportSlashReserve, initiatingPurchasePrice)`.
3. **Reporter reward:** the financial reporter receives no bounty; only the original report-bond
   principal is returned after an upheld ruling.
4. **Author proceeds:** financial A1 never reserves, debits, or transfers author proceeds.
5. **Expiry:** the buyer entitlement never expires and cannot be swept by admin or treasury.
6. **Treasury ownership:** only `totalReportSlashReserve - buyerEntitlement` becomes treasury
   credit.
7. **Treasury payout:** excess is recorded at finalization and pulled later to the immutable
   recipient; it is not transferred inside finalization.
8. **Shortfall:** the buyer may receive less than the purchase price when combined author-bond and
   voucher slash value is insufficient. There is no A1 protocol backstop.
9. **Excluded buyers:** other potentially harmed buyers receive no on-chain restitution from this
   report.
10. **Penalty excess:** preserving the configured author-wide slash percentage can create treasury
    credit far above the initiating purchase price. Approval must affirm that this is an intended
    reputational penalty rather than accidental over-collection.

If decision 10 is rejected, stop. An exposure-capped proportional voucher-slash formula is a new
economic design and must not be improvised inside the A1-lite implementation.

## Preserved Locked Semantics

The following remain mandatory and are not reopened by this memo:

- A distinct verified-purchase financial-report path; legacy `openReport(address,string)` remains
  reputation-only.
- The initiating receipt belongs to the caller, matches the referenced listing/author, is paid,
  and predates report opening.
- Each purchase can initiate at most one financial report forever, including after dismissal.
- At most one author-bond/voucher-exposing report is active per author.
- Author bond is first loss; voucher liability remains author-wide.
- Slash percentage is deterministic and snapshotted; each position uses floor rounding.
- Vouch entry and revoke remain frozen while the report is Open or `SlashingVouchers`.
- Listing purchase, removal, and revision-changing mutation remain locked from report open through
  terminal finalization. The current conservative proceeds lock also remains unless separately
  approved for removal.
- Upheld resolution stays O(1) and parks when the backing snapshot is nonzero.
- Voucher processing stays permissionless, calldata-driven, retry-safe, and bounded by the input
  array; completeness is proven by accounted pre-slash stake.
- A processed position becomes dead `Slashed`; its full pre-slash amount leaves active backing,
  only the slash amount becomes report reserve, and only the residual is reclaimable after close.
- Pre-slash voucher rewards remain claimable; post-slash reward-index deltas do not accrue.
- Resolve, crank, finalization, buyer claim, and treasury-credit claim remain callable while
  paused where required for liveness.
- Existing legacy selectors, events, enum discriminants, getters, and tuple layouts remain exact.

## Proposed State Reduction

Retain or add only the financial state required for deterministic slashing and two fixed credits:

- Permanent `financialReportIdByPurchase[purchaseId]` replay binding.
- Per-report/per-voucher processed marker.
- Listing and initiating purchase references.
- Snapshotted pre-slash stake and processed pre-slash stake.
- Slashed author-bond and accumulated voucher-slash amounts.
- Snapshotted slash percentage.
- Parked and finalized timestamps needed for lifecycle/indexing.
- Fixed buyer beneficiary, buyer entitlement, and buyer-claimed flag.
- Fixed treasury credit and treasury-paid flag.

Remove from the A1 lifecycle:

- `(reportId, purchaseId)` shared-pool claim mapping.
- Reward settlement revision.
- Snapshotted challenger reward bps and cap.
- Reporter reward reserve.
- Shared `refundRemaining` accounting.
- Refund-funded timestamp, deadline, reserve-closed flag, and expiry-close state.

Legacy config tuple fields for refund window and challenger reward remain in place for ABI
compatibility but are inactive for Base A1-lite. The A1 deployment path must no longer require
nonzero values for inactive fields. `slashPercentage` and `treasuryRecipient` remain explicit,
non-placeholder deployment inputs.

Use compact fixed A1 views instead of returning the complete expanded report struct with duplicated
legacy fields and a dynamic evidence string. Because the A1 ABI is not deployed, this may change
additive A1 return shapes; it must not change legacy ABI.

## State Transitions

### 1. Open

1. Validate registered, distinct buyer and author; nonempty evidence; positive report bond;
   listing ownership; paid purchase ownership; and listing match.
2. Reject a consumed purchase and an existing open report against the author.
3. Permanently bind `purchaseId -> reportId`.
4. Collect the report bond, increment `openDisputes`, freeze author-wide vouch entry/exit, and lock
   the referenced listing immediately.

### 2. Dismiss

1. Apply the unchanged financial reporter-bond return/forfeit rule.
2. Create no buyer entitlement and no treasury credit.
3. Clear locks/freeze, decrement `openDisputes`, and increment dismissed count exactly once.
4. Leave the initiating receipt permanently consumed.

### 3. Uphold And Park

1. Return the reporter's original bond principal.
2. Slash `min(authorBond, disputeBond)` from the author bond into the report reserve.
3. Snapshot total active author-wide backing and `slashPercentage`.
4. If the backing snapshot is zero, finalize immediately.
5. Otherwise enter `SlashingVouchers` while retaining every membership/listing lock.

### 4. Permissionless Crank

For every unique valid supplied voucher:

1. Accrue rewards while the position is still Active.
2. Add the full pre-slash stake to processed completeness.
3. Compute `slashAmount = floor(preSlashStake * snapshottedSlashPercentage / 100)`.
4. Add only `slashAmount` to report reserve.
5. Remove the full pre-slash stake from author active backing.
6. Mark the position `Slashed` and retain `preSlashStake - slashAmount` as residual.
7. Make duplicate/retry calldata a no-op or clean revert with no accounting change.

Finalize only when processed pre-slash stake equals the snapshot exactly.

### 5. Finalize Without External Transfer

Define:

- `totalReserve = slashedAuthorBond + sum(perPositionSlashAmount)`.
- `buyerEntitlement = min(totalReserve, initiatingPurchase.priceUsdcMicros)`.
- `treasuryCredit = totalReserve - buyerEntitlement`.

Then, before clearing locks:

1. Store the buyer beneficiary and fully funded entitlement.
2. Store the treasury credit bound to `config.treasuryRecipient`.
3. Assert `buyerEntitlement + treasuryCredit == totalReserve`.
4. Mark the report Resolved/finalized; clear listing and membership locks; decrement
   `openDisputes`; increment upheld/slash-history counters exactly once.
5. Emit finalization with total reserve, buyer entitlement, and treasury credit.

Finalization performs no USDC transfer. A failing buyer or treasury transfer therefore cannot
strand report locks.

### 6. Buyer Claim

`claimFinancialReportRefund(reportId)`:

- Available after finalization and while paused.
- Caller must be the stored initiating buyer.
- Entitlement must be positive and unclaimed.
- Mark claimed before transfer; a failed USDC transfer reverts the mark atomically.
- Transfer exactly the fixed entitlement and emit report/purchase/buyer/amount.
- No timestamp, expiry, alternate beneficiary, or recovery sweep exists.

### 7. Treasury Credit Claim

`claimFinancialReportTreasuryCredit(reportId)`:

- Permissionless after finalization and callable while paused.
- Credit must be positive and unpaid.
- Mark paid before transfer; a failed transfer reverts the mark atomically.
- Transfer exactly the credit to immutable `config.treasuryRecipient`, never to caller.
- Treasury transfer failure does not affect report status, locks, or buyer entitlement.

This is a payout path, not a deadline-based reserve close.

## Accounting And State Invariants

1. A paid purchase maps to zero or one financial report forever.
2. `report.reporter == initiatingPurchase.buyer == buyerBeneficiary`.
3. At most one author-wide slash-exposing report is active per author.
4. Vouch membership and total active backing remain frozen from open through finalization.
5. Unique processed pre-slash stake never exceeds the snapshot; terminal finalization requires
   equality.
6. Each voucher contributes pre-slash stake and slash amount at most once.
7. `slashAmount = floor(preSlashStake * snapshottedPercentage / 100)` and
   `residual = preSlashStake - slashAmount` for every processed vouch.
8. Full pre-slash stake leaves active backing; a Slashed residual does not decrement backing again
   on revoke.
9. Pre-slash rewards remain claimable; Slashed positions accrue no later reward-index delta.
10. `totalReserve == slashedAuthorBond + sum(voucherSlashAmounts)`.
11. At finalization, `buyerEntitlement + treasuryCredit == totalReserve`.
12. `buyerEntitlement <= initiatingPurchase.priceUsdcMicros`.
13. Buyer entitlement and treasury credit are disjoint, fixed, fully funded liabilities.
14. Neither liability is author-withdrawable or available to voucher-reward, author-proceeds,
    bond, settlement, or generic treasury accounting.
15. Buyer receives its entitlement at most once and at any future timestamp.
16. Treasury credit reaches only the immutable recipient, exactly once; the caller receives zero.
17. Financial reports never pay the reporter beyond return of the original report-bond principal.
18. Financial A1 does not debit author proceeds.
19. Dismissal creates neither liability.
20. Report/listing/profile terminal counters and locks transition exactly once.
21. Contract USDC covers every internal liability across sequential reports, including all
    unclaimed perpetual buyer entitlements and unpaid treasury credits.

## Threat Model And Residual Risks

### Accepted Only With Explicit Operator Approval

- **Author-wide blast radius:** one listing report slashes backing associated with every product by
  the author.
- **Penalty may exceed buyer exposure:** a cheap initiating purchase plus a high slash percentage
  and large backing can create treasury credit many times the buyer's loss.
- **Excluded harmed buyers:** other buyers receive no on-chain restitution even when treasury
  credit exists.
- **No backstop:** collateral shortfall produces a partial refund, not protocol-funded recovery.
- **Permanent liabilities:** lost buyer keys or USDC blacklisting can strand fully reserved USDC
  indefinitely; no admin recovery path exists.
- **Partial-slash dead position:** even a small monetary slash kills the entire backing position;
  the voucher must revoke residual and vouch again after close.

### Mitigated But Not Eliminated

- **Resolver capture/collusion:** immutable economics and recipient prevent resolver redirection,
  but a compromised resolver can uphold a contrived report. Separate resolver/treasury/admin
  custody and A2 governance remain required.
- **Crank liveness:** a missing voucher address keeps locks open indefinitely. Require a resumable
  event-derived voucher inventory, duplicate-safe chunks, progress events, zero-vouch immediate
  finalization, and monitoring.
- **Serialization griefing:** a hostile report blocks later author-wide exposure until resolver and
  crank completion. Reporter-bond forfeiture and resolver response are the v1 mitigation.
- **Recipient transfer failure:** pull credits prevent transfer failure from blocking finalization;
  the liability remains payable for later retry.
- **Cutover/rollback:** every successor deployment must keep old perpetual claims reachable and
  must never treat the contract's raw balance as free treasury funds.
- **No reporter bounty:** buyer refund is the intended reporting incentive; gas/bond opportunity
  cost may still reduce reporting or crank participation.

## ABI And Storage Impact

- Preserve exact legacy selectors and behavior for `openReport`, `resolveReport`, `getConfig`,
  `getProfile`, `getAuthorReport`, legacy report events, and existing custom errors.
- Preserve existing enum discriminants; append-only status rules still apply.
- Keep legacy config tuple fields even when A1-lite no longer uses refund-window/reward values.
- A1-only function/event/view fragments are additive and undeployed; they may be narrowed before
  the fresh candidate, but UI, harness, web, and smoke ABIs must agree exactly.
- Prefer separate A1 extension state or otherwise freeze a documented layout before any proxy-like
  architecture. The existing candidate remains immutable; this memo does not authorize an upgrade.
- `financialReportIdByPurchase` and per-report/per-voucher markers remain. The shared-pool
  purchase-refund mapping is removed.

## Files To Amend Only After Approval

### Authoritative planning and gates

- `.agents/plans/base-a1-voucher-slashing-port.plan.md`: append a dated supersession section;
  update todo acceptance criteria without erasing historical decisions or resetting truthful
  statuses.
- `docs/MAINNET_READINESS.md`: scope harmed-party-first to the initiating verified purchase;
  record no backstop, possible partial refund, perpetual liability, zero financial reporter reward,
  treasury-excess ownership, and whether this is alpha-only under A4.
- `docs/ROADMAP.md`: concise A1-lite/A4 scope only; do not duplicate formulas.
- `.agents/plans/base-port-chain-adapter.plan.md` and Phase 9 plan: append a dated re-scope note;
  keep Phase 9 in progress.
- `.agents/plans/a2-dispute-governance-v1.plan.md`: add a dated Base-baseline compatibility note;
  do not rewrite future A2/Solana economics.

### Implementation and verification

- `contracts/base-poc/src/AgentVouchEvm.sol`
- `contracts/base-poc/src/libraries/AgentVouchTypes.sol`
- `contracts/base-poc/test/AgentVouchEvm.Slashing.t.sol`
- `contracts/base-poc/test/AgentVouchEvm.Reports.t.sol`
- `contracts/base-poc/script/Deploy.s.sol`
- `contracts/base-poc/ui/src/abi.ts`
- `contracts/base-poc/harness/src/abi.ts`
- `web/lib/adapters/agentVouchEvmAbi.ts`
- `web/lib/baseAuthorTrust.ts`
- Resumable Base A1 crank/smoke harness.
- After implementation is true: `docs/BASE_DEPLOY.md`, `docs/PRODUCTION_RUNBOOK.md`, relevant
  Phase 9/10 records, and `web/public/skill.md`.

Do not edit the shipped Solana A1/A3 plans, historical `.a2a` run/review evidence, or Solana
devnet records to describe this proposed Base-only choice.

## Required Regression And Invariant Tests

### Legacy compatibility

- Exact selectors, legacy tuple encodings, enum values, events/indexing, errors, payout behavior,
  and passkey report action.

### Report opening and lifecycle

- Every malformed financial reference combination; historical purchase on a removed listing;
  wrong buyer/listing/author; permanent purchase replay rejection after dismissal and uphold.
- Immediate listing/membership locks; serialized author-wide reports; dismissed, zero-vouch,
  single-page, multi-page, and final-page paths.
- Purchase lanes, revision bump, removal, metadata-only update, bond/proceeds withdrawal, and pause
  matrix match the approved lock policy.

### Slash correctness

- Wrong-vouchee, revoked, duplicate, repeated, empty, and incomplete crank inputs.
- Non-100% per-position floor rounding and exact processed-snapshot equality.
- Pre-slash reward accrual, no post-slash accrual, residual reclaim, and re-vouch.

### A1-lite economics

- Reserve less than, equal to, and greater than initiating purchase price.
- Only initiating buyer receives the fixed entitlement; every other historical buyer/revision
  fails even if it predates the report.
- Entitlement claim succeeds once after long `vm.warp`, listing removal, sequential reports, and
  candidate cutover assumptions.
- Reporter reward and financial author-proceeds debit are always zero.
- Treasury credit equals only excess, is paid exactly once to immutable recipient, and caller gets
  zero.
- Buyer and treasury transfer-revert fixtures do not alter credits or brick finalization/locks.
- Explicit punitive case: low-price purchase, large author bond/backing, 100% slash, large treasury
  credit.
- Explicit shortfall case: collateral below price, partial buyer entitlement, no backstop.

### Global safety

- Reentrancy on every new USDC payout path.
- Resolve/crank/finalize/buyer-claim/treasury-claim liveness while paused as approved.
- Global conservation invariant covering report bonds, author bonds, active vouch stake, Slashed
  residuals, voucher rewards, author proceeds, buyer entitlements, treasury credits, transfers,
  and the contract USDC balance.
- Gas snapshot for recommended crank page size and a resumable duplicate-safe crank harness.

## Verification And Acceptance Gates

Implementation is not complete until all of the following pass:

- `forge test --root contracts/base-poc` including the new A1-lite suite, fuzz, malicious token,
  and conservation invariants.
- `forge build --root contracts/base-poc --sizes` with `AgentVouchEvm` runtime at or below 22,528
  bytes, leaving at least 2 KiB below EIP-170 for review fixes.
- ABI selector/tuple/event comparison against the previous immutable candidate and the current
  legacy web ABI.
- `npm run format:check`, web lint, typecheck, vitest, and
  `npm exec --workspace @agentvouch/web -- next build --webpack` with Node 24.
- UI/harness/web ABI parsing and typechecks.
- No old all-buyer/window/reward/close A1 strings remain outside dated historical records.
- No Base mainnet enablement.

If A1-lite misses the runtime target, stop for an explicit static-module/separate-contract
decision. Compiler-pipeline changes, proxies, and mutable facet routing remain unapproved.

## Rollout

1. Obtain explicit operator acceptance of every open decision below.
2. Amend the authoritative plan and gate documents with dated notes; preserve history.
3. Implement and verify locally; keep all existing todos truthful as work progresses.
4. Obtain separate approval for a fresh Base Sepolia deployment and concrete slash/treasury values.
5. Deploy a distinct immutable protocol version.
6. Smoke:
   `purchase -> financial report -> uphold -> multi-call crank -> final credits -> delayed buyer claim -> treasury credit claim -> residual revoke -> re-vouch`.
7. Record transaction hashes, explicit-block USDC deltas, roles, config, runtime size, outstanding
   liability queries, receipt access while locked, and non-buyer rejection.
8. Run internal and external security review after the complete selected mechanism exists.
9. Do not enable Base mainnet.

## Rollback

- Before deploy: revert the implementation PR; this memo and prior plan remain historical decision
  evidence.
- After Sepolia deploy: preserve old candidate addresses and perpetual claim availability. Use an
  isolated DB smoke or separately approved row relink/cutover plan; a global env-pointer reversal
  does not repair candidate-bound listings.
- Never strand or sweep an unclaimed no-expiry buyer entitlement or unpaid treasury credit.

## Operator Decisions Required

Implementation remains blocked until the operator explicitly answers all of these:

1. Approve initiating-purchase-only restitution and exclusion of other buyers?
2. Accept possible partial refund with no protocol/author-proceeds backstop?
3. Approve no financial reporter reward?
4. Approve a perpetual, non-sweepable buyer entitlement?
5. Preserve the configured author-wide slash percentage even when total penalty greatly exceeds
   the sole buyer's purchase price?
6. If yes to 5, approve treasury ownership of that excess and deferred pull-credit payout?
7. Is this A4 boundary acceptable for capped alpha only, or also for full mainnet?
8. Retain the current conservative listing/proceeds lock through finalization?
9. Approve compact additive A1 views while preserving all legacy ABI exactly?
10. Confirm that a runtime miss returns to a separate architecture decision rather than silently
    adopting `via_ir`, a proxy, or economic changes?

Until these answers are recorded, the existing Base A1 plan remains authoritative and the current
implementation remains blocked at its EIP-170 gate.
