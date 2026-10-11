---
name: Base alpha purchase and USDC admission limits
overview: "Propose the smallest on-chain cap implementation for a founder-operated Base alpha, with a total money-accepted limit that does not reset after withdrawals and reserved report-bond capacity. No cap values, implementation, public transactions, or mainnet activation are approved by this plan."
todos:
  - id: approve-cap-model
    content: Approve the cumulative admission model and its exhaustion behavior; keep deployment amounts separately pending.
    status: pending
  - id: implement-and-check-size
    content: "Implement purchase-price and checks that stop new money from exceeding the limit, then prove they fit existing bytecode budgets without removing safety checks."
    status: pending
  - id: integrate-paused-setup
    content: "Add one-time paused limit configuration, refresh exact artifact pins, and update deployment and local practice run assertions."
    status: pending
  - id: cover-accounting-and-bypasses
    content: Test every purchase lane, repeated deposits, report headroom, rollback on failure, and unchanged settlement and exit behavior.
    status: pending
  - id: expose-and-document-limits
    content: Add curated limit reads and errors, deployment evidence fields, and accurate operator and agent-facing documentation.
    status: pending
  - id: run-release-checks
    content: "Run contract, size, ABI, chain-map, web, and disposable local practice run checks after implementation approval; record actual results."
    status: pending
isProject: false
---

<a id="limit-purchase-size-and-usdc-intake-for-the-base-alpha"></a>

# Limit each purchase and total money accepted during the first Base release

<!-- plain-language-reading-guide: 2026-09-21 -->

> **Start with the plain-language guide:** [What we are building, money limits, and launch steps](../../docs/PLAIN_LANGUAGE_GUIDE.md).
>
> This document uses technical identifiers so operators can find the matching code. The guide explains those identifiers in plain language.
>
> Language note, 2026-09-21: technical names, approval states, and recorded test or deployment evidence are unchanged. This wording pass did not run new checks.

## Read this decision before the implementation details

This is a proposed limit on money accepted from buyers, authors, and backers. It is not a development budget, a network-fee budget, or the contract code-size limit.

There are two possible rules:

| Rule                                                  | What happens after an allowed withdrawal?              |
| ----------------------------------------------------- | ------------------------------------------------------ |
| Maximum money held at one time                        | The withdrawal makes room for another deposit.         |
| Maximum money accepted during the whole first release | The withdrawal does not make room for another deposit. |

This plan proposes the second rule because it requires less accounting code. You have not approved that choice. It can eventually stop new payments even if the service works correctly and holds little money. Changing to the first rule requires a design change, not just clearer wording.

**Example only, not approved settings:** with a total limit of 1,000 USDC, a 100 USDC deposit uses 100 of the limit. If that money is later withdrawn, 900 of the limit remains. It does not return to 1,000.

### A purchase also leaves room for a possible report

The updated Base contract uses a 5 USDC deposit when a buyer files an eligible report. For a 10 USDC purchase, this plan would count 15 USDC toward the total limit: 10 for the purchase and 5 reserved in the limit for a possible later report.

The buyer pays only 10 USDC at checkout. The extra 5 is not a checkout fee and is not collected unless the buyer files a report. Reserving that room prevents a full money limit from blocking an otherwise eligible report. Existing pause and report-eligibility rules still apply.

The maximum purchase price, the total limit, implementation, and deployment all remain unapproved. Writing this plan does not approve any of them.

## Status and authorization

Drafted 2026-09-21 from the local source inspection in this task. The user approved preparation of an implementation plan, not implementation or execution of its checks. All execution TODOs remain pending.

This plan proposes a cap policy. The maximum purchase price and total total money-accepted limit are not approved. It does not change the existing slash percentage, report bond, role assignments, policy for holding and using signing keys, release gates, or deployment status. Base mainnet remains blocked.

## Goal

Bound the USDC that a fresh Base alpha deployment can admit through protocol operations. Enforce the limits in the contract so direct callers cannot bypass app restrictions. Do not add new budget checks to legitimate report settlement or claims.

Keep this an additive safety change to the current paid-purchase report system, not a governance, refund-economics, or multichain redesign.

## Proposed accounting model

Use a **total money-accepted limit that does not reset after withdrawals**, not a rolling TVL limit or a daily budget. This is deliberately conservative for a limited alpha.

All amounts are integer USDC micro-units. Define:

- `M`: maximum paid listing and purchase price.
- `B`: total total money-accepted limit for this deployment.
- `C`: money and report-bond allowance counted so far, initially zero.
- `R`: the existing fixed report bond, `5_000_000` micro-USDC.

Charge successful operations as follows:

| Operation                                                               | Amount counted toward C                     | Where the code checks the limit                                       |
| ----------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------- |
| Author-bond deposit or top-up                                           | Full deposit amount                         | `depositAuthorBond`                                                   |
| Vouch or re-vouch                                                       | Full new stake amount                       | `vouch`                                                               |
| Direct purchase                                                         | Listing price plus R                        | Shared `_recordPurchase`                                              |
| Authorization-based purchase                                            | Listing price plus R                        | Shared `_recordPurchase`                                              |
| Privileged legacy settlement receipt                                    | Listing price                               | Shared `_recordPurchase`; this lane is not report-eligible            |
| Eligible paid-purchase report                                           | No additional charge                        | Existing receipt checks consume its already-reserved report allowance |
| Withdrawals, claims, slash transfers, reserve allocation, report expiry | No charge and no budget release             | Existing settlement and exit logic                                    |
| Profile registration, listing creation or edit                          | No admission charge                         | Paid listing prices must still be at most M                           |
| Unsolicited direct USDC transfers                                       | No admission charge or usable budget credit | Do not infer available budget from token balance                      |

Before an admission, require `charge <= B - C`, then increase C in the same transaction as the existing operation. Any later revert, including a failed token transfer, must roll back the charge.

### Why report capacity remains available

Each report-eligible purchase reserves R at purchase time. The existing receipt-consumed guard permits at most one report per purchase. Opening that report transfers the actual bond but must not charge it twice or require additional room remaining under the total money-accepted limit.

Unused reservations remain charged forever, including after the report window expires. Do not add expiry scanning, reserve recycling, or per-receipt budget-release state in this phase.

The accounting target is:

`cumulative protocol-accounted inflows <= C <= B`

Protocol-accounted inflows include credited legacy settlement amounts, but this plan does not remove that lane's existing reliance on the settlement authority. The cap is not proof of collateralization for that lane. It also does not guarantee full buyer refunds or bound unsolicited token transfers.

### Behavior at the cap

- Reject new purchases and deposits that do not fit the remaining budget, regardless of caller or purchase lane.
- Do not automatically pause the contract when C reaches B. A global pause also blocks new reports under the existing policy.
- While otherwise unpaused, allow eligible reports on existing purchases even at C = B.
- Keep existing pause, dispute-lock, and time-lock rules unchanged. For example, author-bond and author-proceeds withdrawals are still blocked by the existing global pause; buyer-credit claims and eligible voucher exits retain their current behavior.
- Withdrawals, refunds, slash settlement, expired credits, pause/unpause, and role rotation never replenish C.
- No reset, cap increase, or automatic top-up endpoint is included. Continuing after exhaustion requires a separately approved release or follow-up design; do not redirect existing liabilities to another deployment.

### Trade-off requiring approval

This model bounds cumulative admitted activity more strictly than current funds held. Repeated withdrawal and redeposit consumes budget again. The alpha can stop accepting new money even when its current token balance is low. In return, accounting does not have to change every settlement and withdrawal path.

This is a proposed simplification, not an already-approved definition of "aggregate exposure." Per-wallet limits and an on-chain invite list are deferred. The budget bounds volume, not admission fairness or participant identity; an open caller can consume the remaining budget.

## Minimal contract design

1. Append three internal values to the facade's existing storage: M, B, and C. Preserve all existing storage members and the `Config`, profile, purchase, and report tuple layouts. Keep `PaidPurchaseSettlement.sol` unchanged unless the size gate forces a separately reviewed scope change.
2. Add `initializeAlphaLimits(uint256 maxPaidListingPriceUsdcMicros, uint256 admissionBudgetUsdcMicros)`. Require `CONFIG_ROLE`, a paused contract, no prior limit initialization, and no prior config initialization. A nonzero M can represent initialized state without another stored flag.
3. Reject M below the existing paid-listing minimum or B below `M + R`. Use checked arithmetic and reject invalid or overflowing inputs. There are no deployment defaults and no zero-as-unlimited mode.
4. Require initialized limits before `initializeConfig` can complete. Preserve the uninitialized first deployment stage. The paused staging order becomes: verify candidate, pause, initialize limits, initialize existing config, hand off roles, verify values, remain paused.
5. Enforce M on paid listing creation and updates and again in the shared purchase validation path. Free listings retain their existing bond-floor behavior.
6. Add a single internal shared helper that counts money toward the total limit. Call it from bond deposits, vouches, and shared purchase accounting. Both direct and authorization receipts reserve R; the report-ineligible settlement lane does not.
7. Add a small `getAlphaLimits()` read returning M, B, and C, plus initialization/error ABI needed for operators and meaningful failures. Missing selectors must never be interpreted as an unlimited or capped-safe deployment.
8. Retain the current protocol family identifier and existing tuple ABI for this additive proposal. Prove the capped release using its new address, exact artifact hash, and initialized limit reads; `base-v1-a1` alone does not prove caps. If tuple or settlement changes become necessary, stop and explicitly scope a protocol-version migration.

## Bytecode feasibility is an early gate

The source currently pins the facade runtime to 23,487 bytes in `A1DeploymentConfig.sol`. `scripts/verify-base-runtime-size.mjs` enforces a 23,500-byte soft budget, leaving only 13 bytes against that recorded artifact. This task did not rebuild or measure fresh bytecode.

Implement the smallest cap prototype and measure it before expanding client work. Do not silently raise the soft budget, change hard bytecode limits, disable ABI/storage checks, remove safety checks, or add a second linked library to make the gate pass. If the change cannot fit, report the measured size and propose a bounded refactor or explicit soft-budget decision before continuing.

Adding storage and code also changes release evidence. Compare the old storage prefix with the new append-only layout, then regenerate the expected storage hash, runtime length, link offsets, and immutable offsets from the reviewed compiler artifact. Do not merely replace a failing hash or guess offsets. Preserve negative tests that reject the old or wrong artifact.

## Files for the implementation phase

Paths below are repository-relative. Only this plan file is created in the planning turn.

| File                                                                                                    | Planned change                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contracts/base-poc/src/AgentVouchEvm.sol`                                                              | Append cap state, one-time initializer, read method, price guards, and shared counting money toward the total limit.                                                              |
| `contracts/base-poc/script/A1DeploymentConfig.sol`                                                      | Validate cap inputs and reads; regenerate exact artifact pins and add fresh-deployment limit assertions.                                                                          |
| `contracts/base-poc/script/StageA1.s.sol`                                                               | Read proposed `ALPHA_MAX_PAID_PRICE_USDC_MICROS` and `ALPHA_ADMISSION_BUDGET_USDC_MICROS`; configure limits while paused before normal config and verify them after role handoff. |
| `contracts/base-poc/script/RehearseA1.s.sol`                                                            | Configure explicit local-only fixture limits and exercise report/claim behavior after reaching the total money-accepted limit.                                                    |
| `contracts/base-poc/test/AgentVouchEvm.AlphaAdmissionLimits.t.sol` (new)                                | Boundary, bypass, rollback, donation, lifecycle, and no-replenishment tests.                                                                                                      |
| `contracts/base-poc/test/AgentVouchEvm.PaidPurchaseInvariant.t.sol`                                     | Track ghost admitted inflows and report reservations; assert C <= B across generated operation sequences.                                                                         |
| `contracts/base-poc/test/Deploy.A1DeploymentConfig.t.sol`                                               | Cover limit setup order, input validation, final reads, and old-artifact rejection.                                                                                               |
| `scripts/verify-base-runtime-size.mjs`                                                                  | Extend expected ABI and intentionally refresh the storage-layout pin after review; preserve existing size ceilings and single-library rules.                                      |
| `web/lib/adapters/agentVouchEvmAbi.ts`                                                                  | Add cap read/error fragments without changing existing tuples or exporting operator initialization to buyer write APIs.                                                           |
| `contracts/base-poc/ui/src/abi.ts`, `contracts/base-poc/harness/src/abi.ts`                             | Add corresponding cap reads/errors and operator initializer fragments.                                                                                                            |
| `scripts/verify-base-a1-paid-report-abi.mjs`                                                            | Extend compiled-artifact parity coverage for cap reads/errors and operator-only initialization while retaining all paid-report checks.                                            |
| `web/scripts/base-paid-report-e2e-smoke.ts`, `web/__tests__/scripts/base-paid-report-e2e-smoke.test.ts` | Require exact initialized cap reads in candidate readiness evidence; preserve read-only modes and explicit execution authorization boundaries.                                    |
| `docs/BASE_DEPLOY.md`, `docs/BASE_SEPOLIA_A1_STATE.md`                                                  | Record setup order, cap values, cumulative semantics, cap exhaustion, and separate deployment/activation evidence without rewriting historical results.                           |
| `docs/CHAIN_CAPABILITY_MAP.md`, `docs/MAINNET_READINESS.md`, `web/public/skill.md`                      | Describe implemented versus deployed caps accurately; keep mainnet blocked and explain that withdrawals do not reopen intake.                                                     |

Existing deployment/config initialization fixtures also need the paused limit setup before their existing `initializeConfig` calls. The initial search identified these exact additional files:

- `contracts/base-poc/test/AgentVouchEvm.State.t.sol`
- `contracts/base-poc/test/AgentVouchEvm.BondsVouchesListings.t.sol`
- `contracts/base-poc/test/AgentVouchEvm.Purchase.t.sol`
- `contracts/base-poc/test/AgentVouchEvm.UpdateListing.t.sol`
- `contracts/base-poc/test/AgentVouchEvm.X402.t.sol`
- `contracts/base-poc/test/AgentVouchEvm.Reports.t.sol`
- `contracts/base-poc/test/AgentVouchEvm.PaidPurchaseAdversarial.t.sol`
- `contracts/base-poc/test/AgentVouchEvm.PaidPurchaseReentrancy.t.sol`
- `contracts/base-poc/test/AgentVouchEvm.PaidPurchaseTokenBehavior.t.sol`
- `contracts/base-poc/test/gasless/AgentVouchEvm.Gasless4337.t.sol`

Use explicit fixture-only cap values that preserve each test's original purpose. Do not hide regressions by deleting original assertions or weakening deployment guards. `Deploy.s.sol` should retain its uninitialized, separate first-stage behavior and existing constructor signature.

## Acceptance tests

- Unauthorized, unpaused, duplicate, post-config, zero, invalid-relation, and overflowing limit initialization fail; configured limits cannot be reset or raised.
- Paid prices at M succeed where other conditions permit; M + 1 fails at creation, update, and all purchase entry points. Free listings keep their current requirements.
- Mixed bond deposits, top-ups, vouches, re-vouches, and all three purchase lanes share C. Exact remaining headroom succeeds; one micro-unit over fails.
- Different wallets, repeated deposits, new listings, and new revisions cannot bypass the global budget. Wallet changes do not create a new global allowance.
- Failed transfers, authorization failures, duplicate purchases, and failed settlement validation do not consume C or reserve a report bond.
- At C = B, a pre-existing eligible buyer can still file a report while unpaused. Reusing the receipt or using a report-ineligible settlement receipt fails.
- Report rejection, expiry, dismissal, upheld settlement, voucher slash pages, buyer-credit claim/expiry, reserve withdrawal, and backer's remaining deposit exits never increase C or reset it. Existing pause and lock behavior remains unchanged.
- Author withdrawals and all other payouts do not replenish budget. Unused report reservations are not released on expiry.
- Direct USDC donations neither consume room remaining under the total money-accepted limit nor create receipts, credits, or capacity to bypass the cap. Token balance is not used as the admission counter.
- Artifact/ABI checks reject stale capped-release evidence. Mainnet initialization remains rejected. No code in this phase enables `eip155:8453`.

## Verification after separate implementation approval

Run from the repository root. Use the repository's Node 24 setup for npm commands. These are future commands, not results from this planning turn.

```sh
forge build --root contracts/base-poc
forge test --root contracts/base-poc --match-path 'test/AgentVouchEvm.AlphaAdmissionLimits.t.sol'
forge test --root contracts/base-poc
npm run verify:base-size
node scripts/verify-base-a1-paid-report-abi.mjs
npm run verify:chain-map
npm run format:check
npm run lint --workspace @agentvouch/web
npm exec --workspace @agentvouch/web -- tsc --noEmit
npm exec --workspace @agentvouch/web -- vitest run
npm exec --workspace @agentvouch/web -- next build --webpack
```

Run the existing `contracts/base-poc/scripts/local-a1-rehearsal.sh` only after reviewing its local-only prerequisites and authorizing the disposable local run. Record the compiled sizes, layout/hash evidence, actual test results, and cap readings. Do not present a failed or skipped build as passed, and do not use production secrets to make a local gate pass.

## Separate gas-sponsorship work

Contract USDC caps do not cap relayer ETH spending. The reviewed Base relayer has a transaction gas-unit limit, not an explicit fee ceiling or cumulative spend budget. Hosted paymaster policies were not inspected.

Keep this contract PR independent of database-backed relayer accounting. Before activating server-funded checkout, separately require a per-transaction maximum total fee, a durable concurrency-safe budget shared by both Base relayer entry points, reservation/reconciliation of pending transactions, and the applicable Base L1-data-fee allowance. Do not treat fee-per-gas alone as a complete transaction-cost cap. Also verify hosted paymaster policy for any enabled smart-account route.

The reviewed integration points for that follow-up are `web/lib/baseX402.ts`, `web/lib/skillRawAccess.ts`, `web/app/api/x402/settle/route.ts`, and `web/lib/adapters/baseWalletConfig.ts`. That follow-up requires its own exact implementation plan; it is not silently included here. Until satisfied, use an explicitly configured non-sponsored path or keep the affected sponsored path disabled. No hosted settings are changed by this plan.

## Rollout and rollback

- Implement and review locally first. Obtain explicit approval before commits/publication, public-chain transactions, custody changes, or hosted activation.
- Use a fresh candidate deployment; do not claim that editing source changes any existing immutable contract. Keep existing purchase records tied to the exact deployed contract and liabilities attached to their original contract.
- Preserve the separate sequence: deploy uninitialized, verify artifact, stage limits/config/roles while paused, run an explicitly approved isolated Sepolia lifecycle, then seek separate preview/shared-testnet activation approval.
- Record public approved cap values alongside the exact release hash and address. Mainnet limits and activation require separate approval; testnet amounts do not approve mainnet exposure.
- On an incident, follow the existing pause/runbook policy. Cap exhaustion alone rejects new admission without calling pause. Do not erase C, recycle withdrawn funds into budget, or change accounting to hide exhaustion.
- An old uncapped contract is not an acceptable capped-alpha rollback. Preserve old user claims, but never redirect new alpha intake to it as a shortcut.

## Pending decisions and stop conditions

- Founder approval of the cumulative, non-replenishing model and the fact that an open caller can consume the remaining budget.
- Founder-approved M and B for each explicitly authorized deployment; no amounts are selected in this plan.
- Bytecode feasibility under the existing enforced budgets. A budget exception or broader library refactor requires a separate decision.
- Existing custody, security-review/risk-acceptance, restitution, operational, and launch gates remain open where their canonical records say so.
- Any change to report eligibility, the fixed report bond, tuple ABI, reserve economics, pause behavior, or settlement authority scope stops this minimal plan for a separate design review.
- No tests, builds, live-chain checks, transactions, environment changes, or application edits were performed to create this plan.
