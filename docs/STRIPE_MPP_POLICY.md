# Stripe MPP Policy (WIP)

Status: WIP. This policy describes the temporary Stripe marketplace-operator
path for selling paid skills before every purchase settles through the
AgentVouch on-chain economics.

## Scope

Stripe checkout is an off-chain marketplace purchase path. It can unlock paid
skill content for a buyer wallet by writing an AgentVouch entitlement after a
verified Stripe payment. It does not create a Solana `Purchase` PDA, fund
author proceeds escrow, fund voucher rewards, or create protocol refund state.

The current implementation is wallet-bound: the buyer signs a checkout message
before Stripe session creation, and the webhook records the entitlement against
that wallet pubkey.

## Activation Gates

Do not enable Stripe checkout unless all of the following are true:

- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are configured together.
- Webhook delivery is monitored and failed webhook retries are visible.
- Operators can reconcile Stripe payment ids against
  `usdc_purchase_receipts.payment_tx_signature`.
- Product copy clearly labels this as card checkout / off-chain entitlement,
  not protocol settlement.
- Refund, chargeback, and payout responsibilities below are accepted.

## Buyer Access

Card checkout grants access only to the wallet that signed the checkout
message. Re-downloads use the existing `X-AgentVouch-Auth` raw download flow.

Email-only buyers remain out of scope until there is an identity link table or
customer session model that can map Stripe customers to an AgentVouch buyer key.

## Payouts

Until Stripe Connect or an explicit treasury payout process exists, Stripe
revenue should be treated as marketplace-operator custody. Authors should not
see Stripe sales as withdrawable on-chain proceeds.

Temporary payout policy:

- Track gross amount, Stripe fees, refunds, disputes, and net amount per sale.
- Pay authors off-chain only after the payment is no longer in a high-risk
  window for immediate reversal.
- Keep voucher rewards at `0` for Stripe MPP sales unless and until a funded
  on-chain or off-chain voucher accounting design is approved.
- Do not represent Stripe MPP sales as backing the protocol 60/40 split.

## Refunds And Chargebacks

Stripe refunds and chargebacks are off-chain events and must not imply a
Solana refund pool exists.

Minimum handling before production:

- Listen for `charge.refunded`, `charge.dispute.created`, and relevant Checkout
  or PaymentIntent failure events.
- Mark affected entitlements as suspended or revoked once entitlement status
  fields exist.
- Maintain an operator reconciliation queue for paid-but-not-entitled and
  refunded-but-still-entitled cases.
- Make support copy explicit that card refunds are handled by the marketplace
  operator, while protocol-listed USDC purchases use on-chain dispute/refund
  rules.

## Reporting

Stripe MPP receipts should remain visibly distinct from protocol purchases:

- `payment_flow = "stripe-mpp-offchain"`
- `currency_mint = "USD"`
- `recipient_ata = "stripe-offchain"`
- `purchase_pda`, `settlement_pda`, and voucher reward fields remain null.

Metrics and activity feeds should avoid mixing Stripe MPP sales into on-chain
voucher yield, author proceeds escrow, or dispute recovery statistics.

## Production Blockers

Before treating Stripe MPP as production-ready, resolve:

- Refund and chargeback webhook handling.
- Entitlement suspension/revocation schema and UI copy.
- Author payout process, including tax/KYC responsibilities.
- Operator reconciliation dashboard or runbook.
- Rate limits and abuse monitoring on checkout/session creation.
- Public documentation that separates card checkout from protocol settlement.
