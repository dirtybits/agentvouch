---
name: base-a1-voucher-slashing-port
overview: "Finish Base A1 as a clean-break, centrally adjudicated PaidPurchaseReport mechanism: an eligible buyer files a 5 USDC bonded report within 7 days, filing locks collateral membership, the resolver reviews within 3 days, and an upheld ruling slashes the author bond plus author-wide vouches to fund a capped 7-day buyer credit. Split settlement into an immutably linked library, remain below EIP-170 with review headroom, and stop before any public-network deployment."
todos:
  - id: design-lock-a1-evm
    content: "DONE 2026-07-12 — Operator approved the final PaidPurchaseReport-only lifecycle, filing-time collateral lock, 3-day resolver review, 7-day filing/cooldown/claim windows, deterministic bond routing, author-bond-first percentage slash, author-wide voucher slash, initiating-buyer-only restitution, exact ABI, and linked-library architecture."
    status: completed
  - id: implement-contract
    content: "Replace the monolithic WIP and all legacy/FinancialReport paths with the final PaidPurchaseReport state machine plus immutably linked A1Settlement library; enable via_ir at optimizer runs=200 and freeze the facade/library storage boundary."
    status: pending
  - id: forge-tests
    content: "Add the behavioral, fuzz, invariant, pause, reentrancy, concurrency, replay, rounding, liability, linking, ABI, and runtime-size coverage in this plan. The existing 85 tests are pre-clean-break regression evidence only."
    status: pending
  - id: sync-artifacts
    content: "Synchronize the final base-v1-a1 ABI, deployment/link artifacts, isolated UI, harness, web consumers, selector/event/error snapshots, and remove active legacy report surfaces."
    status: pending
  - id: web-trust-surfaces
    content: "Expose deployment-bound Base A1 slash aggregates on chain-qualified Review-oriented trust surfaces; preserve historical receipt redemption and never synthesize Solana trust."
    status: pending
  - id: verify-and-record
    content: "Complete local-only Forge, size, ABI, storage, linking, chain-map, web, build, deployment-rehearsal, readiness, and runbook gates with concrete evidence."
    status: pending
  - id: deploy-smoke-sepolia
    content: "HUMAN-GATED — Only after explicit approval, deploy and verify a fresh linked Base Sepolia candidate and run the paid-report settlement smoke. This plan never authorizes Base mainnet."
    status: pending
isProject: false
---

# Base A1 Paid-Purchase Slashing Port

## Source of truth

This is the sole executable plan for branch `a2a/base-a1-voucher-slashing-port-20260709`. It was consolidated on 2026-07-12 from the final operator-approved decisions.

The non-normative review history is archived at [`../archives/base-a1-voucher-slashing-port-review-history-20260711-20260712.md`](../archives/base-a1-voucher-slashing-port-review-history-20260711-20260712.md). Git history and the archive explain how the design evolved; neither overrides this file.

## Goal

Ship one reviewable Base A1 mechanism:

> A verified paid buyer may file a bonded report; a trusted resolver decides it; and an upheld ruling slashes author-controlled and author-wide external backing to fund that buyer’s capped remedy.

Adjudication is centralized under `RESOLVER_ROLE`. Filing, expiry, voucher settlement, and pull claims are permissionless where specified. A1 has no decentralized jury, appeal, insurance fund, or guaranteed refund.

## Scope

### In scope

- Paid-purchase admission, report bond, filing locks, resolver review, dismissal/uphold ruling.
- Author-bond first loss, author-wide voucher snapshot, bounded permissionless crank, residual reclaim.
- Initiating-buyer-only credit, restitution-reserve accounting, seven-day claim expiry.
- Clean-break `base-v1-a1` ABI and complete artifact/client synchronization.
- Immutable `AgentVouchEvm` facade plus immutably linked external `A1Settlement` library.
- Base Sepolia-only deployment tooling, runtime-size enforcement, trust reads, and runbooks.

### Out of scope

- General or reputation-only on-chain reports.
- Multi-buyer pools, insurance, protocol backstop, reporter/keeper rewards, appeals, or A2 governance.
- Lane-C settlement receipts as report evidence.
- Proxy, facets, mutable module routing, or upgrade keys.
- Paid-report UI writes unless separately approved.
- Base mainnet enablement, deployment, or real-funds movement.

## Verified baseline — 2026-07-12

- Branch HEAD at baseline: `dfb4c86`.
- Merge-base with `origin/main`: `0d28904a`.
- The WIP checkpoint `492f7a06` remains in branch history.
- Main PR #98 already widened protocol-version columns to `VARCHAR(64)`; do not duplicate that migration.
- Forge 1.7.1 and solc 0.8.28: 85 legacy tests passed, zero failed.
- Current monolith:

| Profile                      |      Runtime |     Initcode | EIP-170 headroom | 23,500-byte soft headroom |
| ---------------------------- | -----------: | -----------: | ---------------: | ------------------------: |
| optimizer runs=200, no IR    | 27,931 bytes | 28,866 bytes |     -3,355 bytes |              -4,431 bytes |
| optimizer runs=200, `via_ir` | 26,545 bytes | 28,217 bytes |     -1,969 bytes |              -3,045 bytes |

Compiler settings alone do not solve deployability. Final facade and linked library must each be at most 24,576 runtime bytes and at most 23,500 project-soft-limit bytes. Creation input, including constructor arguments, must stay within EIP-3860’s 49,152-byte cap.

The current default EVM target resolves to `prague`. Pin an explicitly approved Base-supported target before final artifacts.

## Actors and trust

- **Buyer/reporter:** registered owner of the eligible paid receipt; pays the fixed report bond.
- **Author:** seller whose author bond and author-wide external backing are exposed.
- **Voucher:** external backer; Base vouches are author-wide until revoked.
- **Resolver:** trusted `RESOLVER_ROLE` that accepts/rejects and upholds/dismisses. Compromise can cause broad penalties.
- **Cranker:** anyone may submit bounded voucher pages; the operator remains the liveness fallback.
- **Reserve recipient:** immutable, nonzero, custody-approved recipient of excess and expired credits.
- **USDC:** six-decimal asset held only by the facade.
- **Upgrade model:** fresh immutable facade and fixed linked library; no proxy or mutable implementation.

## Locked constants and eligibility

| Rule                              | Value                                   |
| --------------------------------- | --------------------------------------- |
| Protocol version                  | `base-v1-a1`                            |
| Base Sepolia chain ID             | `84532`                                 |
| Canonical chain context           | `eip155:84532`                          |
| Purchase-to-filing window         | 7 days                                  |
| Report bond                       | 5 USDC                                  |
| Pending review window             | 3 days                                  |
| Rejected/dismissed buyer cooldown | 7 days                                  |
| Expired-report author cooldown    | 7 days                                  |
| Buyer credit claim window         | 7 days                                  |
| Minimum vouch                     | 1 USDC                                  |
| Free-listing author-bond floor    | 1 USDC                                  |
| Minimum paid-listing price        | 0.01 USDC                               |
| Purchase split with backing       | 60% author / 40% vouchers / 0% protocol |

`openPaidPurchaseReport` must prove that:

- the caller is the buyer on the exact stored purchase;
- the purchase is paid, belongs to the stated listing and author, and was filed no later than `purchase.timestamp + 7 days`;
- the listing may be removed, but historical receipt identity remains valid;
- evidence is nonempty and within `MAX_REPORT_EVIDENCE_URI_BYTES` before token pull or storage writes;
- stored `PurchaseLane` is `Direct` or `Authorization`.

Use `PurchaseLane { None, Direct, Authorization, Settlement }`, written atomically by each purchase path. `Settlement`/Lane-C is ineligible and callers cannot override provenance.

The purchase ID is consumed permanently at filing, including after rejection, expiry, dismissal, or uphold.

## Lifecycle

Use:

- `PaidPurchaseReportStatus { None, Pending, Accepted, SlashingVouchers, Terminal }`
- `PaidPurchaseReportOutcome { None, Rejected, Expired, Dismissed, Upheld }`

Missing IDs revert; they never return an all-zero report.

| Transition                         | Authority                | Required effects                                                                                                                                |
| ---------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| File → Pending                     | eligible buyer           | Pull 5 USDC; consume purchase; occupy buyer/listing/purchase/author slots; start collateral-membership and listing-economics locks.             |
| Pending → Accepted                 | resolver before deadline | Freeze every purchase lane for every author listing; record acceptance; do not increment a second lock.                                         |
| Pending → Rejected                 | resolver before deadline | Route bond to reserve; apply buyer-global cooldown; clear slots/locks once; no slash or author reputation effect.                               |
| Pending → Expired                  | anyone at/after deadline | Fund 5 USDC buyer pull credit; set seven-day claim deadline and author report cooldown; clear slots/locks once; no slash.                       |
| Accepted → Dismissed               | resolver                 | Route bond to reserve; apply buyer-global cooldown; clear slots/locks once; no slash.                                                           |
| Accepted → Upheld/SlashingVouchers | resolver                 | Preserve bond for buyer credit; slash author bond; snapshot percentage and active author-wide vouch stake; park only when voucher work remains. |
| SlashingVouchers → Terminal/Upheld | any cranker              | Process bounded retry-safe pages; finalize only at exact snapshot completion; fund buyer/reserve liabilities; release locks before transfers.   |
| Terminal credit → claimed/expired  | buyer/anyone             | Buyer pulls once within seven days; after deadline anyone converts unclaimed credit to reserve credit once.                                     |
| Reserve credit → claimed           | reserve recipient        | Pull independently without reopening or blocking reports.                                                                                       |

### Exact boundaries

- Filing at `purchase.timestamp + 7 days` succeeds; one second later reverts.
- Resolver acceptance or rejection succeeds only while `block.timestamp < reviewDeadline`.
- At `reviewDeadline`, both resolver branches revert and permissionless expiry succeeds.
- Cooldowns release exactly at their stored timestamp.
- Buyer claim requires `block.timestamp < claimDeadline`; reserve conversion succeeds at/after the deadline.
- Every terminal path clears each occupied slot and lock exactly once.

## Concurrency, locks, and pause

There is at most one nonterminal report per author, buyer, listing, and purchase. Filing occupies all four slots, so multiple Pending reports cannot target the same author.

### Filing-time collateral lock

From filing until any terminal outcome:

- block `withdrawAuthorBond`;
- block `vouch` and `revokeVouch` for the author;
- block listing removal, URI/price changes, free/paid transitions, and revision changes;
- allow name/description-only changes;
- allow `depositAuthorBond`; voluntary deposits enter the uphold-time slash base;
- allow author-proceeds withdrawal, voucher-revenue claims, and historical receipt verification;
- allow new purchases while Pending.

### Acceptance-time purchase lock

Acceptance additionally blocks all Direct, Authorization, and Settlement purchase lanes across every listing by that author until dismissal or finalization. Existing paid entitlements and signed raw-content redemption remain valid.

### Pause behavior

Pause blocks filing, acceptance, market entry, and ordinary author exits. Rejection, expiry, dismissal, uphold resolution, voucher crank, credit claims, reserve conversion/pull, and residual reclaim remain live so pause cannot strand liabilities or locks. `reviewPaidPurchaseReport(uint64,bool)` must enforce this per branch: acceptance may be paused while terminal rejection remains callable.

## Slashing and settlement

On uphold:

1. Snapshot `slashPercentage` and active author-wide vouch stake.
2. Read the current author-bond balance at uphold. Post-filing deposits are included.
3. Slash `floor(authorBond * slashPercentage / 100)` first.
4. For every active voucher, accrue rewards, count full pre-slash stake toward completion, slash `floor(preSlashStake * slashPercentage / 100)`, remove the full position from active backing, mark it Slashed, and retain only its unslashed residual for later reclaim.
5. Finalize immediately if snapshot vouch stake is zero; otherwise park for bounded crank pages.
6. Require `processedPreSlashStake == snapshottedActiveVouchStake` before finalization.

Duplicate vouchers and previously processed entries are idempotent skips. Stale/non-active candidates are skipped. A candidate for the wrong author reverts. Mixed stale/duplicate/active pages cannot overcount or finalize early.

A Slashed position earns no later voucher revenue. After terminal closure, its owner may reclaim the residual exactly once and then vouch again as a fresh position.

The free-listing bond floor is a creation/withdrawal gate, not protected principal. Slashing may leave an existing free listing below the floor; further withdrawals and new free listings remain blocked until restored.

## Economic ledgers

| Ledger                          | Funding                                                       | Ownership and cap                                                                             |
| ------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Report bond                     | buyer’s 5 USDC                                                | Returned only on upheld or expiry; rejected/dismissed bond goes deterministically to reserve. |
| Enforcement                     | author bond, then active author-wide vouches                  | Same snapshotted percentage; no resolver-selected amount or beneficiary.                      |
| Buyer restitution               | enforcement assets                                            | `min(totalSlash, initiatingPurchase.priceUsdcMicros)`; partial refund allowed; no backstop.   |
| Buyer credit                    | bond return plus restitution                                  | Exactly one initiating buyer; seven-day pull claim.                                           |
| Restitution reserve             | slash excess, rejected/dismissed bonds, expired buyer credits | Immutable recipient; pull-only; never operating revenue.                                      |
| Reporter/keeper/resolver reward | none                                                          | No author-proceeds debit, bounty, or payout discretion.                                       |

On uphold:

- `buyerEntitlement = min(totalSlash, purchasePrice)`
- `buyerCredit = 5 USDC + buyerEntitlement`
- `reserveCredit = totalSlash - buyerEntitlement`

A zero-total-slash uphold still funds exactly the 5 USDC bond-return credit. Restitution and slash-derived reserve credit are zero.

Record liabilities and release locks before any external transfer. Raw contract balance is never surplus while bonds, stake, proceeds, voucher revenue, buyer credits, or reserve credits remain outstanding.

## Voucher-revenue rounding

Use two aggregate ledgers:

- `voucherRevenuePendingDistributionUsdcMicros`: funded whole micros not yet materialized into voucher accrual balances.
- `voucherRevenueClaimableUsdcMicros`: exact sum of materialized, unpaid voucher accruals.

At purchase, route the index-division remainder to author proceeds and book only the distributable amount as pending. When a position accrues, move exactly its newly floored whole-micro amount from pending to claimable. Claims decrement claimable exactly.

Accrue before revoke or slash. When the final active position exits, send remaining pending-distribution residue to author proceeds and zero it. Never sweep already-materialized claims. Fuzz unequal stakes, repeated purchases, and arbitrary claim/revoke/slash ordering; every purchase micro must remain conserved.

## Frozen clean-break ABI

The only A1 functions are:

| Purpose           | Exact signature                                                                                                       |
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

`reviewPaidPurchaseReport(reportId, true)` means Accept and `false` means Reject.
Resolution uses `PaidPurchaseReportRuling { None, Dismissed, Upheld }`, whose canonical `uint8`
values are 0, 1, and 2. `resolvePaidPurchaseReport` accepts only 1 or 2; zero and values above 2
revert. Freeze these encodings in Solidity, every ABI consumer, and invalid-value tests.

Core tuple order: buyer, author, listing ID, purchase ID, filed timestamp, review deadline, accepted timestamp, terminal timestamp, status, outcome.

Settlement tuple order: snapshotted slash percentage, snapshotted active-vouch stake, processed pre-slash stake, author-bond slash, voucher slash, buyer entitlement, funded buyer credit, claim deadline, claimed-or-expired flag.

### Events

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

### A1 custom errors

`PaidPurchaseReportNotFound`, `PaidPurchaseReportInvalidState`, `PaidPurchaseReceiptIneligible`, `PaidPurchaseReceiptConsumed`, `PaidPurchaseBuyerBusy`, `PaidPurchaseListingBusy`, `PaidPurchaseAuthorBusy`, `PaidPurchaseBuyerCooldown`, `PaidPurchaseAuthorCooldown`, `PaidPurchaseReviewExpired`, `PaidPurchaseReviewOpen`, `PaidPurchaseEvidenceTooLong`, `PaidPurchaseSlashPageTooLarge`, `PaidPurchaseSlashSnapshotIncomplete`, `PaidPurchaseCreditNotFunded`, `PaidPurchaseCreditExpired`, `PaidPurchaseCreditOpen`, `PaidPurchaseCreditAlreadyHandled`, and `PurchaseLaneIneligible`.

Remove every active `openReport`, generic report, `FinancialReport*`, reporter-reward, shared-pool, and `forfeitReporterBond` selector/event/error. Compiled artifact, facade ABI, UI, harness, web fragments, and operational docs must match exactly.

## Contract architecture and size

- Add `contracts/base-poc/src/libraries/A1Settlement.sol` as an external linked library whose mutating calls execute through `DELEGATECALL`.
- The facade remains sole storage owner, USDC custodian, reentrancy boundary, role gate, and event origin.
- Pass explicit facade storage references and the immutable USDC value into library calls. Treat
  every library argument as an authorization boundary; the library has no independent state.
- Keep admission/review wrappers, roles, pause, commerce, compact reads, and user-facing selectors on the facade.
- Move uphold accounting, author-bond slash, voucher crank, final allocation, buyer-credit accounting, expiry conversion, and reserve accounting behind thin facade wrappers.
- Share reward accrual through one internal helper; no external self-call.
- Freeze `forge inspect` storage layouts and artifact link references before integration.
- Test raw mutating CALL to the library fails, facade DELEGATECALL succeeds, wrong/missing links fail, library code hashes match, and no unprivileged facade route reaches settlement.
- Normalize deployed-library self-address patches before bytecode hash comparison.
- Enable and pin solc 0.8.28, optimizer runs=200, `via_ir=true`, metadata settings, and an approved Base EVM target.

## Files to change

- `contracts/base-poc/src/AgentVouchEvm.sol`
- `contracts/base-poc/src/libraries/AgentVouchTypes.sol`
- `contracts/base-poc/src/libraries/A1Settlement.sol`
- `contracts/base-poc/foundry.toml`
- `contracts/base-poc/test/AgentVouchEvm.Slashing.t.sol` and affected legacy suites
- `contracts/base-poc/script/Deploy.s.sol` and `contracts/base-poc/setup.sh`
- `contracts/base-poc/ui/src/abi.ts`, UI config/env examples, and harness ABI/examples
- `web/lib/adapters/agentVouchEvmAbi.ts`, `web/lib/adapters/baseWallet.ts`
- `web/lib/basePurchaseVerification.ts`, `web/lib/baseAuthorTrust.ts`, trust/receipt fixtures and tests
- `scripts/verify-base-runtime-size.mjs`, `scripts/verify-chain-capability-map.mjs`, root `package.json`, CI
- `docs/CHAIN_CAPABILITY_MAP.md`, `docs/MAINNET_READINESS.md`, `docs/BASE_DEPLOY.md`, `docs/ARCHITECTURE.md`, `docs/PRODUCTION_RUNBOOK.md`, `contracts/base-poc/README.md`, `web/public/skill.md`, and affected phase plans

Do not add dependencies, expand `ChainAdapter`/`ChainWallet`, or add paid-report UI writes without separate approval.

## Implementation sequence

1. **Run the size-feasibility spike first.** Extract a representative external `A1Settlement`,
   link it into the current facade under the target compiler profile, and measure post-link facade
   and library runtime/initcode. Stop and re-plan before full implementation unless both artifacts
   are at or below the 23,500-byte soft limit and all hard limits.
2. **Capture the baseline.** Preserve compiler config, ABI, storage layout, and link references.
3. **Normalize state and ABI.** Remove legacy/FinancialReport state and surfaces; add final enums,
   provenance, slots, cooldowns, liabilities, compact getters, events, and errors.
4. **Implement admission and review.** Add exact receipt checks, filing locks, concurrency slots,
   deadlines, deterministic reject/expiry behavior, and author-wide acceptance purchase freeze.
5. **Complete settlement.** Implement author-bond-first uphold, bounded voucher pages, exact
   completion, two-ledger reward accounting, final credits, and residual reclaim in the linked library.
6. **Add adversarial tests.** Complete the matrix below before touching web integration.
7. **Enforce deployability.** Add runtime/initcode CI limits, link/storage/ABI snapshots, pinned
   compiler identity, and no-broadcast linked deployment rehearsal.
8. **Synchronize consumers.** Update UI/harness/web ABIs, retire active legacy Base report UI,
   preserve historical entitlement reads, and add deployment-bound trust data.
9. **Update operations and docs.** Add crank reconstruction/checkpointing, resolver
   monitoring/recovery, cutover tuple, rollback, chain map, readiness, and public capability wording.
10. **Stop locally.** Do not deploy or repoint Base Sepolia without explicit approval.

## Required regression and adversarial tests

### Admission and lifecycle

- Wrong/nonexistent/free/other-buyer/other-listing/stale/ineligible-lane receipt; self-report; empty/oversized evidence; reused purchase.
- Removed-listing historical receipt within the filing window.
- Boundary filing, review deadline, claim deadline, buyer-global cooldown across authors/listings,
  and author-global cooldown across buyers/listings.
- Boolean review encoding, ruling values 1/2, and invalid ruling values 0 and above 2.
- One active author/buyer/listing/purchase slot; second buyers and revisions; duplicate terminal calls.
- Filing lock behavior for every affected function; purchases allowed Pending and blocked author-wide after acceptance.
- Post-filing bond deposit included in uphold-time slash base.
- Repeated expiry attempts across buyers/revisions cannot continuously lock an author.

### Slashing, rewards, and accounting

- Dismissed, zero-slash, bond-only, voucher, partial, full, multi-page, empty page, out-of-order page, mixed stale/duplicate/active page, wrong author, and exact final page.
- Slash floors/caps and values near type limits; author bond below/equal/above computed slash.
- Pre-slash rewards remain claimable; post-slash rewards stop; residual reclaim and revouch each happen once.
- Unequal-stake two-ledger rounding conservation under arbitrary purchase/claim/revoke/slash order.
- Stateful invariant across multiple reports, pauses, claims, expiry, partial cranks, and residual reclaim:
  contract balance covers every bond, stake, residual, proceeds balance, pending distribution, voucher claim, buyer credit, and reserve credit.
- Buyer-only one-time pull; seven-day expiry; reserve conversion/pull; no backstop or alternate beneficiary.

### Security and liveness

- Resolver authorization, role handoff, init-once config, `1 <= slashPercentage <= 100`, exact fixed economics, nonzero reserve recipient.
- Base Sepolia `block.chainid == 84532` and exact `eip155:84532` context validation; production
  script pins Circle Base Sepolia USDC and validates code/decimals.
- Pause matrix keeps every terminal/claim path live.
- Reentrant, reverting, blacklisted, false-return, and no-return token/recipient behavior cannot corrupt accounting or block unrelated finalization.
- Named max crank page, max-plus-one revert, worst-case gas assertion, idempotent restart.
- Successor deployment cannot replay purchases or strand old claims.

### ABI, size, linking, and web

- Exact selector/event/error parity across artifacts and consumers; stale active selectors absent.
- Compact getter/evidence encoder size measured.
- Storage-layout and link-reference snapshots; raw CALL/DELEGATECALL/wrong-link/code-hash/event-origin tests.
- Facade and library hard/soft runtime limits plus EIP-3860 creation-input limit.
- Historical receipt verification is independent from current listing purchasability and remains valid after removal, lock, more than 20 revisions, and environment cutover.
- Existing buyer raw download succeeds while new purchases are frozen; non-buyer remains rejected.
- Deployment-bound reads keyed by chain context, lowercase facade, exact version, and author/listing.
- Base A1 aggregates distinguish upheld count, author-bond slash, and voucher slash; unsupported reads are unavailable, never zero or Solana-derived.
- Base remains mechanically Review-capped; adverse evidence may still produce Avoid.
- Treat `totalVouchesReceived` as a lifetime counter only; never present it as active stake or
  active-voucher count. Test labels and recommendation inputs accordingly.

## Local verification

Run with Node 24 on PATH:

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
npm run build --prefix contracts/base-poc/ui
npm run typecheck --prefix contracts/base-poc/harness
```

Also record:

- `forge config --json` and exact compiler/metadata/EVM/link profile;
- `forge inspect` ABI, storage layout, deployed bytecode, and link references;
- facade/library runtime and initcode sizes with hard and soft headroom;
- repo-wide active-surface stale-selector absence;
- dependency-free runtime-size verifier result;
- Anvil chain ID 84532 linked deployment rehearsal with `MockUSDC`, wrong-chain/wrong-link failures, initialization, least-privilege role handoff, and an end-to-end report/crank/claim/reserve/residual slice.

## Web and operational requirements

- Split historical receipt verification from live listing purchasability.
- Retire/version-gate legacy Base `OPEN_REPORT_SELECTOR`, `openBaseAuthorReport`, and Base report submission UI without expanding the wallet interface.
- Keep old-candidate reads available through exact deployment identity; new writes remain pinned to the explicitly active candidate.
- Treat contract address, deploy block, event-scan setting, protocol version, reserve recipient, and role ownership as one cutover/rollback tuple.
- Crank tooling reconstructs candidates from deployment-block events, checks live stake sum against the snapshot, submits restart-safe pages, and queries Base Sepolia logs in at most 1,999-block chunks.
- Deployment gates require an accepted-report age alarm, resolver recovery procedure, named fallback cranker, exposure limits, reserve custody, and incident response.
- A blacklisted, reverting, or lost-key reserve recipient leaves an indefinite liability but
  cannot block report finalization. A1 has no admin redirect, sweep, or recovery authority.
- Public capability copy must say centralized adjudication and collateral-limited restitution; it must not promise guaranteed refunds or decentralized resolution.

## Deployment, rollout, and rollback

### Local rehearsal

Use Anvil with chain ID 84532 and `MockUSDC`. Deploy/link the library first, then facade; initialize fixed economics, reserve, and roles explicitly. Record code hashes, link references, role ownership, config, and balance deltas. No broadcast.

### Base Sepolia — human gated

Only after explicit approval:

- deploy and verify fresh library and facade;
- run isolated fresh-listing/report fixtures before any shared cutover;
- record transaction hashes, blocks, explorer links, explicit-block USDC deltas, roles/config, and deadlines;
- prove report, reject/expiry, accept/uphold, multi-page crank, final credit, reserve excess, residual reclaim, and premature close;
- run Base passkey regression before and after approved cutover plus shared Solana trust/purchase regression;
- run the CDP paymaster allowlist regression;
- update the deployment-bound registry and capability/readiness records.

Use an executable smoke driver that emits machine-readable transaction hashes, blocks, code hashes,
roles, deadlines, and explicit-block balance evidence; prose-only rehearsal notes do not satisfy
the gate.

Public Sepolia cannot time-warp; prove seven-day expiry locally and record the live deadline plus premature-close revert on Sepolia.

### Rollback

Before deployment, revert the PR. After a Sepolia candidate exists, leave old claims and the old facade reachable; there is no proxy rollback. Repoint clients only after inventorying contract-bound rows, entitlements, and liabilities.

### Base mainnet

This plan never authorizes `eip155:8453`, a mainnet deploy, real-funds transaction, custody change, or broad enablement. All remain blocked by `docs/MAINNET_READINESS.md` and explicit human approval.

## Design decisions — final 2026-07-12

- PaidPurchaseReport-only clean break; no general report path.
- Central resolver adjudication; permissionless bounded settlement.
- Filing-time collateral lock, acceptance-time author-wide purchase lock.
- One nonterminal report per author and seven-day author cooldown after resolver-inactivity expiry.
- Direct and Authorization receipts eligible; Settlement/Lane-C excluded.
- Author-bond-first percentage slash using uphold-time balance; author-wide voucher percentage slash.
- Initiating buyer gets bond plus restitution capped at purchase price; excess to immutable reserve.
- Seven-day claim; no reporter reward, proceeds debit, discretion flag, or backstop.
- Free-listing floor is a creation/withdrawal gate only.
- Name/description edits allowed while locked; economic listing changes blocked.
- Two-ledger voucher-revenue rounding with final pending residue to author.
- Immutable linked library plus `via_ir`; no proxy.
- Exact `base-v1-a1` ABI above.
- Review history is archived and non-normative.

## Open deployment inputs

These do not block local implementation but block any deployment:

- final `slashPercentage`;
- reserve recipient;
- resolver, pause, config, settlement, and admin owners;
- named cranker/monitoring operator and exposure limits;
- approved pinned Base EVM target;
- explicit Base Sepolia deployment and cutover approval.
