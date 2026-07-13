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

## Implementer Review — 2026-07-11

### Blocking clarifications before contract edits

1. **Resolve the zero-slash bond contradiction.** The lifecycle says an upheld report preserves the 5 USDC bond for the buyer, while another statement says a zero-total-slash outcome creates no buyer credit. The recommended interpretation is: zero enforcement slash still creates exactly 5 USDC of buyer bond-return credit; buyer restitution and reserve excess are zero. Record this explicitly and test it before implementing accounting.

2. **Freeze a complete terminal-state ABI.** `Pending/Open/SlashingVouchers/Resolved` cannot distinguish Rejected, Expired, Dismissed, and Upheld. Reusing `Ruling` is unsafe because `Upheld` is currently the zero value and rejection/expiry are not rulings. Define a zero-safe terminal outcome field and freeze exact getter tuples, event fields/indexing, errors, selectors, and `PROTOCOL_VERSION` before synchronizing clients.

3. **Decide which purchase lanes qualify for A1.** `settleX402Purchase` records a paid `Purchase` without pulling or proving funds, and `Purchase` stores no provenance. Treating every receipt as A1-eligible elevates `SETTLEMENT_ROLE` into part of the slashing trust boundary. Obtain approval either to exclude Lane-C receipts or to record provenance and explicitly accept that authority, with underfunded/forged-settlement adversarial tests and monitoring.

4. **Decide whether acceptance locks author proceeds.** The approved freeze list does not name author-proceeds withdrawal, but the current `lockedByDispute` check in `withdrawAuthorProceeds` blocks every revision of the referenced listing. Because proceeds are no longer a penalty or reward source, do not inherit this WIP behavior accidentally; record and test the intended outcome.

### Required implementation enhancements

- Add an explicit transition-boundary table. At the Pending deadline, both acceptance and rejection must revert while permissionless expiry succeeds, preventing a resolver from routing the bond to reserve immediately before expiry. Define complementary exact comparisons for filing, cooldown release, buyer claim, and reserve conversion. Include expiry when clearing active buyer/listing slots.

- Add a function-by-function lock/pause matrix covering the referenced listing versus other listings, all three purchase lanes, create/update/remove, author-bond deposit/withdrawal, vouch/revoke, voucher-revenue claims, proceeds withdrawal, and removed-listing reports. Because `reviewPaidPurchaseReport(uint64,bool)` combines two transitions, pause must block acceptance without blocking terminal rejection; test the branch-specific behavior.

- Split historical receipt verification from current purchasability in `web/lib/basePurchaseVerification.ts`. Its shared `fetchLiveListing` currently rejects locked or removed listings for both `verifyBaseDirectPurchase` and `verifyBaseExistingPurchase`. Add the race regression: purchase succeeds, acceptance/removal occurs before DB receipt recording, historical verification and authenticated raw download still succeed, and a non-buyer remains rejected while every new purchase lane fails.

- Retire the active legacy Base report UI without adding the out-of-scope paid-report write. Remove or version-gate `OPEN_REPORT_SELECTOR` and `openBaseAuthorReport` in `web/lib/adapters/baseWallet.ts`, the Base author-page submission in `web/app/author/[pubkey]/page.tsx`, and the Base “Report Author” link in `SkillDetailClient.tsx`. Preserve the `ChainWallet` interface unless separately approved; the Base implementation should fail closed and the UI should not advertise an unavailable selector.

- Make the Base trust behavior mechanically Review-capped. `buildAgentTrustSummary` and `recommendedActionFromSignals` can currently return `allow` for a backed Base author. Add chain-aware tests across marketplace/detail/author APIs and `/api/index/trusted-authors`, retaining `avoid` for adverse evidence but preventing Base from becoming `allow`. Define whether `totalVouchesReceived` is active or lifetime—the current Base counter never decrements—before presenting it as an active trust aggregate.

- Replace Base copy that says zero-backing recovery depends on locked author proceeds. The new mechanism has no proceeds debit or backstop. Keep Solana refund-pool wording chain-qualified and state for Base that enforcement restitution can be zero when author bond and active vouch backing are zero.

- Make cranking operationally bounded, not merely calldata-driven. Add a named maximum page size, max-plus-one revert, and worst-case max-page gas assertion. Because vouches are stored in non-enumerable mappings, add a checkpointed operator tool/runbook that reconstructs candidates from deployment-block events, validates their live stake sum against the snapshot, submits restart-safe pages, and handles Base Sepolia log queries in at most 1,999-block chunks. An accepted-report age alarm, resolver recovery procedure, and named fallback operator are deployment gates because accepted reports have no timeout.

- Lock executable linked-deployment mechanics. Foundry linkage is compile-time, so specify and test either a two-stage library-deploy/prelinked-facade flow or a deterministic CREATE2 flow. Verify artifact link references, linked runtime code hashes, and that delegated events/errors remain present in the facade-facing ABI. The current non-deployer-admin path silently skips initialization; rehearsal must instead prove explicit initialization, least-privilege role handoff, and final role ownership.

- Normalize deployment defaults to the repo-approved economics while rewriting `Deploy.s.sol`: 1 USDC minimum vouch, 1 USDC free-listing author-bond floor, 0.01 USDC paid-listing floor, 60/40 split, and 5 USDC report bond. The current script carries stale 10 USDC and 1 USDC listing floors.

- Define merge/cutover ordering. Contract deployment is separately human-gated, while merging web ABI/profile changes can immediately redeploy against the current `base-v1-candidate`. Keep the web read path compatible through `PROTOCOL_VERSION` dispatch or hold production activation behind an explicit cutover gate; verify both the old configured candidate and the fresh A1 candidate before changing the shared address. Candidate-only behavior in `web/public/skill.md` must remain labeled WIP until deployment.

- Commit machine-checkable ABI, storage-layout, and link-reference snapshots. Scope stale-selector checks to active source, artifacts, clients, and operational docs: the current plan and historical Phase 9/A1 decision records intentionally retain old names and must be allowlisted rather than rewritten. Include `docs/ARCHITECTURE.md`, `contracts/base-poc/README.md`, and affected source-assertion tests in the active-surface sweep.

## Reviewer Follow-up — 2026-07-11 (plan gate)

The plan is near-ready but cannot be approved while its own "Blocking clarifications before contract edits" remain open. The design-lock claim ("no protocol-interface or economics question remains open") is contradicted by Implementer Review items 1–4. Convert each into a dated DECISION entry in this file before implementation begins:

1. **Zero-slash upheld outcome (item 1).** Adopt the recommended interpretation as the locked rule: an upheld report with zero total slash still creates exactly the 5 USDC bond-return buyer credit with the standard 30-day claim; buyer restitution and reserve excess are zero. Amend the lifecycle sentence "A zero-total-slash outcome creates no buyer or reserve credit" to say "no restitution or reserve credit" so the table and ledger sections agree.

2. **Terminal-outcome ABI (item 2).** Lock a zero-safe outcome field now, e.g. `PaidPurchaseReportOutcome { None, Rejected, Expired, Dismissed, Upheld }` stored separately from status, and freeze the exact getter tuples, event fields/indexing, errors, selectors, and `PROTOCOL_VERSION` bump as a dated addendum before any client sync work.

3. **A1-eligible purchase lanes (item 3) — operator decision required.** This changes the slashing trust boundary and cannot be defaulted by the implementer. Recommended MVP arm, consistent with the ship-minimal bias: exclude `settleX402Purchase` (Lane-C / `SETTLEMENT_ROLE`-recorded) receipts from `openPaidPurchaseReport` eligibility for this deployment, with a revert test, and defer provenance-recorded Lane-C eligibility to a future dated approval. Record whichever arm is chosen with a date.

4. **Author-proceeds lock on acceptance (item 4).** Record the intended freeze-list answer explicitly. Recommended: acceptance does **not** block `withdrawAuthorProceeds` (proceeds are no longer a penalty or restitution source under the locked ledgers); do not inherit the WIP `lockedByDispute` behavior. Add the corresponding lock/pause-matrix row and test either way.

No other changes requested. The remaining Implementer Review enhancements (transition-boundary table, lock/pause matrix, page-size bound, linked-deploy mechanics, cutover ordering, snapshot checks) are executable as written and do not block approval once items 1–4 carry dated decisions.

## Implementation Enhancements — 2026-07-11 (second implementer pass)

### Readiness verdict

Do not begin contract edits. The prior four design decisions remain unresolved, and this pass found four additional blockers.

### Additional blockers

1. **Re-establish the implementation base.** The plan records `HEAD=588fc96e`, but the checkout is at `2b908eb9`. Local `main` is `dfe858ff`, while `origin/main` is `0cdc9dff`; that newer commit changes `web/lib/baseAuthorTrust.ts`, which this plan also changes. Before editing, integrate current `origin/main` without rewriting shared history, preserve the `492f7a06` WIP lineage explicitly, record the new HEAD and merge-base, and rerun the contract/size baseline.

2. **Widen protocol-version database columns through an approved migration.** `skills.on_chain_protocol_version`, `usdc_purchase_receipts.protocol_version`, and `usdc_purchase_entitlements.protocol_version` are `VARCHAR(16)`. The deployed `base-v1-candidate` is 17 characters and the WIP `base-v1-a1-candidate` is 20, so listing linkage or receipt recording can fail after a successful on-chain transaction. Add an `EXPECTED_DATABASE_HOST`-guarded one-shot migration with read-only preflight, disposable production-derived Neon rehearsal, `VARCHAR(64)` or `TEXT` widening, post-migration verification, and matching fresh-schema definitions. Do not place `ALTER COLUMN TYPE` in request-time initializers. Because this is non-additive schema work, obtain the approval required by `AGENTS.md` before running it.

3. **Record the Pending collateral-escape decision.** The approved no-lock Pending state leaves `withdrawAuthorBond` and `revokeVouch` available for up to three days after a public filing. An author and its vouchers can therefore exit before resolver acceptance, leaving an upheld report with no enforcement assets. Either reopen the lock/unbonding design or append a dated decision explicitly accepting best-effort exposure, qualify the “enforceable downside” claim, define resolver monitoring/SLA, and add the adversarial sequence `file → withdraw/revoke all → accept → uphold → zero enforcement`.

4. **Resolve cross-listing reward behavior during paged slashing.** The plan blocks purchases only on the referenced listing, while Base rewards and backing are author-wide. Each crank page removes processed stake from the reward denominator, so a purchase on another author listing between pages makes reward allocation depend on cranker ordering. Decide whether to freeze every purchase lane for the author until finalization or explicitly accept this ordering. If retained, test two vouchers and two listings with an inter-page purchase, opposite crank orders, reward claims, and full liability conservation.

### Required implementation additions

- Enforce locked economics inside initialization, not only in `Deploy.s.sol`: exact 60/40/0 split, approved floors, exact Base Sepolia chain context, matching USDC, and `1 <= slashPercentage <= 100`. Hardcode fixed values and leave only explicitly approved deploy-time choices configurable. Add misconfiguration rejection tests.

- Define a concrete single-source reward-accrual extraction. The linked library cannot call the facade’s internal `_accrueAuthorRewards`, and external self-calls are forbidden. Use one shared internal helper from facade claim/revoke paths and the linked-library crank, then prove identical pre-slash accrual and pending-reward preservation.

- Treat `PROTOCOL_VERSION()` as live contract attestation during listing linkage/update and new receipt verification. Compare it with stored metadata and fail closed on mismatch or unsupported versions; stored values must not bypass the read. Already-recorded entitlement redemption must remain network-independent.

- Make reads deployment-bound, not global-address-bound. Use a supported-deployment registry keyed by `(chain_context, lowercase contract, exact protocol version)`, keep writes pinned to the active candidate, and hydrate historical rows from their recorded contract. Add a two-contract regression with identical author/listing IDs and prove old entitlement redemption after an environment cutover. If this requires expanding `ChainAdapter`, stop for the approval required by `AGENTS.md`; otherwise use a dedicated Base row reader.

- Carry deployment identity through trust resolution and recommendation logic. Unsupported or unreadable A1 data must be `unavailable`, not a genuine zero or a Solana fallback. Freeze A1 stats that distinguish upheld paid-report count, cumulative author-bond slash, and cumulative voucher slash; test bond-only, voucher, and zero-slash outcomes plus old-candidate getter absence. Update public schemas and discovery versioning if the response shape changes.

- Make build identity and CI reproducible:

  - Pin Forge 1.7.1, solc 0.8.28, `via_ir`, optimizer runs, metadata settings, and an explicit Base-supported EVM target; the current unpinned toolchain resolves `prague`.
  - Align `contracts/base-poc/setup.sh` dependency tags with CI.
  - Add CI gates for `forge fmt --check`, Forge tests, hard/soft linked-artifact sizes, `verify:chain-map`, and pinned fuzz/invariant runs and depth.
  - Compile the isolated consumers with `npm run build --prefix contracts/base-poc/ui` and `npm run typecheck --prefix contracts/base-poc/harness`; root workspace gates do not cover them.
  - Make the rehearsal executable with Anvil chain ID `84532` plus `MockUSDC`, or a Base Sepolia fork. Separately prove the wrong-chain rejection and validate deployed USDC code and six decimals.

- Add `MAX_REPORT_EVIDENCE_URI_BYTES` with exact-boundary tests before any token pull or state write.

- Remove the unused `TREASURY_ROLE` and stale treasury terminology unless a concrete authority is approved. Add `contracts/base-poc/setup.sh` and `docs/PRODUCTION_RUNBOOK.md` to the file sweep; the runbook still names `base-v1-candidate`, `openReport`, `resolveReport`, and `TREASURY_ROLE`.

- Treat the active contract address, deploy block, event-scan setting, protocol version, and reserve/role ownership as one cutover/rollback tuple. Before completing the web todo, run the required human Base passkey regression against the still-configured candidate; after any approved deployment, repeat it against the A1 candidate and run the shared Solana trust/purchase regression.

### Review evidence

Read-only checks passed for the current Forge suite, `npm run verify:chain-map`, both isolated TypeScript typechecks, and `git diff --check`. `forge build --sizes` reproduced the expected 27,931-byte facade and EIP-170 failure; this is baseline evidence, not implementation completion.

## Reviewer Follow-up — 2026-07-11 (plan gate, second pass)

Verified independently: the `VARCHAR(16)` protocol-version columns (`web/lib/db.ts:655`, `web/lib/db.ts:781`) versus the 17-char `base-v1-candidate` string, and the stale-baseline claim (checkout HEAD is `2b908eb9`, not the recorded `588fc96e`). The second implementer pass's blockers are factually grounded, and its verdict — do not begin contract edits — stands.

Approval is blocked on one thing: the "Design lock complete — 2026-07-11" claim is contradicted by eight open items. Append **one dated decision addendum** resolving all of them; no other work is required to pass this gate.

**Operator decisions (cannot be defaulted by the implementer):**

1. **A1-eligible purchase lanes** (first review, item 3). Recommended arm unchanged: exclude `settleX402Purchase`/Lane-C receipts for this deployment, revert test included, provenance-based eligibility deferred to a future dated approval.
2. **Pending collateral-escape** (second pass, blocker 3). The no-lock Pending window lets `withdrawAuthorBond`/`revokeVouch` drain all enforcement assets before acceptance, hollowing the core safety claim. Either (a) accept best-effort exposure explicitly — qualify the "enforceable downside" wording, set a resolver acceptance SLA, and add the `file → exit-all → accept → uphold → zero enforcement` adversarial test, or (b) reopen the lock/unbonding design (which reopens the design lock more broadly). Recommended for MVP: arm (a), consistent with the ship-minimal bias.
3. **Cross-listing reward ordering during paged slashing** (second pass, blocker 4). Either freeze all author purchase lanes until finalization or accept cranker-order-dependent reward allocation with the specified two-voucher/two-listing/inter-page-purchase conservation test. Recommended: freeze all lanes — it is the smaller correctness surface and settlement windows are short.
4. **Protocol-version column widening** (second pass, blocker 2). Non-additive DDL requiring the AGENTS.md-mandated approval and guarded-migration procedure. Approve the migration (or an alternative such as shortening the new version string to ≤16 chars, e.g. `base-v2-a1-cand`, which would avoid the migration entirely — pick one arm and date it).

**Implementer-resolvable, but must be recorded as dated decisions in the same addendum:**

5. **Zero-slash upheld outcome** (first review, item 1) — adopt the already-recommended rule: bond-return credit only, no restitution or reserve credit; fix the contradictory lifecycle sentence via addendum, not rewrite.
6. **Terminal-outcome ABI** (first review, item 2) — lock the zero-safe `PaidPurchaseReportOutcome { None, Rejected, Expired, Dismissed, Upheld }` field plus frozen getters/events/errors/selectors/`PROTOCOL_VERSION`.
7. **Author-proceeds lock on acceptance** (first review, item 4) — record the recommended answer (acceptance does not block `withdrawAuthorProceeds`) and add the lock/pause-matrix row.
8. **Baseline re-establishment** (second pass, blocker 1) — integrate current `origin/main` (which touches `web/lib/baseAuthorTrust.ts`, also in this plan's file list), record new HEAD/merge-base, rerun the 27,931-byte size baseline, and update the "Current branch baseline" facts via addendum.

Everything else in both implementer passes (transition-boundary table, lock/pause matrix, page-size bound, reward-accrual extraction, deployment-registry reads, CI pinning, evidence-URI cap, runbook sweep) is executable as written and does not block the gate. Once the dated addendum covering items 1–8 is appended, this plan is approvable without a further design pass.

## Implementer Review — 2026-07-11 (third pass)

### Additional plan gates

Do not begin contract edits until these two semantics receive dated decisions:

1. **Free-listing collateral after author-bond first loss.** A paid A1 ruling can slash the same author bond that enforces the free-listing floor, leaving an active free listing with no self-stake. Choose: reserve the floor from A1 slashing, suspend/remove affected free listings, or define the floor as creation-time-only and correct trust/copy. Test an author at the floor with one free and one paid listing through an upheld paid report.

2. **Define “metadata-only” while accepted.** The current implementation treats URI and price changes as revision changes; the plan leaves the allowed metadata set ambiguous. Recommended lock: allow name/description-only changes, while URI, price, and free/paid transitions revert without changing revision or settlement state. Record and test that boundary.

### Required implementation enhancements

- Replace the fixed solvency scenario with a stateful `StdInvariant` handler across multiple reports, vouchers, claims, pauses, pending expiry, dismissal, partial cranks, and residual reclaim. Assert the contract balance covers author bonds, active/residual stake, proceeds, voucher revenue, pending bonds, buyer credits, and reserve credits; all credits must be single-spend.

- Lock stale crank-page behavior. Historical `Vouched` logs include revoked/re-vouched candidates, while the WIP reverts an entire page for non-active entries. Specify skip versus revert semantics (recommended: skip stale/non-active candidates, reject a wrong vouchee) and test mixed active/stale/duplicate pages without overcounting or premature finalization.

- Extend the size/link gate beyond EIP-170 runtime. Validate post-link facade and library runtime sizes, plus actual creation input—including constructor arguments—against EIP-3860’s 49,152-byte initcode cap. Current Forge output is 27,931-byte runtime and 28,866-byte initcode for the unsplit facade. Normalize Solidity’s deployed-library self-address patch before code-hash comparison. Test that a raw mutating `CALL` to the library reverts, the facade `DELEGATECALL` path succeeds, and no unprivileged facade route reaches settlement logic; do not add a redundant custom library-call guard.

- Treat `verify:chain-map` as a name-map only. Add compiled-ABI parity snapshots for signatures/selectors, events, errors, compact getters, client fragments, link references, and active stale-selector absence. Update the blocked-source table atomically, but do not use a green 26-row map as clean-break ABI proof.

- Complete the existing deployment-bound read requirement with `(chain_context, lowercase facade, author)` keys through trust caches, marketplace/hydration maps, detail reads, and public feeds. Add a chain-scoped optional Base-A1 aggregate object for author-bond slash, voucher slash, and upheld-report counts; old/unsupported candidates must be `unavailable`, never zero or Solana-derived. Test two contracts with the same author/listing IDs for cache and trust isolation.

- Preserve the stated historical-receipt guarantee without relying on `MAX_REVISION_SCAN = 20`. Add an exact purchase-ID or transaction-proof path, or explicitly limit the guarantee to already-recorded entitlements. Test a revision-1 purchase after more than 20 revisions, then removal/acceptance, ensuring verification and signed raw access still work.

- Add an executable A1 smoke driver: local Anvil on 84532 with `MockUSDC` and time-warp, plus a human-gated Sepolia mode that emits machine-readable transaction, block, role, code-hash, and explicit-block balance evidence. Retire obsolete `openReport` smoke instructions. Include `contracts/base-poc/ui/src/config.ts`, `ui/.env.example`, and harness examples in the sweep: they currently target the old POC and a 1-USDC floor. Keep A1 testing isolated-preview-only until explicit cutover approval; retain CDP paymaster allowlist checks and keep Base mainnet readiness pending after any Sepolia smoke.

## Reviewer Follow-up — 2026-07-11 (plan gate, third pass)

Verified independently: the third pass's two new gates are factually grounded. The free-listing bond floor is enforced only in `withdrawAuthorBond` and listing create/update (`contracts/base-poc/src/AgentVouchEvm.sol:289`, `:391`, `:434`); an A1 author-bond slash bypasses those checks and can leave active free listings below `minAuthorBondForFreeListingUsdcMicros`. Listing updates treat URI/price as revision-changing (`AgentVouchEvm.sol:460-461`), so the plan's "metadata-only updates may remain allowed" is genuinely undefined.

The blocking condition is unchanged from the second-pass gate and remains unmet: **no dated decision addendum has been appended.** The eight items enumerated in "Reviewer Follow-up — 2026-07-11 (plan gate, second pass)" are all still open, and the "Design lock complete — 2026-07-11" claim remains contradicted. The third pass adds two items to the same addendum, making ten total:

9. **Free-listing collateral after author-bond first loss** (third pass, gate 1) — operator decision. Recommended MVP arm, consistent with the Pending collateral-escape arm (a) and ship-minimal bias: define the floor as a withdrawal/creation gate only — an A1 slash may push the bond below it, the floor continues to block further withdrawals and new free listings, and trust surfaces/copy state that free-listing self-stake is best-effort after enforcement. Add the specified test (author at floor, one free + one paid listing, upheld paid report). The suspend/remove-listings arm is a larger correctness surface; reserving the floor from slashing weakens the penalty. Record whichever arm is chosen with a date.

10. **Metadata-only boundary while accepted** (third pass, gate 2) — implementer-resolvable; adopt the pass's recommended lock (name/description-only changes allowed; URI, price, and free/paid transitions revert without changing revision or settlement state) and record it dated, with the boundary test.

Nothing else blocks. All third-pass "Required implementation enhancements" (stateful invariant handler, stale-page skip semantics, EIP-3860 initcode gate, ABI parity snapshots, deployment-bound reads, revision-scan-independent receipt proof, executable smoke driver) are executable as written and join the existing non-blocking work. Once one dated addendum covering items 1–10 is appended, this plan passes the gate without a further design pass.

## Implementer Review — 2026-07-11 (fourth pass)

### Additional plan gates

The existing ten-item dated-decision addendum remains required. Add these two economic decisions as well; do not infer them from the WIP.

1. **Make Base Sepolia an on-chain invariant.** `block.chainid` appears only in `Deploy.s.sol`; the facade itself accepts arbitrary constructor USDC and config `chainContext`, so a direct deployment bypasses the script guard. Add a facade-level `84532` guard, canonical chain-context validation, and production-script pinning to Circle Base Sepolia USDC. Test direct wrong-chain deployment/initialization failure, while using an explicit `84532` Anvil fixture for local `MockUSDC` tests.

2. **Define the author-bond first-loss cap and snapshot point.** The enforcement formula references undefined `snapshottedReportBond`; the WIP silently caps author slashing at `config.disputeBondUsdcMicros`. Lock whether the cap is 5 USDC, purchase price, full author bond, or another value, and whether author-bond balance is read at acceptance or uphold. Test 4/5/above-5-USDC bonds plus a post-acceptance deposit, with exact buyer and reserve credits.

3. **Assign reward-index rounding dust.** `_recordPurchase` books the full voucher pool, while per-vouch accrual floors independently. With three 1-USDC vouches and a 1-USDC purchase, 400,000 micros are booked but only 399,999 are claimable, leaving one permanently unclaimable micro after all vouchers claim/revoke. Choose and document its owner/accounting treatment; add a claimability/conservation test so `unclaimedVoucherRevenue` cannot become a stranded liability.

### Read-only evidence

`forge test --root contracts/base-poc` passed 85 legacy tests; `forge build --sizes` reproduced the 27,931-byte EIP-170 failure; `npm run verify:chain-map` passed (26 mapped rows).

## Reviewer Follow-up — 2026-07-12 (plan gate, fourth pass)

Verified independently against the branch source: (1) `block.chainid` is checked only in `Deploy.s.sol:32-33`, so the facade has no on-chain chain guard; (2) `_slashAuthorBond` (`AgentVouchEvm.sol:857-861`) caps first loss at `config.disputeBondUsdcMicros` while the plan's ledger references an undefined `snapshottedReportBond`; (3) `_recordPurchase` books the full `voucherPool` as unclaimed revenue while index-delta and per-vouch accrual both floor, so booked liability can permanently exceed claimable. All three fourth-pass gates are factually grounded.

The blocking condition is unchanged from the second- and third-pass gates: **the single dated decision addendum has still not been appended**, and the "Design lock complete — 2026-07-11" claim remains contradicted. The fourth pass extends the addendum from ten items to thirteen:

11. **Facade-level Base Sepolia invariant** (fourth pass, gate 1) — implementer-resolvable; adopt as written: constructor/init guard requiring `block.chainid == 84532` and canonical chain-context, production-script pinning to Circle Base Sepolia USDC, direct wrong-chain deployment/initialization failure tests, and an explicit-`84532` Anvil fixture for local `MockUSDC` tests. Record it dated.

12. **Author-bond first-loss cap and snapshot point** (fourth pass, gate 2) — operator/economics decision; cannot be defaulted by the implementer. Recommended arm: cap the author-bond first loss at the fixed 5 USDC report bond (this is the apparent intent of the ledger's `min(authorBond, snapshottedReportBond)` and matches WIP behavior when the dispute bond is 5 USDC), with the author-bond balance read at uphold — safe because acceptance already freezes author-bond withdrawal. Rename `snapshottedReportBond` in the ledger to the chosen constant. Add the specified 4/5/above-5-USDC and post-acceptance-deposit tests with exact buyer and reserve credits. Record whichever value/read-point is chosen with a date.

13. **Reward-index rounding dust** (fourth pass, gate 3) — implementer-resolvable; record one dated rule. Recommended arm: at purchase time, book only the distributable amount (`indexDelta * activeVouchStake / REWARD_INDEX_SCALE`) into `unclaimedVoucherRevenueUsdcMicros` and assign the remainder to author share, so booked liability always equals the sum of claimable accruals. Add the three-1-USDC-voucher/1-USDC-purchase conservation test proving `unclaimedVoucherRevenue` reaches exactly zero after all claims/revokes.

Nothing else blocks. Once one dated addendum covering items 1–13 is appended, this plan passes the gate without a further design pass.

## Decision Addendum — 2026-07-12 (items 1–13, operator-acked)

Resolves every open item from the 2026-07-11 plan-review rounds. Operator-level items (3, 4, 6,
7, 12) are decided here under the founder's standing in-session delegation; items 4, 7, and 12
diverge from a prior directive or the loop's recommended arm and are flagged as such in the
handoff summary for explicit veto. Facts cited below were re-verified against the checkout on
2026-07-12.

1. **Zero-slash upheld outcome — DECIDED (as recommended).** An upheld report with zero total
   slash still creates exactly the report-bond-return buyer credit (config `disputeBondUsdcMicros`,
   5 USDC on Sepolia) with the standard claim window; restitution and reserve credits are zero.
   Amend the contradictory lifecycle sentence to "no restitution or reserve credit." Test both
   ledger lines.
2. **Terminal-outcome ABI — DECIDED (as recommended).** Add zero-safe
   `PaidPurchaseReportOutcome { None, Rejected, Expired, Dismissed, Upheld }` stored separately
   from status. Freeze getter tuples, event fields/indexing, errors, selectors, and the
   `PROTOCOL_VERSION` bump in one dated addendum before any client sync. (`Ruling` reuse rejected:
   `Upheld` as the zero value is a footgun.)
3. **A1-eligible purchase lanes — DECIDED (operator): exclude Lane-C.** `settleX402Purchase`
   receipts are NOT eligible for `openPaidPurchaseReport` in this deployment, with a revert test.
   Rationale: Lane-C records a paid purchase on `SETTLEMENT_ROLE`'s attestation without proving
   funds (documented since `docs/BASE_POC_INTERIM.md`); admitting it would let a compromised or
   sloppy settlement key mint refund-eligible purchases and pull slashed voucher funds — quietly
   promoting that key into the slashing trust boundary. Direct `purchaseSkill` and Lane-B
   `purchaseWithAuthorization` (both ECDSA-verified fund movement) qualify. Provenance-recorded
   Lane-C eligibility is deferred to a future dated approval.
4. **Author-proceeds lock on acceptance — DECIDED (operator): acceptance does NOT freeze
   `withdrawAuthorProceeds`.** This deliberately supersedes the 2026-07-09 pre-loop directive
   ("add a lockedByDispute check to withdrawAuthorProceeds"), whose rationale died with the
   Scope Amendment: B1 removed the reporter reward (the only proceeds-funded outflow) and buyer
   restitution is funded from the slash bucket, so proceeds are no longer a funding source; item
   8's author-wide purchase freeze means no new proceeds accrue during a report anyway. Remove
   the WIP check deliberately, add the lock/pause-matrix row, and test that withdrawal of
   pre-report proceeds succeeds during an accepted report.
5. **Zero-slash lifecycle wording** — folded into item 1 (single dated amendment, not a rewrite).
6. **Protocol-version column widening — DECIDED (operator): both arms, decoupled.**
   (a) The `VARCHAR(16)` columns are a live latent bug on `main` TODAY, independent of A1:
   PR #90 stamps the live-read `base-v1-candidate` (17 chars) into six 16-char columns
   (`web/lib/db.ts:655,781`; `web/lib/usdcPurchases.ts:73,132,259,320`; verified 2026-07-12), so
   fresh Base listing links/receipts against the v1 candidate fail their insert. Approve the
   guarded one-shot widening to `VARCHAR(64)` on `main` per the guarded-db-migration pattern
   (read-only preflight, `EXPECTED_DATABASE_HOST` gate, disposable Neon rehearsal on
   `agentvouch-postgres`, post-run catalog check + API smoke) as a separate hotfix PR — not part
   of this plan's diff. (b) Independently, A1's version string is `base-v1-a1` (10 chars) so the
   A1 deploy never depends on migration timing. Never put `ALTER COLUMN TYPE` in request-time
   initializers.
7. **Pending collateral escape — DECIDED (operator): REJECT the no-lock Pending window; locks
   engage at filing.** This overrides the loop's recommended arm (a). The shipped contract
   already locks at open — `openDisputes > 0` gates `withdrawAuthorBond`, `vouch`, `revokeVouch`,
   and revision bumps (verified 2026-07-12: AgentVouchEvm.sol:287,309,350,444) — and the
   PR #78 `forfeitReporterBond` dismissal lever exists precisely to make lock-griefing costly
   (dismissed griefers forfeit the 5 USDC bond to the author). A public no-lock window makes the
   filing a fire alarm: `file → withdraw/revoke all → accept → uphold → zero enforcement` defeats
   A1's entire purpose. Keep lock-at-file; keep the forfeit lever as the griefing counterweight;
   add the adversarial exit-attempt test proving the escape reverts. If a Pending/acceptance
   state survives for resolver-workflow reasons, it carries the same locks as Open.
8. **Cross-listing reward ordering — DECIDED (as recommended): freeze all of the author's
   purchase lanes** from financial-report acceptance until finalization, so paged slashing can
   never race a purchase into a moving reward denominator. Smaller correctness surface; windows
   are short; alpha caps bound the UX cost. Two-voucher/two-listing/inter-page-purchase
   conservation test required.
9. **Free-listing floor after slash — DECIDED (as recommended).** The floor is a
   withdrawal/creation gate only: an A1 slash may push the bond below it; the floor keeps
   blocking further withdrawals and new free listings; trust surfaces say free-listing self-stake
   is best-effort after enforcement. Test: author at floor, one free + one paid listing, upheld
   paid report.
10. **Metadata-only boundary while accepted — DECIDED (as recommended).** Name/description-only
    edits allowed; URI, price, and free/paid transitions revert without touching revision or
    settlement state. Matches the #86 parity choice. Boundary test required.
11. **Facade-level Base Sepolia invariant — DECIDED (as recommended).** Constructor/init guard on
    `block.chainid == 84532` + canonical chain-context validation + production-script pinning to
    Circle Base Sepolia USDC; wrong-chain deploy/init failure tests; explicit-84532 Anvil fixture
    for MockUSDC tests. Note for Phase 10: this constant is part of the parameterization sweep —
    the mainnet v1 deploy replaces it deliberately, never by ad-hoc edit.
12. **Author-bond first-loss cap and snapshot — DECIDED (operator): snapshotted `slashPercentage`
    of the author bond, NOT min(bond, report bond).** This overrides the loop's recommended arm.
    Solana A1 parity slashes the bond at `slash_percentage` (the 2026-06-11 devnet smoke:
    500_000-micro bond slash alongside the 500_000-micro voucher slash); capping the author's
    first loss at a fixed 5 USDC while vouchers bleed percentage-of-stake would make the author
    the least-exposed party on their own listing — inverted incentives. Author bond slashes
    first at the snapshotted percentage, then vouchers at the same percentage; buyer restitution
    capped at purchase price; excess to the A4-earmarked reserve. Balance read at uphold (safe:
    withdrawals frozen from filing per item 7). Rename `snapshottedReportBond` accordingly. Tests:
    bond below/at/above the slash amount plus a post-filing deposit attempt, with exact buyer and
    reserve credits.
13. **Reward-index rounding dust — DECIDED (as recommended).** Book only the distributable amount
    into `unclaimedVoucherRevenueUsdcMicros`; the remainder joins the author share (consistent
    with the documented Base dust-to-author divergence in `docs/BASE_POC_INTERIM.md`).
    Three-voucher conservation test proving unclaimed revenue reaches exactly zero.

With this addendum the plan-review gate's stated condition ("one dated addendum covering items
1–13") is satisfied. Implementation order reminder: first act is still the Scope Amendment
section-A library-extraction spike (measure ≤ 23.5 KB), plus the item-6 baseline steps
(integrate `origin/main`, record new HEAD/merge-base, rerun the size baseline).

## Reconciliation Addendum — 2026-07-12 (operator-approved)

This section supersedes only the conflicting portions of the lifecycle text and Decision Addendum
items 7, 8, and 13. It resolves the valid fifth- and sixth-pass findings recovered from run
`20260711-213201-708011`; the generated reviewer transcripts are intentionally not copied into this
canonical plan. No contract edits may begin until the branch has integrated current `origin/main`
and the production-profile runtime baseline has been re-recorded.

The previously operator-approved buyer claim window is seven days, not thirty. Every earlier
reference in this plan to a 30-day buyer bond/credit claim window or deadline is superseded by a
seven-day window measured from expiry or finalization, as applicable. Closing an unclaimed credit
after that deadline still converts it to restitution-reserve credit exactly once.

### Filing, acceptance, terminal transitions, and anti-grief bound

- There is at most one nonterminal `PaidPurchaseReport` per author, not merely one accepted report.
  Filing atomically occupies the buyer, listing, purchase, and author slots. Multiple Pending
  reports for one author are not allowed.
- Filing starts the author collateral-membership lock. Until that report terminates,
  `withdrawAuthorBond`, `vouch`, `revokeVouch`, listing removal, URI/price changes, free/paid
  transitions, and revision changes revert. Name/description-only edits, author-proceeds
  withdrawal, voucher-revenue claims, and historical-receipt verification remain available.
- `depositAuthorBond` remains available while a report is Pending or accepted. Deposits are
  voluntary additions to the author-bond balance and enter the uphold-time slash base. The author
  bond is read at upheld resolution and slashed by the snapshotted `slashPercentage`.
- New purchases remain available while Pending. Acceptance atomically freezes all three purchase
  lanes across every listing by that author; this author-wide purchase freeze remains through
  voucher settlement and finalization. Acceptance does not create a second lock count.
- Rejection, permissionless Pending expiry, dismissal, and finalization each clear the four filing
  slots and collateral lock exactly once. With one author slot, one terminal report cannot unlock
  another live report.
- Pending review still expires exactly three days after filing. Expiry returns the five-USDC bond
  through the normal pull-credit path and permanently consumes the initiating receipt, but now
  sets an author-level report cooldown through `expiredAt + 7 days`. No buyer can file another
  report against that author during this interval. This bounds resolver-inactivity grief to three
  locked days followed by seven guaranteed unlocked days; it deliberately trades seven days of
  report availability after an operational miss for bounded author liveness.
- Rejected and dismissed report bonds route deterministically to the restitution reserve. Remove
  `forfeitReporterBond` and every resolver-selected payout destination from the clean-break ABI.
  Existing rejected/dismissed buyer cooldown rules remain. Expiry is the only non-upheld terminal
  path that returns the bond.

Required transition tests cover filing at every cooldown boundary, a second buyer and revision,
resolver inactivity, acceptance at `deadline - 1` and rejection at/after `deadline`, expiry exactly
at the deadline, duplicate terminal calls, all lock-counter decrements, purchase availability while
Pending, author-wide purchase rejection after acceptance, voluntary post-filing bond deposits, and
proof that fully refundable reports cannot keep an author continuously locked.

### Purchase-lane provenance

Add a permanent zero-safe purchase provenance field written atomically by every purchase path:
`PurchaseLane { None, Direct, Authorization, Settlement }`. Direct `purchaseSkill` and
`purchaseWithAuthorization` receipts are A1-eligible. `settleX402Purchase` receipts are not.
Eligibility is derived only from stored provenance; callers cannot supply or override the lane.
Test all three lanes plus nonexistent/default provenance and every alternate receipt-construction
path.

### Exact voucher-revenue rounding ownership

Decision Addendum item 13's single aggregate is insufficient for unequal stakes. Replace it with
two conserved ledgers:

- `voucherRevenuePendingDistributionUsdcMicros`: whole micros funded for the reward index but not
  yet materialized into per-voucher accruals;
- `voucherRevenueClaimableUsdcMicros`: the exact sum of whole micros already materialized into
  voucher accrual balances and not yet paid.

At purchase, compute the index-level distributable amount; credit the index-division remainder to
author proceeds and book only the distributable amount as pending distribution. Whenever a
position accrues, move exactly its newly floored whole-micro accrual from pending distribution to
claimable. Claims decrement claimable by the exact transfer. Before a position leaves Active—by
revoke or slash—it must accrue once. When the last active position has accrued and active stake
becomes zero, atomically credit the remaining pending-distribution residue to author proceeds and
zero it; already-materialized voucher claims remain claimable and cannot be swept. Fuzz unequal
stakes, repeated purchases, arbitrary claim/revoke/slash orders, and final-position exit. Assert
that both aggregates plus author proceeds and paid voucher claims conserve every purchase micro.

### Frozen clean-break A1 ABI

The exact protocol version for this deployment is `base-v1-a1`. Solidity enum parameters use their
canonical ABI integer type (`uint8`). The final A1 source surface is:

| Purpose           | Exact Solidity signature                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| File              | `openPaidPurchaseReport(address,bytes32,bytes32,string) returns (uint64)`                                             |
| Accept/reject     | `reviewPaidPurchaseReport(uint64,bool)`                                                                               |
| Uphold/dismiss    | `resolvePaidPurchaseReport(uint64,uint8)`                                                                             |
| Voucher page      | `slashPaidPurchaseReportVouches(uint64,address[])`                                                                    |
| Buyer pull        | `claimPaidPurchaseReportCredit(uint64)`                                                                               |
| Expire buyer pull | `closePaidPurchaseReportCredit(uint64)`                                                                               |
| Reserve pull      | `claimRestitutionReserve()`                                                                                           |
| Core read         | `getPaidPurchaseReportCore(uint64) returns (address,address,bytes32,bytes32,uint64,uint64,uint64,uint64,uint8,uint8)` |
| Settlement read   | `getPaidPurchaseReportSettlement(uint64) returns (uint8,uint256,uint256,uint256,uint256,uint256,uint256,uint64,bool)` |
| Evidence read     | `getPaidPurchaseReportEvidence(uint64) returns (string)`                                                              |

Core-read order is buyer, author, listing ID, purchase ID, filed timestamp, review deadline,
accepted timestamp, terminal timestamp, status, outcome. Status is
`PaidPurchaseReportStatus { None, Pending, Accepted, SlashingVouchers, Terminal }`; outcome is
`PaidPurchaseReportOutcome { None, Rejected, Expired, Dismissed, Upheld }`. Settlement-read order
is snapshotted slash percentage, snapshotted active-vouch stake, processed pre-slash stake,
author-bond slash, voucher slash, buyer entitlement, funded buyer credit, claim deadline, and
claimed-or-expired flag. Missing IDs revert rather than returning an all-zero tuple.

Freeze these A1 events and indexed fields before client generation:

- `PaidPurchaseReportOpened(uint64 indexed reportId,address indexed buyer,address indexed author,bytes32 listingId,bytes32 purchaseId,uint256 bond,uint64 reviewDeadline,string evidenceUri)`
- `PaidPurchaseReportAccepted(uint64 indexed reportId,address indexed resolver,address indexed author,uint64 acceptedAt)`
- `PaidPurchaseReportRejected(uint64 indexed reportId,address indexed resolver,address indexed buyer,uint256 reserveCredit,uint64 buyerCooldownUntil)`
- `PaidPurchaseReportExpired(uint64 indexed reportId,address indexed buyer,address indexed author,uint256 buyerCredit,uint64 claimDeadline,uint64 authorCooldownUntil)`
- `PaidPurchaseReportParked(uint64 indexed reportId,address indexed resolver,address indexed author,uint8 slashPercentage,uint256 activeVouchStake,uint256 authorBondSlash)`
- `PaidPurchaseReportVouchSlashed(uint64 indexed reportId,address indexed voucher,uint256 preSlashStake,uint256 slashAmount,uint256 processedPreSlashStake)`
- `PaidPurchaseReportDismissed(uint64 indexed reportId,address indexed resolver,address indexed author,uint256 reserveCredit,uint64 buyerCooldownUntil)`
- `PaidPurchaseReportFinalized(uint64 indexed reportId,address indexed author,address indexed buyer,uint256 buyerEntitlement,uint256 buyerCredit,uint256 reserveCredit,uint64 claimDeadline)`
- `PaidPurchaseReportCreditClaimed(uint64 indexed reportId,address indexed buyer,uint256 amount)`
- `PaidPurchaseReportCreditExpired(uint64 indexed reportId,uint256 reserveCredit)`
- `RestitutionReserveClaimed(address indexed recipient,uint256 amount)`

The A1-specific custom-error set is frozen as `PaidPurchaseReportNotFound`,
`PaidPurchaseReportInvalidState`, `PaidPurchaseReceiptIneligible`, `PaidPurchaseReceiptConsumed`,
`PaidPurchaseBuyerBusy`, `PaidPurchaseListingBusy`, `PaidPurchaseAuthorBusy`,
`PaidPurchaseBuyerCooldown`, `PaidPurchaseAuthorCooldown`, `PaidPurchaseReviewExpired`,
`PaidPurchaseReviewOpen`, `PaidPurchaseEvidenceTooLong`, `PaidPurchaseSlashPageTooLarge`,
`PaidPurchaseSlashSnapshotIncomplete`, `PaidPurchaseCreditNotFunded`,
`PaidPurchaseCreditExpired`, `PaidPurchaseCreditOpen`, `PaidPurchaseCreditAlreadyHandled`, and
`PurchaseLaneIneligible`. Existing general errors may remain where their meaning is unchanged;
removed legacy/FinancialReport errors and selectors must be absent from compiled ABI parity checks.

### Re-established execution gate

The canonical plan now contains both the operator-acked items 1–13 and this superseding
reconciliation. The old run ledger must not be resumed: start a fresh run after integrating
`origin/main`, recording HEAD/merge-base, rebuilding with the production profile, and confirming
the measured runtime baseline. One validation-only plan review is sufficient; any reviewer request
for an operator decision must block immediately rather than consume another autonomous round.
