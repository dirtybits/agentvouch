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
- `AGENTVOUCH_PUBLIC_BASE_URL` points at the preview or local tunnel that Stripe
  redirects back to.
- Checkout is disabled unless both Stripe secrets are present.
- Operators can access Stripe Dashboard test events and Vercel/API logs for the
  checkout and webhook routes.

## Happy-Path Test

1. Pick a paid skill with `price_usdc_micros > 0`.
2. Connect an AgentVouch-compatible wallet that can sign messages.
3. Click `Pay by Card`.
4. Confirm the checkout session uses the listed price converted to USD cents.
5. Pay with a Stripe test card.
6. Verify webhook delivery for `checkout.session.completed`.
7. Confirm `usdc_purchase_receipts.payment_tx_signature` is
   `stripe:{payment_intent_or_session}`.
8. Confirm `usdc_purchase_entitlements` has the signed wallet as buyer.
9. Return to the skill page and verify `Sign & Download` works for that wallet.
10. Verify another wallet cannot redeem the entitlement.

## Negative Tests

- Missing `STRIPE_SECRET_KEY` or missing `STRIPE_WEBHOOK_SECRET` returns 501.
- Checkout without wallet auth returns 401.
- Checkout auth signed for a different skill is rejected.
- Webhook with an invalid Stripe signature is rejected.
- Webhook with non-USD currency is acked with an `ignored` reason and does not
  grant entitlement.
- Webhook with amount mismatch is acked with an `ignored` reason (so Stripe
  stops retrying) and does not grant entitlement; the reason is logged for the
  reconciliation queue.
- Duplicate webhook delivery is idempotent, acks `alreadyEntitled`, and does
  not create duplicate access or overwrite an existing entitlement.
- Checkout for a price below $0.50 returns 400 before any Stripe call.
- Checkout for a Base protocol listing returns 409 (card entitlements are not
  redeemable on the Base download gate yet).
- Cancelled checkout returns to the skill page without entitlement.

## Reconciliation Checks

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

- Refund and chargeback webhook handling.
- Entitlement suspension/revocation status fields.
- Operator reconciliation queue for paid-but-not-entitled and
  refunded-but-still-entitled cases.
- Author payout policy: Stripe Connect, manual operator payout, or fiat -> USDC
  protocol settlement.
- Public support copy that separates card refunds from protocol disputes/refunds.
- Abuse controls on checkout/session creation.
- Monitoring for webhook failures and entitlement-write failures.

## Exit Criteria

Test-mode Stripe can move from prototype to limited preview only when:

- Happy-path and negative tests above are complete.
- At least one successful wallet-bound paid download has been verified from the
  returned skill page.
- Product copy labels the path as card checkout / off-chain entitlement.
- Metrics exclude Stripe MPP receipts from protocol purchase, voucher yield,
  author proceeds, and dispute recovery totals.
