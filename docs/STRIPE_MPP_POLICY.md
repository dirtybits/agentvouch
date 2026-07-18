# Stripe MPP Policy (WIP)

Status: WIP. This policy describes the temporary Stripe marketplace-operator
path for selling paid skills before every purchase settles through the
AgentVouch on-chain economics.

## Scope

Stripe checkout is an off-chain marketplace purchase path. After a verified
payment, it can unlock paid skill content through either a legacy wallet-bound
entitlement or an account-scoped marketplace access grant. It does not create a
Solana `Purchase` PDA, a Base purchase id, author proceeds escrow, voucher
rewards, or protocol refund state.

The account-scoped path binds Checkout Session and PaymentIntent metadata to an
opaque AgentVouch buyer account and skill UUID. Fulfillment writes only
`marketplace_access_grants`; it does not synthesize a wallet, write a protocol
receipt, or expose Google/email identity onchain. The signed-wallet path remains
available for backwards compatibility.

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
- Account-scoped checkout is enabled independently with
  `AGENTVOUCH_BUYER_CARD_ACCESS_ENABLED=true` and
  `NEXT_PUBLIC_AGENTVOUCH_BUYER_CARD_ACCESS_ENABLED=true`; disabling these
  flags must not disable webhook revocation for outstanding payments.
- Production additionally has a verified Vercel Firewall/WAF rate limit on
  `POST /api/stripe/checkout` and
  `AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY=true`. The route's in-memory limit
  is defense in depth, not the distributed control.
- Webhook delivery is monitored and failed webhook retries are visible.
- Operators can reconcile account grants through
  `marketplace_access_grants.source_payment_reference` and legacy wallet sales
  through `usdc_purchase_receipts.payment_tx_signature`.
- Product copy clearly labels this as card checkout / off-chain entitlement,
  not protocol settlement.
- Refund, chargeback, and payout responsibilities below are accepted.

## Buyer Access

Account checkout grants access only to the authenticated opaque buyer account.
The same active session authorizes re-download without a wallet signature.
Legacy wallet checkout still grants access only to the wallet that signed the
checkout message and re-downloads through `X-AgentVouch-Auth`.

### Walletless identity boundary

The shipped preview model uses a chain-neutral buyer account with verified
Google/email identities, optional signed Solana/Base wallet links, and explicit
marketplace access grants. It never derives a fake Solana or EVM address from an
email or treats a Stripe customer id as a wallet address. GitHub remains a
publisher identity and is not silently merged into the buyer account.

For Base-listed skills, card purchase creates only an off-chain marketplace
grant redeemable by the signed-in buyer account. It does not create a Base
purchase id, claim protocol settlement, or weaken the existing Base USDC/x402
verification path. This seam is limited to Base Sepolia preview testing; Base
mainnet requires separately approved readiness work.

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
  they set `revoked_at` / `revoked_reason` on the matching account grant or
  legacy wallet entitlement, and revoked access no longer grants downloads.
  Partial refunds are logged for manual reconciliation. The Stripe webhook
  endpoint must be subscribed to these event types.
- A replayed webhook for a refunded payment stays revoked; a genuinely new
  payment (new payment intent) re-mints the entitlement. Winning a dispute
  requires manual reinstatement (clear `revoked_at`) for now.
- Maintain an operator reconciliation queue for paid-but-not-entitled and
  refunded-but-still-entitled cases.
- Make support copy explicit that card refunds are handled by the marketplace
  operator, while protocol-listed USDC purchases use on-chain dispute/refund
  rules.

## Reporting

Account-scoped Stripe sales stay outside protocol receipt tables. Their durable
record is a `marketplace_access_grants` row keyed by source payment reference,
skill, and opaque buyer account.

Legacy wallet Stripe receipts should remain visibly distinct from protocol
purchases:

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
3. **Limited early-sales rail.** Stripe stays available only for account- or
   wallet-scoped access experiments while protocol USDC/x402 remains the
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
