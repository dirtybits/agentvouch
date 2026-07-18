# Stripe Test-Mode Rollout Checklist (WIP)

Status: WIP. This checklist is for enabling Stripe checkout in test mode only.
It does not make Stripe production-ready and does not convert Stripe sales into
protocol-visible purchases.

## Scope

Stripe test-mode checkout may grant either a legacy wallet-bound entitlement or
an account-scoped marketplace access grant after a verified test payment. The
wallet path uses `payment_flow = "stripe-mpp-offchain"`. The account path writes
`marketplace_access_grants` and deliberately writes no protocol purchase receipt
or wallet entitlement. Both paths stay separate from Solana/Base/x402 protocol
purchase state.

## Preconditions

- `STRIPE_SECRET_KEY` uses a test-mode key.
- `STRIPE_WEBHOOK_SECRET` is configured from the matching test-mode webhook
  endpoint.
- `AGENTVOUCH_STRIPE_CHECKOUT_ENABLED=true` enables session creation on the
  test deployment. Leave the webhook configured when this flag is later turned
  off so outstanding refunds/disputes still process.
- `NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED=true` is set for the same deployment.
- Account-scoped checkout additionally requires
  `AGENTVOUCH_BUYER_CARD_ACCESS_ENABLED=true` and
  `NEXT_PUBLIC_AGENTVOUCH_BUYER_CARD_ACCESS_ENABLED=true`. Buyer authentication
  remains separately gated.
- `AGENTVOUCH_PUBLIC_BASE_URL` points at the preview or local tunnel that Stripe
  redirects back to.
- Checkout is disabled unless both Stripe secrets are present.
- The Stripe webhook endpoint is subscribed to `checkout.session.completed`,
  `checkout.session.async_payment_succeeded`, `charge.refunded`, and
  `charge.dispute.created`.
- Operators can access Stripe Dashboard test events and Vercel/API logs for the
  checkout and webhook routes.
- `npm run stripe:ops --workspace @agentvouch/web -- preflight` passes in the
  deployment environment.

## Happy-Path Test

1. Pick a paid skill with `price_usdc_micros > 0`.
2. Sign in with Google or a passwordless email code. A wallet is optional for
   the account-scoped path.
3. Click `Pay by Card`.
4. Confirm the checkout session uses the listed price converted to USD cents.
5. Pay with a Stripe test card.
6. Verify webhook delivery for `checkout.session.completed`.
7. Confirm one active `marketplace_access_grants` row exists for the opaque
   buyer account, skill UUID, and Stripe PaymentIntent reference.
8. Confirm no `usdc_purchase_receipts` or `usdc_purchase_entitlements` row was
   created for the account-scoped payment.
9. Return to the skill page and verify the signed-in account can download
   without connecting or signing with a wallet.
10. Verify an anonymous request and a different signed-in account receive 402.

Repeat the legacy wallet path separately when changing compatibility-sensitive
checkout code: connect a signing wallet, complete checkout, confirm the
`stripe:{payment_intent}` receipt/entitlement pair, and re-download with signed
`X-AgentVouch-Auth`.

## Negative Tests

- Missing `STRIPE_SECRET_KEY` or missing `STRIPE_WEBHOOK_SECRET` returns 501.
- Missing `AGENTVOUCH_STRIPE_CHECKOUT_ENABLED=true` returns 501 for checkout
  creation without disabling webhook processing.
- Account checkout without an authenticated buyer session returns 401. Legacy
  wallet checkout without valid wallet auth also returns 401.
- Legacy checkout auth signed for a different skill is rejected.
- Webhook with an invalid Stripe signature is rejected.
- Webhook with non-USD currency is acked with an `ignored` reason and does not
  grant entitlement.
- Webhook with amount mismatch is acked with an `ignored` reason (so Stripe
  stops retrying) and does not grant entitlement; the reason is persisted in
  `stripe_webhook_outcomes` for operator reconciliation.
- Duplicate account-grant webhook delivery is idempotent. Legacy wallet
  payments retain append-only receipt behavior.
- Checkout returns 409 when the authenticated account already has an active
  grant. The legacy path retains its wallet entitlement/purchase duplicate
  checks.
- Checkout for a price below $0.50 returns 400 before any Stripe call.
- Account checkout may unlock a Base Sepolia listing through an off-chain
  marketplace grant. This is not a Base purchase and does not enable Base
  mainnet. Legacy wallet checkout for a Base protocol listing still returns 409.
- Refunding the test account payment in Stripe revokes the access grant:
  download stops working and `marketplace_access_grants.revoked_at` is set with
  `revoked_reason = 'stripe-refund'`. Legacy wallet checkout continues to revoke
  `usdc_purchase_entitlements`.
- A replayed `checkout.session.completed` for the refunded payment does not
  restore access; paying again with a new checkout session does.
- Cancelled checkout returns to the skill page without entitlement.

## Reconciliation Checks

Run the read-only monitor in the same environment as the intended database:

```bash
npm run stripe:ops --workspace @agentvouch/web -- monitor
```

It exits non-zero for activation blockers or unresolved review items. Resolve
items only after comparing the Stripe event/payment id with the receipt,
entitlement, refund/revocation marker, and expected policy; the monitor never
mutates Stripe or database state.

- Account flow: Dashboard PaymentIntent matches
  `marketplace_access_grants.source_payment_reference`; Checkout Session and
  PaymentIntent metadata carry the same opaque account id, skill UUID, amount,
  currency, and account-flow marker.
- Account flow: there is no wallet receipt, entitlement, purchase PDA,
  settlement PDA, Base purchase id, or x402 settlement row.
- Legacy wallet flow: Dashboard payment id matches `payment_tx_signature`, the
  amount fields match, `payment_flow` is `stripe-mpp-offchain`, currency is
  `USD`, recipient is `stripe-offchain`, and protocol settlement fields are
  null.

## Base/Chain-Aware Identity Boundary

The selected walletless model uses an opaque, chain-neutral buyer account with
verified Google/email identity links and optional independently proven Solana or
Base wallet links. Stripe customer ids, email addresses, and account UUIDs are
never synthesized into wallet addresses. A Base Sepolia card sale grants only
off-chain marketplace access to that account; it is not a Base-native protocol
purchase. Base mainnet remains blocked by the independent mainnet gate.

## Production Blockers

- Partial-refund and dispute-won reconciliation (full-refund/dispute revocation is handled).
- Entitlement suspension/revocation status fields.
- Richer operator dashboard and resolution workflow. The limited-preview
  baseline now persists review items and exposes the read-only monitor.
- Author payout policy: Stripe Connect, manual operator payout, or fiat -> USDC
  protocol settlement.
- Public support copy that separates card refunds from protocol disputes/refunds.
- Verified external Vercel Firewall/WAF rule on checkout/session creation. The
  route-level per-instance limiter is defense in depth only.
- Monitoring for webhook failures and entitlement-write failures. The durable
  queue covers webhook events the app received; Stripe Dashboard delivery
  failures remain a separate operator alert/source of truth.

## Exit Criteria

Test-mode Stripe can move from prototype to limited preview only when:

- Happy-path and negative tests above are complete.
- At least one successful account-scoped paid download and one legacy
  wallet-bound regression have been verified from the returned skill page.
- Product copy labels the path as card checkout / off-chain entitlement.
- Metrics exclude Stripe MPP receipts from protocol purchase, voucher yield,
  author proceeds, and dispute recovery totals.
- Production is still blocked until the Vercel Firewall/WAF rule is verified
  and `AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY=true` is explicitly set.
