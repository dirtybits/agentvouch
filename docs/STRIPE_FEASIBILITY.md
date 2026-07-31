# Stripe / Web2 Payments — Feasibility Note (WIP)

Status: **implemented in test mode; production disabled**. The Tier 1
off-chain-access path supports signed-in Google/email buyer accounts plus the
legacy signed-wallet path, but nothing here makes card checkout
production-ready or protocol-visible settlement.

## TL;DR

The question splits into two very different problems:

1. **Gate access to a paid skill behind a card payment** — _easy_
   (a few days). Prototyped here.
2. **Preserve AgentVouch's on-chain economics** (author proceeds escrow +
   the 60/40 author/voucher reward split, disputes, refunds) **through a
   fiat rail** — _hard_ (weeks), and partly a business/compliance decision
   rather than an engineering one. **Not** prototyped — only specified.

## Payment Rail Decision — 2026-07-01

Base/USDC/x402 changes the Stripe scope, not the Stripe value. AgentVouch
should keep Stripe MPP as a card-funded acquisition path for buyers and
authors who want to transact now, while treating USDC-native `purchase_skill`
and the protocol x402 bridge as the preferred protocol-visible settlement
paths.

Current positioning:

- **Preferred protocol path:** direct USDC `purchase_skill` and the
  protocol-listed x402 bridge. These paths can create `Purchase` PDA state,
  fund author proceeds, fund voucher rewards, and preserve dispute/refund
  semantics.
- **Base path:** Base is the active smart-account/x402 workstream. It can make
  agent-native USDC payments feel closer to web2 checkout, especially through
  EIP-3009 x402, but it is not a reason to make Stripe the canonical ledger.
- **Stripe MPP path:** Stripe is the human/card on-ramp and "sell now" bridge.
  It may unlock content through an account-scoped marketplace grant or the
  legacy wallet-bound entitlement, but it must not be counted as protocol
  settlement unless a later fiat -> USDC -> on-chain settlement design is
  approved and implemented.

Before Tier 2, choose one graduation model:

1. **Card on-ramp to protocol settlement:** Stripe collects card payment,
   operator converts net proceeds to USDC, then settles through the protocol
   path before the sale counts toward author proceeds, voucher rewards, or
   protocol refund state.
2. **Parallel MPP marketplace:** Stripe Connect or operator payouts handle
   author payment off-chain. Sales remain visibly separate from protocol
   purchases and do not create voucher yield or protocol refund claims.
3. **Limited early-sales rail:** Stripe stays test/limited-scope for
   account- or wallet-scoped access while Base/USDC/x402 carries the
   agent-native commerce path.

Related docs: `docs/BASE_X402_PAYMENT_RAIL_SPEC.md` and
`docs/STRIPE_TEST_MODE_ROLLOUT.md`.

## Why Tier 1 is easy

Access to a paid skill ultimately reduces to one of two independent DB checks:

```
hasUsdcPurchaseEntitlement(skillDbId, buyerPubkey)
  -> SELECT EXISTS(... FROM usdc_purchase_entitlements
                   WHERE skill_db_id = ? AND buyer_pubkey = ?)

hasActiveMarketplaceAccessGrant(buyerAccountId, skillDbId)
  -> SELECT EXISTS(... FROM marketplace_access_grants
                   WHERE buyer_account_id = ? AND skill_db_id = ?
                     AND status = 'active')
```

— see `web/lib/usdcPurchases.ts`, `web/lib/buyerAccessGrants.ts`, and
`web/lib/skillRawAccess.ts`. The account path never synthesizes a wallet or
writes a protocol receipt; the legacy path remains for wallet-bound
compatibility. So the minimum Stripe path is:

1. `POST /api/stripe/checkout` — create a Stripe Checkout Session for the
   skill's listed price after a buyer signs in to an AgentVouch account and
   acknowledges the card-recourse disclosure, or after the legacy buyer signs
   a wallet-scoped checkout auth message.
2. `POST /api/stripe/webhook` — on `checkout.session.completed`, verify the
   Stripe signature, then write either an account-scoped
   `marketplace_access_grants` row or a visibly off-chain legacy receipt and
   wallet entitlement.
3. The raw-download gate accepts the active account grant or legacy wallet
   entitlement as an independent off-chain authorization path.

The codebase already has the right shape for this: serverless API routes on
Vercel, raw-SQL Postgres (Neon) with the `ALTER TABLE ... ADD COLUMN IF NOT
EXISTS` migration idiom, and secrets via Vercel env vars.

## What the Tier 1 implementation does (and does not) do

Primary files: `web/lib/stripe.ts`, `web/app/api/stripe/checkout/route.ts`,
`web/app/api/stripe/webhook/route.ts`, `web/lib/buyerAccessGrants.ts`, and
`web/lib/skillRawAccess.ts`.

Policy guardrails: `docs/STRIPE_MPP_POLICY.md`.

Does:

- Talks to the Stripe REST API directly with `fetch` and verifies webhook
  signatures with `node:crypto` HMAC-SHA256 — **no new npm dependency**, so
  the build and lockfile are untouched. (Production should weigh adopting the
  official `stripe` SDK for typing and edge cases.)
- Creates a Checkout Session priced from `skills.price_usdc_micros`.
- On a verified `checkout.session.completed` webhook, mints an account-scoped
  off-chain marketplace grant for a signed-in buyer. The legacy path still
  records `payment_flow = "stripe-mpp-offchain"` for a wallet-bound
  entitlement.
- Supports Google/email buyers through an opaque AgentVouch account and Clerk
  session. The legacy wallet signature still binds skill id and exact
  USDC-micros amount so a price change fails closed.
- Allows account-scoped access for Base Sepolia listings without claiming a
  Base purchase. The legacy wallet path still rejects Base protocol listings
  because that pubkey-keyed entitlement cannot redeem the Base download.
- Refuses checkout below Stripe's $0.50 USD minimum. Live-key checkout parses
  an explicit skill UUID allowlist and maximum unit charge, but remains
  source-disabled until the buyer allowlist, immutable reservation ledger, and
  atomic exposure caps exist.
- Requires the buyer to acknowledge versioned card-recourse copy before a
  Checkout Session is created and carries that version in Session and
  PaymentIntent metadata. Live fulfillment is source-disabled before any grant
  until reservation-bound disclosure and pilot-scope validation is implemented.
- Webhook response policy: permanently-unprocessable events (bad metadata,
  amount mismatch, deleted skill) are durably queued before they are ACKed with
  200 so Stripe stops retrying; non-2xx is reserved for signature failures,
  transient errors, and failure to persist the outcome. An existing entitlement is never overwritten — late or
  duplicate Stripe webhooks ack `alreadyEntitled` instead of clobbering
  on-chain purchase provenance in the entitlement upsert.
- Checkout session creation is separately feature-flagged: it no-ops with 501
  unless both Stripe secrets and `AGENTVOUCH_STRIPE_CHECKOUT_ENABLED=true` are
  set. Production deployments require the edge-rate-limit acknowledgement for
  test or live keys; every live key also requires it plus the live-mode flag,
  regardless of deployment environment. Webhook processing deliberately remains
  enabled when only checkout creation is off.

Does **not** (deliberately out of scope — these are the Tier 2/3 hard parts):

- No fiat -> USDC conversion and **no on-chain settlement**. No author
  proceeds escrow is funded; **no voucher reward pool** is funded. A
  Stripe sale today is invisible to the protocol's economics.
- Limited-preview refund / chargeback handling: `charge.refunded` (full) and
  `charge.dispute.created` revoke the account grant or wallet-bound
  entitlement, partial refunds are durably queued, and a genuinely new payment
  can re-mint. The read-only operator monitor surfaces unresolved items;
  partial-refund decisions and dispute-won reinstatement are still manual.
- No durable live-pilot amount/fee/net ledger or atomic aggregate GMV cap. The
  limited-live plan treats both as stop gates before real card activation.

## The hard parts (Tier 2 / Tier 3)

### Obstacle 1 — Identity boundary (resolved for off-chain access)

The account-scoped path now uses an opaque AgentVouch buyer UUID with verified
Google/email identities and optional independently proven wallet links. It
does not synthesize a Solana or EVM address, expose email onchain, or merge the
publisher GitHub identity into the buyer account. This resolves walletless
off-chain access, not protocol settlement: a card grant still has no chain
receipt or protocol recourse.

### Obstacle 2 — Receipt schema assumes on-chain provenance

`usdc_purchase_receipts` columns are chain-shaped: `payment_tx_signature`
(NOT NULL UNIQUE), `recipient_ata`, `purchase_pda`, `settlement_pda`, and
`x402_settlement_*`. A Stripe charge has none of these. The account path avoids
that table and uses `marketplace_access_grants`; only the legacy wallet path
keeps visibly off-chain sentinels for backwards compatibility. A future
protocol-settled card design still needs distinct provenance and
reconciliation.

### Obstacle 3 — The economics are the product, and they're on-chain + atomic

Today a `purchase_skill` is one Solana transaction that atomically splits
60% to the per-listing author proceeds escrow and 40% to the listing reward
vault (or 100% to author escrow when no external vouch stake exists), with
disputes/slashing/refunds enforced by the Anchor program
(`programs/agentvouch/`). Stripe gives fiat in a platform account with T+2
settlement and chargeback risk. Preserving the model requires:

- fiat -> USDC conversion,
- a custodial/treasury keypair that pushes on-chain settlement _after_ the
  webhook (the existing `AGENTVOUCH_X402_SETTLEMENT_AUTHORITY` hints this
  capability already exists for x402),
- reconciliation and a compensating refund path when the card succeeds but
  the on-chain leg fails,
- Stripe Connect + KYC if authors are to be paid out in fiat.

This is weeks of work and includes non-engineering (treasury, compliance)
decisions.

### Philosophical tension

The product pitch (`docs/VISION.md`) is "trust backed by real staked
capital, not points." A fiat side-door that mints entitlements without
on-chain capital movement weakens that story unless the fiat is converted
and settled on-chain. Worth an explicit product decision before Tier 2.

## Rough effort

| Scope                                                                  | Effort                            | Notes                                                                                      |
| ---------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------ |
| Stripe -> wallet/account-scoped access only (implemented in test mode) | shipped                           | refund/dispute revocation and reconciliation shipped; production policy remains open       |
| + Google/email card buyers                                             | shipped                           | opaque account, Clerk session, access grants, and walletless download                      |
| + author fiat payouts                                                  | +1-2 weeks                        | Stripe Connect, onboarding, KYC, off-chain 60/40 accounting                                |
| + preserve on-chain economics                                          | several weeks + design/compliance | fiat->USDC, treasury-pushed settlement, voucher rewards, dispute/chargeback reconciliation |

## Open product questions (answer before Tier 2)

1. Is fiat a friendlier on-ramp (economics stay fully on-chain, Stripe is
   UX only) or a parallel off-chain marketplace that bypasses the chain?
2. Do authors get paid in fiat or USDC? (Single biggest cost driver — this
   is the Stripe Connect / KYC line.)
3. Are vouchers still rewarded on Stripe sales? If yes, you cannot stay
   off-chain.

## Environment variables (prototype)

- `STRIPE_SECRET_KEY` — server-side Stripe key. Required with webhook secret;
  absent => feature disabled.
- `STRIPE_WEBHOOK_SECRET` — `whsec_...`, for webhook signature verification.
  Required before checkout is enabled so paid sessions cannot be created
  without a fulfillment path.
- `AGENTVOUCH_STRIPE_CHECKOUT_ENABLED` — server-only session-creation gate.
  Keep webhooks configured when this is false so delayed events and reversals
  still process.
- `NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED` — set to `true` to render card checkout
  controls. Keep this aligned with the server secrets above and redeploy after
  changing it.
- `AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY` — required for every production
  deployment and every deployment using a live key as an operator acknowledgement
  that a real Vercel Firewall/WAF rate limit is installed for
  `POST /api/stripe/checkout`. It does not create the rule.
- `AGENTVOUCH_STRIPE_LIVE_MODE_ENABLED` — explicit acknowledgement required
  before a live Stripe key may create Checkout Sessions in any environment.
- `AGENTVOUCH_STRIPE_LIVE_PILOT_SKILL_IDS` — required non-empty comma-separated
  skill UUID allowlist for live-key checkout. Malformed or missing values fail
  closed.
- `AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_UNIT_USD_CENTS` — required positive integer
  maximum per live Checkout Session. This is not an aggregate volume cap.
- `AGENTVOUCH_BUYER_CARD_ACCESS_ENABLED` and
  `NEXT_PUBLIC_AGENTVOUCH_BUYER_CARD_ACCESS_ENABLED` — separate server/public
  gates for the account-scoped walletless path.
- `STRIPE_API_BASE` — optional, defaults to `https://api.stripe.com`.
- `AGENTVOUCH_PUBLIC_BASE_URL` — optional, for checkout success/cancel URLs;
  falls back to `NEXT_PUBLIC_APP_URL`, then the request origin.
