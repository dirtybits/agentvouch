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

## Rail Positioning

Stripe MPP is not the canonical AgentVouch settlement rail. Protocol-visible
paid purchases should prefer direct USDC `purchase_skill` or the
protocol-listed x402 bridge, because those paths can create purchase PDA state,
route author proceeds, fund voucher rewards, and preserve dispute/refund
semantics.

Base/USDC is the stronger agent-native path for smart-account, paymaster, and
EIP-3009 x402 UX, but it does not make Stripe a protocol ledger. Stripe remains
a human/card on-ramp and early-sales bridge unless and until a fiat -> USDC ->
on-chain settlement design is approved.

## Activation Gates

Do not enable Stripe checkout unless all of the following are true:

- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are configured together.
- `AGENTVOUCH_STRIPE_CHECKOUT_ENABLED=true` is set only on deployments where
  new Checkout Sessions should be created. Disabling this flag must not disable
  webhook processing for outstanding payments, refunds, disputes, or retries.
- `NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED=true` is set only on deployments where
  those server secrets and the webhook endpoint are active.
- Production additionally has a verified Vercel Firewall/WAF rate limit on
  `POST /api/stripe/checkout` and
  `AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY=true`. The route's in-memory limit
  is defense in depth, not the distributed control.
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

### Walletless identity direction

The durable design should introduce a chain-neutral buyer account with linked
identities (verified Google/email, GitHub, embedded wallet, Solana address, and
Base address) plus an explicit marketplace access-grant record. Do not derive a
fake Solana or EVM address from an email, and do not treat a Stripe customer id
as a wallet address.

Phantom embedded Google sign-in is a useful lower-risk onboarding experiment:
the user does not need an extension or seed phrase, but the embedded Solana
wallet remains the actual entitlement key. That improves UX without solving the
chain-neutral email identity model.

For Base-listed skills, a future card purchase should create an off-chain
marketplace access grant redeemable by the signed-in buyer account. It must not
create a Base purchase id, claim protocol settlement, or weaken the existing
Base USDC/x402 verification path. Implement and verify that seam on Base Sepolia
before any separately approved Base mainnet work.

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

- `charge.refunded` (full refund) and `charge.dispute.created` are handled:
  they set `revoked_at` / `revoked_reason` on the matching wallet-bound
  entitlement, and revoked entitlements no longer grant downloads. Partial
  refunds are logged for manual reconciliation. The Stripe webhook endpoint
  must be subscribed to these event types.
- A replayed webhook for a refunded payment stays revoked; a genuinely new
  payment (new payment intent) re-mints the entitlement. Winning a dispute
  requires manual reinstatement (clear `revoked_at`) for now.
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

## Graduation Decision

Before broad production rollout, choose exactly one Stripe model:

1. **Card on-ramp to protocol settlement.** Stripe collects payment, the
   operator converts net funds to USDC, and the backend settles into the
   protocol path before the sale affects author proceeds, voucher rewards, or
   protocol refund state.
2. **Parallel MPP marketplace.** Stripe Connect or an explicit operator payout
   process handles author payment off-chain. Sales remain separate from
   protocol economics, and voucher rewards stay at `0`.
3. **Limited early-sales rail.** Stripe stays available only for
   wallet-bound access experiments while protocol USDC/x402 remains the
   preferred commerce path.

## Production Blockers

Before treating Stripe MPP as production-ready, resolve:

- Refund and chargeback webhook handling. (Shipped: full-refund and dispute revocation; partial refunds and dispute-won reinstatement remain manual.)
- Entitlement revocation schema (shipped: `revoked_at`/`revoked_reason`) and UI copy for revoked buyers.
- Author payout process, including tax/KYC responsibilities.
- Operator reconciliation dashboard or runbook. (Shipped for limited preview:
  durable webhook outcome queue plus read-only `npm run stripe:ops --workspace
@agentvouch/web -- monitor`; a richer dashboard remains optional.)
- Rate limits and abuse monitoring on checkout/session creation. (Shipped in
  code: per-instance defense-in-depth limit and production activation gate;
  external Vercel Firewall/WAF rule still requires operator setup and proof.)
- Public documentation that separates card checkout from protocol settlement.

Use `docs/STRIPE_TEST_MODE_ROLLOUT.md` as the test-mode activation checklist.
