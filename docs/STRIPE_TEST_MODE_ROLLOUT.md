# Stripe Test-Mode Rollout Checklist (WIP)

Status: WIP. This checklist is for enabling Stripe checkout in test mode only.
It does not make Stripe production-ready and does not convert Stripe sales into
protocol-visible purchases.

## Scope

Stripe test-mode checkout may grant a wallet-bound off-chain entitlement after a
verified test payment. The entitlement uses `payment_flow =
"stripe-mpp-offchain"` and must stay separate from Solana/Base/x402 protocol
purchase state.

## Preconditions

- `STRIPE_SECRET_KEY` uses a test-mode key.
- `STRIPE_WEBHOOK_SECRET` is configured from the matching test-mode webhook
  endpoint.
- `AGENTVOUCH_STRIPE_CHECKOUT_ENABLED=true` enables session creation on the
  test deployment. Leave the webhook configured when this flag is later turned
  off so outstanding refunds/disputes still process.
- `NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED=true` is set for the same deployment.
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
2. Connect an AgentVouch-compatible wallet that can sign messages.
3. Click `Pay by Card`.
4. Confirm the checkout session uses the listed price converted to USD cents.
5. Pay with a Stripe test card.
6. Verify webhook delivery for `checkout.session.completed`.
7. Confirm `usdc_purchase_receipts.payment_tx_signature` is
   `stripe:{payment_intent}`.
8. Confirm `usdc_purchase_entitlements` has the signed wallet as buyer.
9. Return to the skill page and verify `Sign & Download` works for that wallet.
10. Verify another wallet cannot redeem the entitlement.

## Negative Tests

- Missing `STRIPE_SECRET_KEY` or missing `STRIPE_WEBHOOK_SECRET` returns 501.
- Missing `AGENTVOUCH_STRIPE_CHECKOUT_ENABLED=true` returns 501 for checkout
  creation without disabling webhook processing.
- Checkout without wallet auth returns 401.
- Checkout auth signed for a different skill is rejected.
- Webhook with an invalid Stripe signature is rejected.
- Webhook with non-USD currency is acked with an `ignored` reason and does not
  grant entitlement.
- Webhook with amount mismatch is acked with an `ignored` reason (so Stripe
  stops retrying) and does not grant entitlement; the reason is persisted in
  `stripe_webhook_outcomes` for operator reconciliation.
- Duplicate webhook delivery is idempotent. A second captured payment is kept
  as an append-only receipt for reconciliation without overwriting the existing
  entitlement provenance.
- Checkout returns 409 when the signed wallet already has a database
  entitlement or linked Solana purchase.
- Checkout for a price below $0.50 returns 400 before any Stripe call.
- Checkout for a Base protocol listing returns 409 (card entitlements are not
  redeemable on the Base download gate yet).
- Refunding the test payment in the Stripe Dashboard revokes the entitlement:
  `Sign & Download` stops working and `usdc_purchase_entitlements.revoked_at`
  is set with `revoked_reason = 'stripe-refund'`.
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

- Dashboard payment id matches `payment_tx_signature`.
- Stripe amount, metadata `price_usdc_micros`, and DB `amount_micros` match.
- `payment_flow` is exactly `stripe-mpp-offchain`.
- `currency_mint` is `USD`.
- `recipient_ata` is `stripe-offchain`.
- `purchase_pda`, `settlement_pda`, and x402 settlement fields are null.

## Base/Chain-Aware Identity Gate

Before enabling Stripe for Base-heavy flows, choose the identity model:

1. Keep Stripe checkout AgentVouch-wallet-bound and require signed
   `X-AgentVouch-Auth` for re-downloads.
2. Extend Stripe receipts to always set chain-qualified buyer fields, including
   `buyer_chain_context` and `buyer_address`.
3. Add a Stripe customer/email identity model and a redeem/link flow.

Until this is decided, Stripe should be presented as card checkout for a signed
AgentVouch wallet, not a Base-native protocol purchase.

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
- At least one successful wallet-bound paid download has been verified from the
  returned skill page.
- Product copy labels the path as card checkout / off-chain entitlement.
- Metrics exclude Stripe MPP receipts from protocol purchase, voucher yield,
  author proceeds, and dispute recovery totals.
- Production is still blocked until the Vercel Firewall/WAF rule is verified
  and `AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY=true` is explicitly set.
