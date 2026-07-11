---
name: base-a1-voucher-slashing-port
overview: "Finish the blocked Base A1 port as a clean-break purchase-backed accountability mechanism: a paid buyer files a 5 USDC bonded pending report, a resolver accepts it before any locks apply, an upheld report settles author-wide voucher downside through a linked library, and only the initiating buyer receives a capped 30-day pull claim. Replace the testnet report ABI coherently, remain below EIP-170 with review headroom, and stop before any unapproved public-network deployment."
todos:
  - id: design-lock-a1-evm
    content: "DONE 2026-07-11 — Founder approved the clean-break PaidPurchaseReport-only ABI, fixed 5 USDC bond lifecycle, reviewPaidPurchaseReport(uint64,bool), 7-day purchase-to-filing window, 7-day rejected/dismissed buyer cooldown, and 3-day Pending review timeout with permissionless expiry and 30-day buyer bond-credit claim."
    status: completed
  - id: implement-contract
    content: "Refactor the existing monolithic WIP into the clean-break PaidPurchaseReport lifecycle plus linked external A1Settlement library; remove general/legacy report and undeployed FinancialReport/reporter-reward/shared-pool state and ABI; remove compatibility-only wrappers; enable via_ir at optimizer runs=200; freeze and compare the final facade/library storage boundary. Design lock completed 2026-07-11."
    status: in_progress
  - id: forge-tests
    content: "Add the dedicated A1 behavioral, fuzz, invariant, pause, reentrancy, concurrency, replay, rounding, liability, library-linking, stale-ABI, and runtime-size coverage specified below. Existing 85 pre-clean-break tests are regression evidence only and do not exercise A1."
    status: pending
  - id: sync-artifacts
    content: "Replace the general/legacy and partial FinancialReport ABI with the final PaidPurchaseReport ABI across Deploy.s.sol, isolated UI, harness, web adapter/passkey consumers, selector/event/error checks, and linked-artifact verification; remove active challenger-reward deployment inputs and add the approved clean-break config."
    status: in_progress
  - id: web-trust-surfaces
    content: "Expose Base A1 slash aggregates and stake-at-risk honestly on chain-qualified Review-oriented trust surfaces; preserve existing receipt redemption while an accepted report blocks new purchases; do not synthesize Solana trust or add report writes without a separately approved UI scope."
    status: pending
  - id: verify-and-record
    content: "Complete local-only gates: exact production-profile runtime budgets for facade and library, Forge suite, ABI/storage/linking checks, root chain-map/format/web gates, deployment rehearsal without broadcast, and readiness/runbook/capability documentation."
    status: pending
  - id: deploy-smoke-sepolia
    content: "HUMAN-GATED: after explicit approval, deploy and verify a fresh linked Base Sepolia candidate, run the full paid-purchase report/crank/refund/reserve/residual smoke with explicit-block USDC deltas, and record both artifacts. Never enable or deploy Base mainnet from this plan."
    status: pending
isProject: false
---

# Base A1 Voucher-Slashing Port

## Implementation source of truth — rewritten 2026-07-11

This file is the sole implementation-facing plan for the current branch
`a2a/base-a1-voucher-slashing-port-20260709`. It rewrites the accumulated plan in place so the
branch, stable todo IDs, review lineage, and measured EIP-170 evidence remain together.

Earlier versions remain available in Git history. They are historical evidence, not competing
requirements. In particular, do **not** implement the earlier general/legacy report path, shared
multi-buyer pool, first-come allocation, reporter/challenger reward, author-proceeds debit, generic
treasury sweep, lock-on-filing behavior, `FinancialReport*` naming, or monolithic full-struct getter.

The current Solidity on this branch is a useful WIP prototype, not the desired specification. The
staged Cursor handoff and `.agents/plans/base-a1-lite-economics-decision.plan.md` are also
non-authoritative historical material.

## Goal

Ship one reviewable Base A1 mechanism that makes author-wide vouch stake carry enforceable
downside when a resolver upholds a verified paid-purchase report, while giving only that initiating
buyer a deterministic, collateral-limited remedy.

Core safety claim:

> An on-chain Base A1 penalty requires a permanently consumed paid-purchase receipt, a meaningful
> reporter bond, resolver acceptance before any protocol lock, and an upheld ruling; each affected
> stake position contributes at most once, and all resulting liabilities remain solvent and
> independently claimable.

## Scope

### In scope

- The complete Base A1 paid-purchase path: admission, review, locks, ruling, author-bond first loss,
  author-wide voucher snapshot, permissionless bounded cranking, final accounting, initiating-buyer
  refund, restitution-reserve credit, expiry, and residual vouch reclaim.
- A linked external `A1Settlement` library plus permanent `via_ir = true` at optimizer runs=200.
- A clean-break, versioned Base Sepolia report ABI with complete client/artifact synchronization.
- Honest Base trust reads, linked deployment tooling, runtime-size CI, runbooks, and a separately
  approved Base Sepolia smoke.

### Out of scope

- Multi-buyer restitution, pro-rata pools, insurance, or a protocol backstop; defer to A4.
- Reporter/challenger or permissionless-keeper rewards.
- Appeals, decentralized adjudication, resolver staking, or A2 governance.
- Retrofitting these Base decisions into the live Solana devnet program.
- A proxy, facets, mutable module routing, or any upgrade key introduced as a size workaround.
- Base mainnet enablement or deployment.
- General on-chain reports. Non-purchase allegations remain off-chain until a separately approved
  A2 governance/adjudication mechanism exists.

## Current branch baseline — verified 2026-07-11

Committed `HEAD` is `588fc96e`; the A1 contract checkpoint is `492f7a06`.

- `AgentVouchEvm.sol` currently contains a monolithic, undeployed additive A1 surface named
  `FinancialReport`: open, resolve/park, permissionless vouch crank, first-come refund claim,
  reserve close, and a 29-field dynamic-string getter.
- It already demonstrates several retained mechanics: paid-receipt validation and permanent
  initiating-receipt consumption, author-wide exposure accounting, idempotent duplicate crank
  skips, exact completion against a snapshot, `Slashed` dead positions, reward-safe residual
  reclaim, and a Base-Sepolia-only deployment guard.
- It conflicts with this plan by locking immediately, lacking Pending/Accepted states and
  buyer/listing guards, allowing any prior same-listing receipt to claim first-come, reserving a
  reporter reward from author proceeds, and pushing expiry funds directly to a generic treasury.
- `A1Settlement.sol`, a dedicated A1 test suite, a soft-size CI check, linked deployment, final
  PaidPurchaseReport ABIs, web trust reads, and live evidence do not exist.
- `forge test --root contracts/base-poc` passed 85 pre-clean-break tests. No test invokes the current A1
  open/slash/refund/close functions, so this is regression evidence only.

### Runtime budget

Measured with Forge 1.7.1, solc 0.8.28, optimizer enabled, and the branch source:

| Profile                  | AgentVouchEvm runtime | EIP-170 hard headroom |
| ------------------------ | --------------------: | --------------------: |
| Current, runs=200, no IR |          27,931 bytes |          -3,355 bytes |
| `via_ir`, runs=200       |          26,545 bytes |          -1,969 bytes |
| `via_ir`, runs=1         |          26,308 bytes |          -1,732 bytes |

Compiler settings alone cannot make the monolith deployable. The target production profile is
solc 0.8.28, optimizer enabled, runs=200, `via_ir = true`; record the resolved EVM target,
metadata, remappings, and link references from `forge config --json` and final artifacts.

| Artifact               | Hard limit | Project soft limit | Required soft headroom |
| ---------------------- | ---------: | -----------------: | ---------------------: |
| `AgentVouchEvm` facade |     24,576 |             23,500 |   at least 1,076 bytes |
| `A1Settlement` library |     24,576 |             23,500 |   at least 1,076 bytes |

Both limits are deployment invariants. A behavioral green suite cannot override either failure.
Report final runtime, delta from the 27,931-byte WIP, hard headroom, and soft headroom. Do not
claim estimated savings as headroom.

## Actors, assets, and trust assumptions

- **Buyer/reporter:** registered Base address that owns the exact paid receipt; funds a fixed
  5 USDC report bond and may receive only that returned principal plus its capped refund entitlement.
- **Author:** registered seller whose author bond and author-wide external vouches may be penalized
  after an accepted, upheld report.
- **Voucher:** external backer of the author. Base vouches are intentionally author-wide and back
  existing and future author work until revoked.
- **Resolver:** `RESOLVER_ROLE`; accepts/rejects pending reports and later rules accepted reports
  upheld/dismissed. This is a trusted adjudicator for A1. Compromise can cause broad author-wide
  penalties; production ownership, monitoring, and response remain readiness gates.
- **Cranker:** any address may submit bounded voucher pages. There is no A1 keeper reward; an
  operator fallback and progress monitoring are required because permissionless does not prove
  liveness.
- **Restitution-reserve recipient:** one nonzero, init-once, custody-approved address. It receives
  only pull-based excess/expired slash credit and cannot redirect buyer credit.
- **USDC:** 6-decimal token held only by `AgentVouchEvm`. The facade remains the sole custody and
  storage owner; the linked library executes in its context by `DELEGATECALL`.
- **Upgradeability:** fresh immutable facade plus immutably linked library; no proxy and no mutable
  implementation pointer. A successor deployment must leave old claim paths available.

## Locked mechanism

### 1. Naming and product boundary

The additive, not-yet-deployed A1 mechanism is `PaidPurchaseReport`, not `FinancialReport`.
Rename the entire new ABI, events, errors, structs, comments, tests, and docs. The product may show
one “Report agent” entry point, but this plan implements the paid-purchase branch only.

`openPaidPurchaseReport(address author, bytes32 listingId, bytes32 purchaseId, string evidenceUri)`
is the new entry point. It must prove that the listing belongs to `author`, the purchase exists,
is paid, belongs to `msg.sender`, names that listing, and satisfies
`block.timestamp <= purchase.timestamp + 7 days`. A removed listing remains reportable when its
historical receipt is otherwise valid. Filing on the boundary is valid; a report filed in time
remains valid through later review and resolution.

### 2. Lifecycle

Define the clean-break `PaidPurchaseReportStatus` lifecycle as Pending, Open,
SlashingVouchers, and Resolved:

| Transition                         | Authority                      | Required effects                                                                                                                                                                           |
| ---------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| File → `Pending`                   | receipt owner                  | Permanently consume the purchase ID; take exactly 5 USDC; occupy buyer/listing active slots; apply no author, listing, vouch, purchase, revision, proceeds, or bond-withdrawal lock.       |
| Pending → `Open` (accept)          | resolver                       | Require no accepted/slashing report for the author; atomically set listing lock, increment the author lock counter, freeze vouch entry/exit and author-bond withdrawal; record acceptance. |
| Pending → terminal rejection       | resolver                       | Credit the 5 USDC bond to the restitution reserve, clear active slots, and create no author reputation counter, lock, slash, or buyer refund.                                              |
| Pending → terminal expiry          | anyone after 3 days            | Create a 5 USDC buyer bond-return credit with a 30-day claim window; clear active slots without author counters, locks, slash, refund, or cooldown; the purchase remains consumed.         |
| Open → terminal dismissal          | resolver                       | Record dismissed outcome once, credit the 5 USDC bond to the restitution reserve, clear every lock and active slot, and create no slash or buyer refund.                                   |
| Open → `SlashingVouchers` (uphold) | resolver                       | Preserve the 5 USDC principal for the buyer's funded claim, slash author bond first, snapshot slash percentage and total active author-wide vouch stake; park when work remains.           |
| Slashing → terminal `Resolved`     | any cranker                    | Process retry-safe pages; finalize only at exact snapshot completion; create fixed buyer/reserve liabilities and clear locks before any payout.                                            |
| Resolved → claimed/expired         | buyer/anyone/reserve recipient | Independently claim buyer credit, convert an expired buyer credit to reserve credit, and pull reserve credit without reopening the report.                                                 |

An upheld report with zero active voucher stake finalizes immediately after author-bond accounting.
A zero-total-slash outcome creates no buyer or reserve credit but still reaches a terminal state.

### 3. Concurrency and replay

- At most one nonterminal paid report per buyer and per listing. “Nonterminal” includes Pending,
  Open, and SlashingVouchers; clear these slots only on rejection, dismissal, or finalization.
- Because the slash set is author-wide, at most one Open/SlashingVouchers report may exist per
  author. Resolver acceptance—not merely filing—must enforce this guard. Multiple different
  buyers/listings may be Pending for an author, but none may acquire the author-wide lock while
  another accepted report remains nonterminal.
- The initiating purchase ID is consumed globally at filing and remains consumed after rejection,
  dismissal, or resolution. It can never trigger another report.
- Each `(reportId, voucher)` contributes at most once. Duplicate/retry calldata is an idempotent
  skip and cannot change processed exposure or funds.
- Pending filings do not touch `profiles[author].openDisputes`. Acceptance increments it exactly
  once; dismissal or finalization decrements it exactly once.
- A rejected or accepted-then-dismissed report sets a global buyer cooldown through
  `terminalTimestamp + 7 days`. During that interval the buyer cannot file against any author or
  listing. Upheld reports and resolver-inactivity expiry do not create a cooldown.
- Pending review expires exactly 3 days after filing. Resolver acceptance at or after the deadline
  reverts. After the deadline, anyone may expire the report, clear buyer/listing slots, and create
  a 5 USDC buyer bond-return credit. The buyer pulls that credit within 30 days of expiry; an
  unclaimed credit then converts to restitution-reserve credit. Expiry never restores the consumed
  purchase receipt and never creates a buyer cooldown.

### 4. Frozen work set and voucher settlement

- On acceptance, block `vouch` and `revokeVouch` for the author, author-bond withdrawal, new
  purchases on the referenced listing, listing removal, and economic revision changes. Existing
  paid receipts must remain verifiable/redeemable. Metadata-only updates may remain allowed.
- On upheld resolution, snapshot the author-wide active-vouch aggregate and configured
  `slashPercentage`. Configuration cannot change a parked report.
- For each active voucher: accrue rewards while Active; count the full pre-slash stake toward
  completion; compute `floor(preSlashStake * slashPercentage / 100)`; remove the full pre-slash
  stake from active backing; mark the position `Slashed`; and retain only the unslashed residual
  for later reclaim.
- `processedPreSlashStake` may never exceed the snapshot. Finalization requires exact equality.
- A `Slashed` position earns no later voucher revenue. After terminal report closure, its voucher
  may reclaim the residual through `Slashed → Revoked` without decrementing author backing twice,
  then vouch again as a fresh position.

### 5. Economic ledgers

Keep ownership and accounting separate even though all USDC is held by the facade:

| Ledger                    | Funding source                                     | Beneficiary and priority                                                                                                       | Cap / failure rule                                                                                                |
| ------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Report bond               | buyer pays exactly 5 USDC at filing                | On upheld outcome or Pending expiry, add principal to a 30-day buyer claim; on rejection/dismissal, credit restitution reserve | No separate bond claimant, reward, dynamic formula, or resolver-selected destination                              |
| Enforcement               | author bond first, then active author-wide vouches | Creates penalty assets only after upheld ruling                                                                                | `min(authorBond, snapshottedReportBond) + sum(floor(vouchStake_i * slashPercentage / 100))`                       |
| Buyer restitution         | enforcement assets                                 | Initiating receipt owner has first priority                                                                                    | `buyerEntitlement = min(totalSlash, initiatingPurchase.priceUsdcMicros)`; partial refund allowed; no backstop     |
| Reporter/keeper incentive | none                                               | none                                                                                                                           | No reward, author-proceeds debit, or slash-funded bounty                                                          |
| Restitution reserve       | enforcement excess plus expired buyer entitlement  | Immutable reserve recipient                                                                                                    | `reserveCredit = totalSlash - buyerEntitlement`, later increased only by expired unclaimed entitlement; pull-only |

The 30-day buyer deadline starts only after the full voucher work set is processed and the fixed
claim is funded. On an upheld report,
`buyerClaimCredit = 5 USDC bond principal + buyerEntitlement`. Finalization records liabilities,
reaches terminal state, and releases locks before any external transfer. The initiating buyer
claims once. After the deadline, any caller may convert the entire unclaimed buyer claim—including
the returned bond principal—to reserve credit without transferring USDC. Only the immutable reserve
recipient may pull reserve credit.

There is no protocol backstop. A collateral shortfall is an explicitly partial refund. The
author-wide penalty may exceed the proven purchase loss; that excess is an intentional reputation
penalty reserved for restitution, not operating revenue. Raw contract balance is never evidence of
surplus while any author proceeds, voucher revenue, stake, bond credit, buyer entitlement, or
reserve credit remains outstanding.

If the immutable reserve recipient is blacklisted, reverts, or loses its key, its credit remains an
indefinite protocol liability; it cannot block report finalization and A1 provides no redirect or
recovery authority. Any future recovery mechanism is a separately approved custody change.

### 6. Trigger-to-penalty proportionality

| Dimension            | Locked treatment                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------- |
| Trigger cost         | Paid purchase + 5 USDC at-risk report bond + permanent receipt consumption                |
| Trigger scope        | One paid listing report; resolver acceptance required                                     |
| Proven loss          | Initiating purchase price                                                                 |
| Penalized exposure   | Bounded author bond plus configured percentage of all active author-wide vouches          |
| Maximum buyer payout | Returned 5 USDC principal plus the lesser of total slash and initiating price             |
| Capturable excess    | None for buyer, reporter, resolver, closer, or operating treasury; reserve recipient only |

Residual risk: a compromised or colluding resolver can accept and uphold a low-price purchase
against much larger author-wide backing. Lack of reporter profit reduces extraction but does not
remove destructive griefing. Role custody, monitoring, incident response, slash percentage, and
launch exposure caps must be accepted in `docs/MAINNET_READINESS.md`; A1 has no appeal mechanism.

## ABI, state, and linked-library architecture

### Clean-break Base Sepolia ABI

The founder approved a full report-subsystem clean break on 2026-07-11 because every Base contract
is still testnet-only. Remove `openReport`, `_resolveLegacyReport`, `getAuthorReport`, the generic
author-report events/types, and every compatibility-only report wrapper. Remove the partial
`FinancialReport*` ABI as well. The fresh candidate exposes only `PaidPurchaseReport` semantics.

There is no requirement to preserve the prior `initializeConfig`, `getConfig`, or `getProfile`
tuple selectors on the fresh candidate. Do not redesign unrelated commerce semantics gratuitously,
but prefer one canonical final config/profile representation over duplicate legacy wrappers. Put
the fixed 5 USDC report bond, 7-day purchase-to-filing window, 7-day rejected/dismissed cooldown,
3-day Pending review timeout, and 30-day buyer claim window in named constants; validate the
remaining paid-report settings and nonzero restitution-reserve recipient through the clean-break,
init-once configuration path. No setter may mutate accrued reports or liabilities.

Use compact fixed-field report core and settlement views plus a separate evidence-string read. Do
not return the entire dynamic 29-field WIP struct. Measure every public getter and compatibility
removal under the production compiler profile, and update all clients atomically with the new
versioned deployment.

### Final state boundary

- Delete general/legacy author-report state and compatibility structs. Store only the compact
  paid-purchase lifecycle/accounting required by this plan.
- Remove `rewardSettlementRevision`, challenger reward snapshots/cap, reporter reward reserve,
  and the per-(report,purchase) refund mapping. A single initiating claimant needs only a fixed
  entitlement and one claimed/expired marker.
- Add permanent purchase replay, per-report voucher replay, active buyer/listing guards, and an
  accepted/slashing author guard. Record aggregate outstanding restitution-reserve liability.
- This is a fresh immutable deployment, not a proxy upgrade. The undeployed WIP storage slots need
  not be preserved. Freeze the final layout before implementing library calls, capture
  `forge inspect ... storage-layout`, and test that the library has no independent state.

### `A1Settlement` extraction

- Add `contracts/base-poc/src/libraries/A1Settlement.sol` as a linked external library. Its
  state-mutating public calls must compile to linked `DELEGATECALL`; an all-internal library that
  inlines back into the facade does not satisfy the size architecture.
- `AgentVouchEvm` remains the sole address, storage owner, custody owner, reentrancy boundary, and
  event origin. The library address is fixed in deployed bytecode and is not upgradeable.
- Keep on the facade: roles/init/pause/reentrancy, commerce, bonds, vouch entry/revoke, listing and
  purchase lanes, paid-report validation/review wrappers, compact views, and all user-facing
  selectors.
- Move to the library: accepted paid-report resolution, author-bond first-loss accounting, voucher
  crank and completeness, final fixed-credit allocation, buyer-claim accounting/transfer, expiry
  conversion, reserve-credit accounting/transfer, and internal finalization.
- Pass explicit storage references and the immutable USDC value. Review every library argument as
  an authorization boundary. Keep reward-index accrual single-sourced; do not create an external
  self-call into the facade.
- Events emitted in delegated code must originate from the facade and must not be double-emitted.
  Test missing/wrong link deployment, bytecode mismatch, caller context, pause behavior, and
  reentrancy.

## Proposed additive ABI — lock before contract edits

The clean-break additive surface is:

| Purpose               | Proposed surface                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| File                  | `openPaidPurchaseReport(address,bytes32,bytes32,string)`                                                  |
| Accept/reject pending | `reviewPaidPurchaseReport(uint64,bool)`                                                                   |
| Final ruling          | `resolvePaidPurchaseReport(uint64,Ruling)`; bond routing is deterministic and has no resolver payout flag |
| Crank                 | `slashPaidPurchaseReportVouches(uint64,address[])`                                                        |
| Buyer claim           | `claimPaidPurchaseReportCredit(uint64)`                                                                   |
| Expire buyer claim    | `closePaidPurchaseReportCredit(uint64)`                                                                   |
| Reserve pull          | `claimRestitutionReserve()`                                                                               |
| Reads                 | compact fixed-field paid-report core/settlement views plus a separate evidence-string read                |

Emit indexed events for filing, acceptance/rejection, upheld parking, per-vouch progress, final
allocation, buyer claim, buyer expiry-to-reserve, reserve claim, and terminal dismissal. Include
enough state for a reorg-aware indexer and resumable cranker without requiring unbounded log scans.
`reviewPaidPurchaseReport` emits distinct Accepted and Rejected events and stores no on-chain reason
payload; the resolver's detailed rationale belongs in the off-chain case record keyed by report ID.

## Implementation steps

1. **Use the completed design lock.** Implement only the dated 2026-07-11 decisions in this file;
   do not infer values or behavior from the WIP or historical plans.
2. **Normalize types/state/ABI.** Remove general/legacy report and compatibility-only state; define
   one clean-break config/profile/report ABI; rename all undeployed A1 surfaces; remove
   reward/shared-pool state; freeze final storage layout and selector/event tables.
3. **Implement admission/review.** Add filing-window validation, purchase replay, pending state,
   buyer/listing guards, cooldown, resolver acceptance/rejection, and accepted-report author
   serialization. Prove pending reports have no locking side effects.
4. **Extract settlement.** Enable `via_ir`; add and link `A1Settlement`; move resolution, crank,
   final accounting, claims, expiry, and reserve pull behind thin `nonReentrant` facade wrappers.
5. **Complete facade integration.** Apply and clear every accepted-report lock exactly once; retain
   existing-receipt redemption; remove the general report path entirely; keep all terminal and
   claim paths callable under pause.
6. **Add tests and runtime gates.** Implement the matrix below plus a dependency-free root
   `scripts/verify-base-runtime-size.mjs` and npm/CI command enforcing both soft and hard limits.
7. **Sync artifacts and web reads.** Update all ABI fragments, selector/error/event parity,
   deployment/linking scripts, chain-map expectations, Base trust aggregates, mocks, and docs.
8. **Verify locally and stop.** Complete `verify-and-record`, including a no-broadcast linked
   deployment rehearsal. Do not enter `deploy-smoke-sepolia` without explicit approval.

## Required regression and adversarial tests

### Admission, authority, and concurrency

- Wrong/nonexistent/free/other-buyer/other-listing receipt, self-report, empty evidence, stale
  receipt, reused receipt, active buyer/listing slot, and dismissed-buyer cooldown all revert.
- A valid removed-listing receipt remains eligible within the approved filing window.
- Pending filing takes the correct bond and consumes the receipt but cannot lock or change author
  counters, vouches, purchases, proceeds, listing revisions/removal, or author-bond withdrawal.
- Only resolver may review/resolve. Acceptance applies every lock atomically. Rejection clears
  slots with no author reputation effect. A second author-wide acceptance is impossible.
- Acceptance at/after the 3-day Pending deadline reverts. Permissionless expiry clears slots,
  creates exactly one 5 USDC buyer credit, starts its 30-day claim clock, creates no cooldown, and
  leaves the purchase consumed; duplicate expiry/claim and late claim revert, and late unclaimed
  credit converts once to reserve credit.
- Removed general/legacy report selectors cannot remain reachable through stale ABI fragments or
  compatibility wrappers.

### Settlement and accounting

- Dismissed, upheld-zero-vouch, partial-slash, multi-call, empty page, out-of-order page,
  duplicate-in-page, duplicate-retry, wrong vouchee, revoked/slashed vouch, and exact-final-page
  behavior.
- Fuzz slash floors, caps, values near type limits, processed exposure, and the equality required
  for finalization. Test penalty below/equal/far above purchase harm.
- Prove pre-slash rewards remain claimable, post-slash rewards stop, residual reclaim happens once,
  author backing decrements once, and fresh revouch succeeds.
- Initiating buyer only; fixed partial/full entitlement; no same-listing historical buyer claim;
  one claim; claim before funding/after expiry rejection; exact 30-day clock from finalization.
- No reporter reward or author-proceeds debit. Excess and expired entitlement become reserve
  credit only; no closer/resolver/author/operating-treasury redirection.
- Global conservation across purchases, author proceeds, author bonds, live/residual vouch stake,
  voucher rewards, report bonds/credits, buyer entitlement, reserve credit, and paid amounts.

### Liveness and external calls

- Pause blocks filing, acceptance, market entry, and author exits as approved, while resolve,
  crank, dismissal cleanup, buyer claim, expiry close, reserve claim, and residual reclaim remain
  live.
- Reverting, blacklisted, reentrant, false-return, and no-return token/recipient fixtures cannot
  corrupt accounting or strand unrelated finalization/locks. Credits remain retryable.
- Missing/incorrect linked library deployment, link-reference mismatch, wrong chain, duplicate
  initialization, unauthorized config, and zero recipient fail closed.
- Sequential reports and successor/cutover tests preserve all live claims and prevent replay.

### ABI, storage, size, and web behavior

- No stale `openReport`, generic report, or `FinancialReport*` selector/event/error remains in the
  compiled artifact or any client; final PaidPurchaseReport selectors/events/errors match every
  ABI consumer.
- Compact getters are measured against the removed full-struct getter; dynamic evidence cannot
  silently regrow the facade beyond budget.
- Final storage-layout snapshot matches the library call boundary; library execution mutates only
  intended facade slots and emits from the facade address.
- New purchases reject while accepted/slashing, but a previously verified buyer can still redeem
  signed raw content; non-buyers remain rejected.
- Base trust remains chain-qualified and Review-oriented; no Solana snapshot is joined to an EVM
  author.

## Files to change

- `contracts/base-poc/src/AgentVouchEvm.sol`
- `contracts/base-poc/src/libraries/AgentVouchTypes.sol`
- `contracts/base-poc/src/libraries/A1Settlement.sol` (new)
- `contracts/base-poc/foundry.toml`
- `contracts/base-poc/test/AgentVouchEvm.Slashing.t.sol` (new) and affected legacy suites
- `contracts/base-poc/script/Deploy.s.sol`
- `contracts/base-poc/ui/src/abi.ts`, `contracts/base-poc/harness/src/abi.ts`
- `web/lib/adapters/agentVouchEvmAbi.ts`, `web/lib/adapters/baseWallet.ts`,
  `web/lib/baseAuthorTrust.ts`, and affected receipt/trust tests and fixtures
- `scripts/verify-base-runtime-size.mjs` (new), `scripts/verify-chain-capability-map.mjs`, root
  `package.json`, and CI configuration
- `docs/CHAIN_CAPABILITY_MAP.md`, `docs/MAINNET_READINESS.md`, `docs/BASE_DEPLOY.md`, relevant
  Phase 9/10 plans, and `web/public/skill.md`

Do not expand `ChainAdapter`/`ChainWallet`, add dependencies, or add paid-report UI writes without
separate approval.

## Local verification

Run under the repo's Node 24 PATH and record concrete results:

```bash
forge fmt --check --root contracts/base-poc
forge test --root contracts/base-poc
forge build --root contracts/base-poc --sizes
npm run verify:base-size
npm run verify:chain-map
npm run format:check
npm run lint --workspace @agentvouch/web
npm run typecheck --workspace @agentvouch/web
npm run test --workspace @agentvouch/web
npm exec --workspace @agentvouch/web -- next build --webpack
```

Also record:

- resolved compiler/link profile and deployed-runtime budgets for both artifacts;
- `forge inspect` final storage layout and ABI/link references;
- clean-break selector/event/error parity across compiled artifact, UI, harness, web, and
  deployment checks, plus a repo-wide stale-selector absence check;
- a no-broadcast/anvil deployment rehearsal that deploys and links the library first, initializes
  roles/config in the intended order, verifies wrong-link/wrong-chain failures, and exercises a
  representative end-to-end vertical slice.

## Deployment, rollout, and rollback

### Local and Base Sepolia

`Deploy.s.sol` must hard-reject every chain except Base Sepolia (`84532`), deploy and record
`A1Settlement` before the facade, link deterministically, validate all non-placeholder A1 inputs,
and print no secrets. The app continues to point only at the facade.

The default live test is an isolated fresh-DB/fresh-listing smoke with no shared environment
cutover. Repointing shared Base Sepolia configuration or relinking existing rows requires separate
approval because rows bind `evm_contract_address` and an env-pointer reversal alone does not repair
candidate-bound listings.

After explicit approval, the smoke must prove: register → bond → vouch → paid purchase and raw
entitlement → pending report with no locks → resolver acceptance and locks → upheld resolution →
multi-call slash → final fixed liabilities/unlock → initiating-buyer claim → 30-day expiry/reserve
credit from slash excess → reserve pull → residual-vouch reclaim. Public Sepolia cannot time-warp:
prove the 30-day expiry/close path locally, and on Sepolia record the deadline plus a premature-close
revert instead of weakening the configured window. Record transaction hashes, block numbers,
library/facade addresses and bytecode hashes, explorer verification, roles/config, and USDC deltas
at explicit blocks.

Rollback before public deployment is a PR revert. After a new Sepolia candidate exists, leave the
old testnet facade untouched as historical state; there is no ABI migration or compatibility
promise. Point test clients back only after inventorying contract-bound rows and liabilities.
There is no proxy rollback.

### Base mainnet

This plan does not authorize `eip155:8453`, a mainnet deployment, real-funds movement, custody
changes, or broad enablement of money flows. Those remain blocked by the Base Mainnet Gate Table
and require explicit human approval.

## Design lock complete — 2026-07-11

No protocol-interface or economics question remains open for local implementation. Any change to
the clean-break ABI, constants, claimant cohort, slash scope, bond routing, reserve ownership,
deadline semantics, or report concurrency requires a new dated operator approval before code.

Deploy-time human values that do not block local architecture include `slashPercentage`, the
restitution-reserve recipient, final role holders, monitoring operator, and exposure limits. They
block deployment and must be recorded in `docs/BASE_DEPLOY.md` and readiness evidence.

## Historical decision ledger

| Date       | Retained outcome                                                                                                                                                                                                                                                                                                                                         | Superseded outcome                                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-06 | Base vouches are author-wide; calldata-driven permissionless crank; exact snapshot completeness; two-sided freeze; dead-position residual reclaim                                                                                                                                                                                                        | Solana listing-link machinery on Base                                                                                                                 |
| 2026-07-09 | Current branch built a monolithic WIP and proved the core slash mechanics; EIP-170 stopped implementation at 27,931 bytes                                                                                                                                                                                                                                | Treating green legacy tests as A1 completion                                                                                                          |
| 2026-07-10 | External linked `A1Settlement`, `via_ir` runs=200, no proxy, legacy read ABI preservation, pull-based liabilities, no reporter reward, initiating-buyer-only restitution                                                                                                                                                                                 | Compiler-only fix, economics cuts for size, shared first-come pool, reporter reward, generic treasury ownership                                       |
| 2026-07-11 | Clean-break Base report ABI; `PaidPurchaseReport` only; fixed 5 USDC bond; 7-day purchase-to-filing window; 7-day rejected/dismissed buyer cooldown; 3-day Pending review timeout with permissionless expiry and 30-day bond-credit claim; no pre-acceptance locks; one active buyer/listing report; 30-day funded upheld buyer claim; dedicated reserve | General/legacy report compatibility, `FinancialReport` naming, dynamic bond, indefinite filing/Pending exposure, lock on filing, direct expiry pushes |

Solana devnet remains unchanged. Any convergence of Base author-wide liability semantics back into
Solana requires a separate clean-break plan and explicit approval.
