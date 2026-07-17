---
name: stripe-limited-preview-walletless-base
overview: Harden the existing wallet-bound Stripe test path for a limited preview, then design walletless identity and Base-compatible card access without representing off-chain card sales as protocol purchases.
todos:
  - id: audit-current-stripe-path
    content: Verify the current checkout, webhook, refund, entitlement, Base rejection, auth, and operator-documentation behavior against repository truth.
    status: completed
  - id: harden-preview-activation
    content: Add an explicit server checkout flag, production edge-rate-limit acknowledgement, and best-effort route throttling without changing webhook availability.
    status: completed
  - id: persist-reconciliation
    content: Add an additive durable Stripe webhook outcome and operator-review queue for unprocessable fulfillment, partial refunds, and unmatched revocations.
    status: completed
  - id: add-read-only-ops-monitor
    content: Add a read-only preflight/monitor command that reports activation state and unresolved reconciliation items without mutating Stripe or database state.
    status: completed
  - id: specify-walletless-identity
    content: Specify the Google/email identity and account-linking model, including migration boundaries and recovery semantics, without implementing a core entitlement-key change in this PR.
    status: completed
  - id: specify-base-card-access
    content: Specify Base-compatible off-chain access grants that remain distinct from Base protocol receipts and do not enable Base mainnet.
    status: completed
  - id: verify-limited-preview
    content: Run focused tests and the full web quality gate, update policy/runbook documentation, and record any manual or live checks not performed.
    status: completed
  - id: handle-empty-monitor-bootstrap
    content: Make the read-only preview monitor report zero reconciliation items before the first webhook creates the additive table; verified live after deployment.
    status: completed
isProject: false
---

# Stripe Limited Preview, Walletless Identity, and Base Compatibility

## Goal

Move the existing Stripe test-mode prototype toward a deliberately limited preview by making activation explicit, preserving webhook events that need operator action, and providing a read-only operational check. In parallel, define the next identity and Base-access model so card buyers can eventually use AgentVouch without a browser wallet while card sales remain visibly separate from on-chain protocol settlement.

## Scope

### In scope

- Keep the existing wallet-signed Stripe checkout and refund/dispute revocation behavior.
- Require a server-only checkout activation flag in addition to Stripe credentials and the render-affecting public UI flag.
- Require an explicit production acknowledgement that a Vercel Firewall/WAF rate limit is installed; add the existing in-memory limiter only as defense in depth.
- Persist webhook outcomes that need review in an additive, idempotent database table; do not rely on logs as the queue.
- Add a read-only operator preflight/monitor command.
- Document the recommended walletless identity and Base-compatible access-grant model, including migration and rollout gates.
- Keep the stable Stripe test preview and production activation as separate operational decisions.

### Out of scope

- Enabling Stripe checkout on the production deployment.
- Enabling `eip155:8453`, changing the Phase 10 Base mainnet gate, or treating Base Sepolia proof as Base mainnet readiness.
- Converting fiat to USDC, settling a Stripe purchase on-chain, funding author/voucher economics, or representing Stripe receipts as Base/Solana purchase receipts.
- Adding an auth dependency, adopting a hosted auth vendor, or changing the entitlement primary key in this implementation pass.
- Automating author payouts, partial-refund policy decisions, or dispute-won reinstatement.
- Creating Vercel Firewall rules from code; the operator acknowledgement only prevents accidental production activation before the external rule exists.

## Current State (verified 2026-07-15)

- `web/app/api/stripe/checkout/route.ts` requires a wallet signature, rejects Base protocol listings, refuses duplicate access, and creates a Stripe Checkout Session for the listing price.
- `web/app/api/stripe/webhook/route.ts` verifies the raw-body Stripe signature, fulfills successful payments, revokes on full refund/dispute, and keeps replayed refunded payments revoked.
- Unprocessable webhook events and partial refunds are currently visible only in logs even though policy calls for a reconciliation queue.
- `web/lib/rateLimit.ts` is explicitly per-instance and cannot substitute for Vercel Firewall/WAF or a shared rate-limit store.
- Existing GitHub OAuth is a publisher/profile session, while Phantom embedded Google sign-in supplies an embedded Solana wallet. Neither is yet a chain-neutral buyer-account key for email-only card access.
- Base card checkout is intentionally rejected because Base downloads verify chain-qualified purchase state; minting a wallet-pubkey entitlement would charge for access the Base gate cannot redeem.

## Design Decisions

### 2026-07-15 — Keep checkout activation and webhook processing separate

Webhook processing must remain available whenever Stripe credentials and the webhook secret are configured so refunds, disputes, retries, and delayed payment events continue to be processed after checkout is disabled. Session creation gets a separate `AGENTVOUCH_STRIPE_CHECKOUT_ENABLED=true` server flag. Production additionally requires `AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY=true` as an explicit acknowledgement that the external Vercel rate limit exists.

### 2026-07-15 — Durable review queue, no raw payload storage

Persist event id/type, object id, payment reference, skill/buyer identifiers when available, outcome, reason, and small non-sensitive details. Do not store raw Stripe webhook payloads or customer email in the queue. Event id is the idempotency key; retries update occurrence and last-seen timestamps.

### 2026-07-15 — Walletless UX should use an account identity, not a fake wallet

The recommended durable model is a first-party buyer account plus linked identities (Google/email, GitHub, embedded wallets, Base addresses, Solana pubkeys). Access grants reference the account and may also carry a wallet/chain redemption binding. Do not synthesize Solana or EVM addresses from email, and do not overload the legacy `(skill_db_id, buyer_pubkey)` entitlement primary key without a guarded migration plan.

For the lowest-risk onboarding experiment before that migration, Phantom embedded Google sign-in can provide a walletless-looking Solana flow because the recoverable embedded wallet remains the actual buyer key. That is not a chain-neutral email entitlement and must not be described as one.

### 2026-07-15 — Base card access is an off-chain grant

A future Stripe card purchase for a Base-listed skill should create a chain-neutral marketplace access grant after verified payment. It must not create a Base purchase id, protocol receipt, author proceeds, voucher rewards, or dispute state. Base USDC/x402 remains the protocol purchase path. Implement and smoke this on Base Sepolia first; Base mainnet stays blocked by `docs/MAINNET_READINESS.md`.

## Implementation Files

- `web/lib/stripe.ts`: server activation predicate and documented environment gates.
- `web/app/api/stripe/checkout/route.ts`: server activation check and best-effort per-IP/per-wallet throttling.
- `web/lib/stripeReconciliation.ts`: additive schema, idempotent outcome writes, and read-only unresolved-item queries.
- `web/app/api/stripe/webhook/route.ts`: durable outcomes for fulfillment, revocation, unprocessable events, partial refunds, and unmatched revocations.
- `web/scripts/stripe-limited-preview-ops.ts`: read-only `preflight` and `monitor` modes.
- `web/package.json`: operator command only; no dependency changes.
- `web/__tests__/lib/stripe.test.ts`: activation-gate behavior.
- `web/__tests__/api/stripe-routes.test.ts`: rate limiting and durable webhook outcomes.
- `web/__tests__/lib/stripeReconciliation.test.ts`: alert and query-shape behavior.
- `web/__tests__/scripts/stripe-limited-preview-ops.test.ts`: read-only mode parsing and activation preflight.
- `docs/STRIPE_MPP_POLICY.md`, `docs/STRIPE_TEST_MODE_ROLLOUT.md`, and `docs/STRIPE_FEASIBILITY.md`: exact preview gates and walletless/Base decision record.

## Verification

Use Node 24 for every web command:

```bash
export PATH="$HOME/.nvm/versions/node/v24.1.0/bin:$PATH"
npm run format:check
npm run lint --workspace @agentvouch/web
npm run typecheck --workspace @agentvouch/web
npm run test --workspace @agentvouch/web
npm exec --workspace @agentvouch/web -- next build --webpack
```

Focused checks before the full gate:

```bash
npm run test --workspace @agentvouch/web -- __tests__/lib/stripe.test.ts __tests__/api/stripe-routes.test.ts __tests__/lib/stripeReconciliation.test.ts __tests__/scripts/stripe-limited-preview-ops.test.ts
npm run stripe:ops --workspace @agentvouch/web -- preflight
npm run stripe:ops --workspace @agentvouch/web -- monitor
```

`monitor` is read-only. A live monitor needs the intended deployment's `DATABASE_URL` and Stripe environment; local verification may cover parsing/alerts without querying production.

## Rollout

1. Merge code and documentation with checkout flags off.
2. Deploy a preview with test-mode Stripe keys, `AGENTVOUCH_STRIPE_CHECKOUT_ENABLED=true`, and `NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED=true`.
3. Repeat card payment, entitlement, second-wallet rejection, refund revocation, replay, partial-refund queue, and monitor checks in test mode.
4. Install and verify a Vercel Firewall/WAF rate limit for `POST /api/stripe/checkout`; only then set `AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY=true` on a production candidate.
5. Treat production activation, walletless identity migration, and Base card-access implementation as separately approved gates.

## Rollback

- Set `AGENTVOUCH_STRIPE_CHECKOUT_ENABLED=false` and `NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED=false`, then redeploy. Keep Stripe secrets and the webhook route active until all outstanding payments, refunds, disputes, and delayed events are settled.
- Do not delete reconciliation rows during rollback; resolve them with an operator note after investigation.
- If a preview deployment regresses, keep the previously verified stable preview alias and revert only this feature branch.

## Open Blockers

- Production author payout, tax/KYC, and custody policy is not approved.
- Partial-refund behavior and dispute-won reinstatement remain manual policy decisions.
- The walletless account/identity-link schema is a core identity change and needs a separately reviewed guarded migration plan.
- Base card access needs a new chain-neutral access-grant seam and browser/API regression tests; it must not weaken Base protocol purchase verification.
- The external Vercel Firewall/WAF rule must be created and verified before production checkout activation.

## Verification Results (2026-07-15)

- Focused Stripe/reconciliation suite: 4 files, 32 tests passed.
- Full web Vitest suite: 107 files, 717 tests passed.
- `npm run format:check`: passed.
- Web ESLint: passed.
- Web typecheck: passed.
- `npm exec --workspace @agentvouch/web -- next build --webpack`: passed. The build emitted the pre-existing `ox/tempo` dynamic-dependency warning and sandbox DNS fallback warnings for Neon/Helius during static generation; page generation and build completion still succeeded.
- Read-only Stripe preflight command: passed with placeholder configured values and reported no secret values.
- Not run: live `monitor` against the preview/production database, webhook creation of the new additive table, Vercel Firewall rule verification, a new live Stripe payment, or any deployment. Those remain rollout checks, not local-code verification.

### 2026-07-16 live-preview divergence

The first branch-scoped preview monitor reached the intended database but failed because `stripe_webhook_outcomes` did not yet exist. The monitor deliberately avoids bootstrap DDL, so it must use a read-only `to_regclass` check and treat a missing table as an empty pre-first-event state. This follow-up does not change webhook schema creation or production activation.

## Live Preview Verification Results (2026-07-16)

- Signed commit `590efbe` deployed successfully as Vercel preview deployment `dpl_4GQ9FUKYq7m2jT543LdzLmjQpuzz`; the build used branch `ops/stripe-test-listing` and exact commit `590efbe`.
- The read-only monitor passed before and after the payment smoke with checkout enabled, zero blockers, zero open review items, and zero alerts. Vercel does not download branch-scoped sensitive values to local `env run`, so non-secret presence markers were supplied only for the monitor's boolean activation checks; live route probes separately proved the deployed server and webhook configuration.
- Stable preview alias `https://agentvouch-stripe-test-listing.vercel.app` now resolves to the verified deployment. Production was not promoted and production flags were not changed.
- Dedicated buyer `asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw` was denied raw access with `402` before payment, then completed Stripe test Checkout session `cs_test_a1FXhQqfS6rTcdaWg5TnODCP8FvZvl4JafYwY7x2qisD61p72V3jOa5JSn` for $1.00 using Stripe's successful interactive test card.
- Stripe reported payment intent `pi_3Tu4lNA2jEYsGvGP01cbtB2C` as paid. The append-only receipt matched `stripe:pi_3Tu4lNA2jEYsGvGP01cbtB2C`, `amount_micros=1000000`, `payment_flow=stripe-mpp-offchain`, `recipient_ata=stripe-offchain`, and `currency_mint=USD`; protocol purchase, settlement, EVM, and x402 fields remained null.
- The buyer's signed raw download changed from `402` to `200`, returned 349 bytes of Markdown, and matched the stored content SHA-256 `99dfd32607fe61c12aeea6ec1c3c59434ab450da5b16f86a93056fbe71cee148`.
- A duplicate checkout attempt returned `409` before creating another session, and an unrelated fresh wallet remained denied with `402`.
- Invalid-signature webhook and unauthenticated checkout probes returned `400` and `401` respectively. The exact deployment had no error-level Vercel logs during the smoke window.
- Full Stripe test refund `re_3Tu4lNA2jEYsGvGP0DKG17jv` succeeded for the same payment intent. The buyer's signed raw access returned from `200` to `402`, the entitlement recorded `revoked_reason=stripe-refund`, and the append-only receipt count remained exactly one.
- The post-refund read-only monitor still reported zero blockers, zero open review items, and zero alerts; the stable preview had no error-level Vercel logs during the revocation window.
