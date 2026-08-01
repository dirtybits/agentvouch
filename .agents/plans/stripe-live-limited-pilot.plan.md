---
name: stripe-live-limited-pilot
overview: "Prepare a founder-approved, walletless limited live-card pilot with enforceable scope, durable exposure accounting, explicit buyer recourse disclosure, external WAF proof, and fail-closed rollback without treating card sales as protocol settlement."
todos:
  - id: record-founder-decisions
    content: Complete every required founder, legal, accounting, support, exposure, and operator decision field in this plan; placeholders are a stop gate.
    status: pending
  - id: finish-live-pilot-controls
    content: Add the buyer allowlist, durable reservation and amount-fee-net ledger, and atomic GMV/completed-payment caps on top of the shipped live-key skill allowlist and unit ceiling.
    status: completed
  - id: prove-external-activation-gates
    content: Record merchant-of-record/customer-facing identity, payout and tax/KYC ownership, publish and verify the Vercel WAF rule, and prove production webhook/schema/monitoring readiness.
    status: pending
  - id: deploy-disclosure-dormant
    content: Deploy the versioned checkout recourse acknowledgement and public docs with all card flags off, then browser-verify the exact production copy and disabled route.
    status: pending
  - id: rehearse-limited-pilot
    content: Rehearse allowlist, caps, ledger, payment, download, isolation, refund, dispute, replay, partial-refund review, monitoring, and rollback in Stripe test mode on a production-like preview.
    status: pending
  - id: activate-one-charge-canary
    content: After a separate explicit real-funds approval, activate only the recorded live pilot scope, run one approved walletless card canary, and capture payment, access, ledger, no-protocol-receipt, and monitoring evidence.
    status: pending
  - id: close-or-expand-pilot
    content: Stop at the recorded end condition, reconcile every payment/refund/dispute/payout, disable new checkout, and require a new decision before any expansion.
    status: pending
isProject: true
---

# Stripe Limited Live Walletless-Purchase Pilot

## Goal

Run a deliberately small live-card pilot for signed-in Google/email buyers while keeping card
commerce visibly and technically separate from AgentVouch protocol settlement. The pilot must be
bounded by server-enforced buyer and skill scope, per-charge and aggregate exposure caps, durable
gross/fee/net accounting, a verified edge rate limit, versioned buyer acknowledgement, and an
immediate checkout kill switch.

This plan does **not** authorize a real card charge. Any live-key activation and the first real
payment remain real-funds actions requiring separate explicit human approval.

## Non-Negotiable Product Boundary

A card payment grants only an account-scoped off-chain marketplace access grant. It creates:

- no Solana purchase PDA, Base purchase id, x402 settlement, or protocol receipt;
- no protocol author proceeds or voucher rewards;
- no eligibility to open a bonded paid Report, trigger voucher slashing, or claim buyer credit;
- no protocol refund pool or on-chain buyer-recourse claim.

Card refunds and payment disputes are handled off-chain by the marketplace operator. Protocol USDC
remains the path for protocol-visible settlement and recourse.

## Current State (verified 2026-07-31)

- Production Google/email buyer authentication is live; buyer-card access and Stripe checkout are
  off.
- Account-scoped test-mode checkout, verified webhook grants, walletless download, full-refund /
  dispute revocation, replay safety, durable review outcomes, and the read-only operator monitor
  are implemented and previously smoke-tested.
- Live keys require `AGENTVOUCH_STRIPE_LIVE_MODE_ENABLED=true`. A key/event mode mismatch cannot
  grant access; refund and dispute events still revoke before that guard.
- This preparation slice adds a required, versioned card-recourse checkbox at every card button,
  binds acknowledgement to the current buyer/skill identity, and sends the accepted version in
  Checkout Session and PaymentIntent metadata. Matching public copy exists at
  `/docs#card-checkout-recourse` and `web/public/skill.md`. It is not production-verified until the
  dormant deploy/browser check completes.
- Live-key scope now requires non-empty server-only buyer-account and skill UUID allowlists plus
  positive unit, gross, completed-payment, concurrent-reservation, reservation-TTL, and
  fee/net-reconciliation-SLA values. Unlisted buyers/skills and over-cap reservations are rejected
  before Stripe is called.
- Live Checkout Session creation and live webhook fulfillment are now source-disabled regardless
  of environment values pending founder decisions, schema rehearsal, WAF proof, monitoring
  readiness, and explicit activation review. `stripe:ops preflight` reports that blocker and cannot
  go green for a live key. Every live key also requires the external-WAF acknowledgement, including
  on Vercel previews.
- Account refund/dispute handling now writes a payment-reference terminal marker under the same
  advisory lock used by grant creation. A terminal event without account/skill metadata still
  prevents a later completion event from granting access.
- The additive `stripe_live_pilot_payments` ledger, global advisory-lock reservation gate,
  immutable gross accounting, completed-payment slot and concurrency caps, Session expiration,
  payment/refund/dispute lifecycle, fee/net reconciliation, and read-only monitor are implemented
  locally but have not been rehearsed on a disposable production-copy database or deployed.
- Missing: verified Vercel WAF rule; founder merchant-of-record, payout, tax/KYC, support, refund,
  duration, expiry/SLA, and exposure decisions; production-like rehearsal and explicit activation
  review.
- `usdcMicrosToUsdCents` still applies `1 USDC ~= 1 USD`. That cannot silently become a live
  treasury policy.

## Design Decisions (2026-07-31)

- Live-pilot checkout is account-scoped only; the legacy wallet-bound Stripe path stays test-only.
- Live mode fails closed when its explicit scope is absent. A global feature flag is not a pilot
  boundary.
- Durable controls do not remove the source stop gate. Environment acknowledgements cannot replace
  founder decisions or external activation evidence.
- Gross capacity is deliberately conservative and immutable: failed, expired, refunded, and
  disputed reservations do not restore aggregate gross capacity. Every concurrently payable
  Session also reserves a completed-payment slot, preventing later completion from exceeding the
  cap.
- Checkout TTL is 31–1440 minutes. One exact timestamp is stored in the reservation and sent to
  Stripe, but local time only makes any unpaid reservation stale for monitoring. Every unpaid
  `reserved`, `session-created`, or `review` row keeps its payable/completed-payment slot until an
  explicit DB terminal transition; a created Session normally converges through a signed paid or
  `checkout.session.expired` event.
- Recourse acknowledgement is versioned and payment-bound through Stripe metadata. Refund and
  dispute revocation stays earlier than all grant guards so a bad configuration cannot leave access
  active.
- No code or document may fill merchant-of-record, payout, tax/KYC, price, volume, or support
  decisions on the founder's behalf.

## Scope

### In scope

- Walletless account-scoped checkout only for the explicitly recorded pilot buyers and skills.
- One-time USD Stripe Checkout with the existing off-chain access-grant seam.
- Versioned buyer acknowledgement and customer-facing recourse copy.
- Server-enforced unit, payment-count, and aggregate gross-volume caps.
- Durable per-payment gross amount, Stripe fee, net amount, refund/dispute, access, and
  reconciliation state.
- External Vercel WAF proof, Stripe webhook monitoring, incident ownership, and reversible flag
  rollout.

### Out of scope

- Base mainnet enablement or any change to the intentional `eip155:8453` rejection.
- Fiat-to-USDC conversion, on-chain settlement, protocol receipts, author proceeds, voucher yield,
  paid Reports, voucher slashing, or buyer credit for card payments.
- Stripe Connect, automated author payouts, or any payout before the founder chooses a model.
- Legal, tax, KYC, sanctions, geographic, reserve, or merchant-of-record conclusions inferred by
  code or by this plan.
- Broad production availability, legacy live wallet-bound checkout, unallowlisted buyers/listings,
  subscriptions, coupons, multiple currencies, or stored-card billing.

## Required Founder And External Decisions

Every `REQUIRED` value must be replaced by a dated decision, named owner, and evidence link before
`record-founder-decisions` can complete. Do not infer values from test-mode behavior.

| Decision                                                                                                                             | Recorded value                                                                  | Owner / approver | Evidence     | Status |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ---------------- | ------------ | ------ |
| Graduation model                                                                                                                     | Limited early-sales rail is the proposed scope; founder acceptance **REQUIRED** | **REQUIRED**     | **REQUIRED** | open   |
| Merchant of record / legal seller identity shown on site, Checkout, receipt, and support surfaces                                    | **REQUIRED**                                                                    | **REQUIRED**     | **REQUIRED** | open   |
| Customer support name, channel, hours/SLA, refund policy, and card-statement descriptor                                              | **REQUIRED**                                                                    | **REQUIRED**     | **REQUIRED** | open   |
| Eligible author/listing criteria, exact skill UUID allowlist, and author consent                                                     | **REQUIRED**                                                                    | **REQUIRED**     | **REQUIRED** | open   |
| Exact opaque buyer-account allowlist and invitation/revocation owner                                                                 | **REQUIRED**                                                                    | **REQUIRED**     | **REQUIRED** | open   |
| Maximum unit charge in USD cents                                                                                                     | **REQUIRED — do not invent**                                                    | **REQUIRED**     | **REQUIRED** | open   |
| Aggregate gross pilot cap in USD cents and whether refunds ever restore capacity                                                     | **REQUIRED — safest behavior is no automatic restoration until decided**        | **REQUIRED**     | **REQUIRED** | open   |
| Maximum completed payments and maximum concurrent reserved sessions                                                                  | **REQUIRED — do not invent**                                                    | **REQUIRED**     | **REQUIRED** | open   |
| Pilot start, end date/duration, and mandatory stop condition                                                                         | **REQUIRED**                                                                    | **REQUIRED**     | **REQUIRED** | open   |
| `1 USDC ~= 1 USD` pricing assumption: accept for this pilot or replace                                                               | **REQUIRED**                                                                    | **REQUIRED**     | **REQUIRED** | open   |
| Author payout model (Connect, manual, fiat-to-USDC, or no pilot payout), fee treatment, timing, reserve, and reversal responsibility | **REQUIRED**                                                                    | **REQUIRED**     | **REQUIRED** | open   |
| Tax/KYC/accounting/sanctions/geography position and qualified external reviewer, if required                                         | **REQUIRED**                                                                    | **REQUIRED**     | **REQUIRED** | open   |
| Full/partial refund owner, chargeback owner, dispute-won reinstatement owner, and response SLA                                       | **REQUIRED**                                                                    | **REQUIRED**     | **REQUIRED** | open   |
| WAF path/method condition, threshold, window, action, Log observation window, rule id, and publish evidence                          | **REQUIRED — do not invent**                                                    | **REQUIRED**     | **REQUIRED** | open   |
| Webhook/reconciliation on-call owner and checkout kill authority                                                                     | **REQUIRED**                                                                    | **REQUIRED**     | **REQUIRED** | open   |
| Real-card canary buyer, skill, charge, success criteria, and refund/no-refund choice                                                 | **REQUIRED**                                                                    | **REQUIRED**     | **REQUIRED** | open   |

Stripe's marketplace guidance says merchant-of-record identity, funds control, customer disclosure,
loss responsibility, payouts, and tax/KYC obligations depend on the selected model. Record a real
decision; do not treat these sources or this plan as legal/tax advice:

- <https://docs.stripe.com/connect/merchant-of-record>
- <https://docs.stripe.com/connect/saas-platforms-and-marketplaces>
- <https://docs.stripe.com/tax/connect>

## Files And Implementation Work

### Implemented in source (still dormant)

- `web/lib/stripePolicyCopy.ts`: versioned shared buyer-recourse disclosure.
- `web/app/skills/[id]/SkillDetailClient.tsx`: required checkbox at the Pay-by-Card decision point;
  binds consent to the current buyer session/wallet plus skill and sends the accepted version.
- `web/app/docs/page.tsx` and `web/public/skill.md`: public recourse boundary.
- `web/lib/stripe.ts`: parses the complete live-only buyer/skill/cap/TTL/SLA scope; carries the
  reservation as Stripe idempotency and Session/PaymentIntent metadata; supports best-effort
  Session expiration and authoritative balance-transaction fee/net reads.
- `web/lib/stripeLivePilotPolicy.ts` and `web/lib/stripeLivePilot.ts`: pure cap decisions plus an
  additive new-table ledger with immutable reservation facts, a global transaction advisory lock,
  lifecycle convergence, and read-only aggregate monitoring.
- `web/app/api/stripe/checkout/route.ts`: requires the current disclosure version, account-scoped
  live checkout, allowlisted skill, and under-ceiling amount before calling Stripe.
- `web/app/api/stripe/webhook/route.ts` and `web/lib/buyerAccessGrants.ts`: all live fulfillment is
  source-disabled; refund/dispute revocation remains earlier and records an atomic payment-reference
  terminal marker even when buyer metadata is absent.
- `web/scripts/stripe-limited-preview-ops.ts`: reports missing scope/activation gates and read-only
  gross, paid, refunded, fee, net, remaining-cap, stale, missing-financial, and review state.

### 2026-07-31 implementation divergence

The implementation uses additive, race-tolerant runtime `CREATE TABLE IF NOT EXISTS` for one new
table instead of adding a migration that could target the wrong live database. No existing table,
constraint, or row is changed. The initial empty-table definition has a reservation UUID primary
key, inline unique Checkout Session and PaymentIntent references, positive/nonnegative amount
checks, and an allowed-status check; it performs no runtime `ALTER` or index creation over live
data. Stripe idempotency plus the global advisory lock and immutable-match predicates provide the
transaction boundary. This must still be rehearsed against a disposable branch copied from the
intended `agentvouch-postgres` project.

### Completed code controls

1. Add `AGENTVOUCH_STRIPE_LIVE_PILOT_BUYER_ACCOUNT_IDS` to the server-only live scope parser. Require
   a non-empty canonical UUID set for live mode; reject a non-member before Stripe session creation.
   Expose only `eligible: true|false` to the client so raw account UUIDs never become a public env.
2. Bootstrap the new table additively at the first live-pilot reservation; the read-only monitor
   treats a missing table as an uninitialized state and never runs DDL.
3. Create `stripe_live_pilot_payments` with an immutable reservation UUID; buyer account, skill,
   disclosure version, Checkout Session and PaymentIntent references; amount USD cents; Stripe fee
   and net USD cents (nullable until reconciled); status; refund/dispute totals; timestamps; and
   lifecycle fields. Do not put email or raw Stripe payloads in this table.
4. Before calling Stripe, acquire one global pilot advisory lock, count/sum all reserved and
   completed rows according to the founder's recorded cap semantics, reserve the exact amount, and
   reject when the payment-count, concurrent-session, or aggregate gross cap would be exceeded.
   Session creation uses the reservation UUID as Stripe idempotency key and metadata. A Stripe API
   failure closes the reservation without reopening already consumed gross capacity unless the
   recorded policy explicitly allows it.
5. Subscribe to and handle `checkout.session.expired` so a never-paid reservation reaches a durable
   terminal state. Record the founder-approved Session expiry; do not invent it.
6. On paid webhook, atomically bind PaymentIntent and mark the reservation paid before granting
   access. Webhook replay must not double-count. Access-grant failure marks review without losing
   the financial row.
7. Capture gross immediately. Reconcile Stripe fee/net from Stripe's authoritative balance
   transaction into the same row without making buyer access depend on a transient fee lookup.
   Missing fee/net after the recorded SLA is a monitor alert and expansion blocker.
8. Full refund/dispute updates both grant state and ledger. Partial refund stays review-required.
   Dispute-won reinstatement remains manual until a separately tested operator action exists.
9. Extend `stripe:ops` to report reserved, paid, refunded, disputed, gross, fees, net, remaining
   founder cap, stale reservations, missing fee/net, and open review items without printing secrets
   or mutating state.
10. Add behavioral tests for missing/invalid buyer and skill allowlists, unit/payment/GMV caps,
    concurrent reservation attempts, Stripe failure, paid replay, grant failure, expiry, full and
    partial refunds, dispute/reinstatement posture, and operator output.

### Remaining activation work

- Rehearse additive bootstrap, caps, lifecycle, reconciliation, monitor, and rollback against a
  disposable copy of the intended production database.
- Complete every founder decision and external gate in this plan, including exact scope values,
  WAF proof, merchant-of-record/tax/payout/support ownership, and monitoring/on-call evidence.
- Keep the source stop gate false until that evidence is reviewed in a separate activation change.

## External Vercel WAF Gate

Create a Vercel WAF rate-limit rule conditioned on exact path `/api/stripe/checkout` and method
`POST`. Follow Vercel's documented workflow: start in Log, inspect Firewall traffic grouped by the
rule, select the founder-approved action and thresholds, review the change, and publish it. Record
rule id, condition, threshold, window, action, observation evidence, publisher, and timestamp.
Only after that proof may `AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY=true` be set.

Reference: <https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting>.

The route's in-memory IP/account limits remain defense in depth; they are per instance and do not
satisfy this gate.

## Verification

Use the repository Node release for every web command:

```bash
. "$HOME/.nvm/nvm.sh" --no-use && { nvm use --silent || nvm install; }
npm run format:check
npm run lint --workspace @agentvouch/web
npm run typecheck --workspace @agentvouch/web
npm run test --workspace @agentvouch/web
npm exec --workspace @agentvouch/web -- next build --webpack
```

Focused preparation checks:

```bash
npm run test --workspace @agentvouch/web -- __tests__/lib/stripe.test.ts __tests__/lib/stripePolicyCopy.test.ts __tests__/api/stripe-routes.test.ts __tests__/app/skill-detail-source.test.ts __tests__/app/docs-page-source.test.ts __tests__/scripts/stripe-limited-preview-ops.test.ts
npm run stripe:ops --workspace @agentvouch/web -- preflight
npm run stripe:ops --workspace @agentvouch/web -- monitor
```

Behavioral acceptance requires evidence that:

1. Missing any live acknowledgement, skill/buyer allowlist, unit/payment/GMV cap, WAF proof, DB
   schema, or disclosure version prevents Checkout Session creation.
2. Unallowlisted buyer/skill and over-cap amount are rejected before Stripe is called.
3. One allowlisted Google/email buyer pays in test mode and downloads; anonymous, different-account,
   and unallowlisted-account requests receive no access.
4. Exactly one account grant and one pilot ledger row exist; no protocol receipt, wallet
   entitlement, Base purchase id, Solana purchase PDA, x402 settlement, author proceeds, voucher
   reward, paid Report eligibility, or buyer credit exists.
5. Paid webhook replay does not add volume or restore a revoked grant.
6. Full refund and dispute creation revoke access; partial refund enters durable review; fee/net and
   refund/dispute deltas reconcile to Stripe.
7. The card checkbox appears before the button, the button stays disabled until acknowledged, and
   the current version is present in Stripe metadata and the ledger.
8. Setting the server and public checkout/card flags false stops new sessions while webhook
   refunds, disputes, delayed payments, and reconciliation continue.

### Local implementation verification (2026-08-01)

- Focused Stripe/ledger/operator suite: 5 files, 76 tests passed.
- Full web Vitest suite: 125 files, 886 tests passed.
- Web typecheck, ESLint, repository Prettier check, and `git diff --check`: passed.
- After replacing the unreconciled copied dependency tree with a canonical clean lockfile install,
  the Next.js 16.1.6 webpack production build completed successfully; the existing `ox`
  dynamic-dependency warning remained. No dependency or lockfile change was required.
- Not run: any live/test Stripe API call, card charge, deployment, Vercel/Stripe environment
  change, production database DDL, disposable-Neon rehearsal, WAF configuration, browser smoke, or
  real webhook. The source readiness constant remains `false`, so no environment combination can
  activate live Checkout Session creation or fulfillment from this change.

## Rollout

1. Merge and deploy code/docs with all Stripe checkout and buyer-card flags false. Verify the
   production card route returns disabled and no card control renders. Browser-check the new public
   docs independently.
2. Complete founder decisions and external reviews. Rehearse the buyer allowlist, ledger, atomic
   caps, and monitor on a disposable Neon branch.
3. Run the full Stripe test-mode matrix on a production-like preview, including WAF Log evidence,
   cap exhaustion, rollback, and post-rollback refund/dispute delivery.
4. Publish the founder-approved WAF enforcement rule; verify production Firewall traffic and record
   evidence. Do not set the acknowledgement early.
5. Configure live Stripe API/webhook credentials and required event subscriptions with checkout
   flags still false. Confirm mode names and endpoint status without printing secrets.
6. Populate exact server-only pilot allowlists/caps and run preflight/monitor. Every blocker and
   review item must be zero.
7. Obtain a dated **GO: one real walletless card canary** naming buyer, skill, amount, operator,
   rollback owner, and whether the test ends with a refund. This approval cannot be inferred from
   approval to merge the plan.
8. Enable only the live-pilot server/public flags and acknowledgement, redeploy the exact reviewed
   commit, and run the one charge. Stop immediately after the recorded canary or cap.
9. Verify Stripe, DB grant, pilot ledger, raw download, no-protocol-state invariants, WAF traffic,
   webhook delivery, and monitor output. Observe for the founder-recorded period before any second
   payment.

## Rollback

1. Set `AGENTVOUCH_STRIPE_CHECKOUT_ENABLED=false` and
   `NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED=false`; redeploy. Keep buyer authentication and the two
   buyer-card-access flags enabled so already-paid account buyers can still redeem valid grants.
   Disable access flags only for a separate access/authentication incident.
2. Keep Stripe credentials, the webhook endpoint, pilot ledger, terminal payment markers, access grants, and reconciliation
   records intact so paid/delayed/refund/dispute events converge. Never delete financial history to
   roll back checkout.
3. Keep the published WAF rule enforced unless it is itself causing the incident; any WAF rollback
   requires recorded reason and replacement protection.
4. Reconcile every reserved/paid/refunded/disputed payment and execute refunds or support actions
   only under the founder-approved policy. Do not invent a payout or refund during incident response.

## Stop Conditions

- Any required founder decision is blank, ambiguous, or lacks a named owner/evidence.
- Merchant-of-record/customer-facing seller identity or payout/tax/KYC responsibility is unresolved.
- Card copy is not deployed exactly at the decision point or the accepted version is absent from
  live Stripe metadata.
- Live scope, buyer/skill allowlist, unit cap, payment cap, aggregate cap, ledger, or migration
  preflight is absent/failing.
- The external WAF rule is not reviewed, published, enforced, and evidenced.
- `stripe:ops preflight` or `monitor` is non-zero; any `needs-review` item is open; webhook delivery
  or Clerk auth/lifecycle monitoring is degraded.
- Partial-refund/dispute-won handling has no available owner during the pilot window.
- The production database cannot be independently matched to Vercel-managed
  `agentvouch-postgres`.
- Any implementation would treat card access as protocol settlement or enable Base mainnet.
- No separately recorded real-funds GO exists for the exact canary.

## Evidence Record Template

- Reviewed commit and deployment id/URL:
- Production database project/branch/host (no credentials):
- Stripe mode, webhook endpoint id, subscribed event types (no secrets):
- WAF rule id/condition/threshold/window/action/publish evidence:
- Founder decision record link/date/approvers:
- Pilot buyer account and skill UUID allowlists (store securely; do not publish raw account ids):
- Unit/payment/GMV caps and remaining capacity:
- Checkout Session, PaymentIntent, Charge, balance transaction, refund/dispute ids:
- Gross, Stripe fee, net, refund/dispute amounts:
- Access-grant and pilot-ledger rows:
- Proof of no protocol receipt/economic state:
- Download success and anonymous/different-account rejection:
- Preflight/monitor output and observation timestamps:
- Rollback drill or execution evidence:
