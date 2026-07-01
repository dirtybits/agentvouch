# Stripe / Web2 Payments — Feasibility Note (WIP)

Status: **exploratory**. This documents how hard it would be to accept
"web2-style" card payments (Stripe / MPP-style marketplace operator flow)
alongside the existing USDC-native, on-chain purchase flow, and ships a
**Tier 1 prototype** (off-chain entitlement-only) for the implementation and
review agents to evaluate. Nothing here is production-ready.

## TL;DR

The question splits into two very different problems:

1. **Gate access to a paid skill behind a card payment** — _easy_
   (a few days). Prototyped here.
2. **Preserve AgentVouch's on-chain economics** (author proceeds escrow +
   the 60/40 author/voucher reward split, disputes, refunds) **through a
   fiat rail** — _hard_ (weeks), and partly a business/compliance decision
   rather than an engineering one. **Not** prototyped — only specified.

## Why Tier 1 is easy

Access to a paid skill ultimately reduces to one DB check:

```
hasUsdcPurchaseEntitlement(skillDbId, buyerPubkey)
  -> SELECT EXISTS(... FROM usdc_purchase_entitlements
                   WHERE skill_db_id = ? AND buyer_pubkey = ?)
```

— see `web/lib/usdcPurchases.ts`. All of the on-chain machinery (USDC
transfer, `Purchase` PDA, x402 settlement) exists to _justify writing a row
into `usdc_purchase_entitlements`_. The raw-file route reads that table; it
does not re-verify the chain on every download. So the minimum viable Stripe
path is:

1. `POST /api/stripe/checkout` — create a Stripe Checkout Session for the
   skill's listed price after the buyer signs a wallet-scoped checkout auth
   message.
2. `POST /api/stripe/webhook` — on `checkout.session.completed`, verify the
   Stripe signature, then call the existing `recordUsdcPurchaseReceipt(...)`
   which appends a receipt and upserts the entitlement.
3. The existing download gate just works.

The codebase already has the right shape for this: serverless API routes on
Vercel, raw-SQL Postgres (Neon) with the `ALTER TABLE ... ADD COLUMN IF NOT
EXISTS` migration idiom, and secrets via Vercel env vars.

## What the Tier 1 prototype does (and does not) do

Files: `web/lib/stripe.ts`, `web/app/api/stripe/checkout/route.ts`,
`web/app/api/stripe/webhook/route.ts`.

Policy guardrails: `docs/STRIPE_MPP_POLICY.md`.

Does:

- Talks to the Stripe REST API directly with `fetch` and verifies webhook
  signatures with `node:crypto` HMAC-SHA256 — **no new npm dependency**, so
  the build and lockfile are untouched. (Production should weigh adopting the
  official `stripe` SDK for typing and edge cases.)
- Creates a Checkout Session priced from `skills.price_usdc_micros`.
- On a verified `checkout.session.completed` webhook, mints an off-chain
  entitlement via `recordUsdcPurchaseReceipt` with
  `payment_flow = "stripe-mpp-offchain"`.
- Requires buyer wallet auth at checkout. This keeps the receipt redeemable by
  the existing raw-download gate, which is still wallet-signature based.
- Is feature-flagged: every entry point no-ops with 501 unless both
  `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set.

Does **not** (deliberately out of scope — these are the Tier 2/3 hard parts):

- No fiat -> USDC conversion and **no on-chain settlement**. No author
  proceeds escrow is funded; **no voucher reward pool** is funded. A
  Stripe sale today is invisible to the protocol's economics.
- No email-only buyer identity. Buyers still need a wallet signature so the
  off-chain Stripe entitlement can be redeemed through the existing download
  auth path — see Obstacle 1.
- No refund / chargeback handling, no reconciliation, no idempotency beyond
  the receipt table's `UNIQUE(payment_tx_signature)`.

## The hard parts (Tier 2 / Tier 3)

### Obstacle 1 — Identity mismatch

Entitlements are keyed on `buyer_pubkey VARCHAR(44)` (a Solana address).
Auth today is wallet-signature + optional GitHub OAuth
(`web/lib/auth.ts`, `web/lib/githubOAuth.ts`). A card buyer may have no USDC
balance, but this prototype still requires a wallet signature to bind the card
checkout to a redeemable AgentVouch buyer. An email-only implementation needs
an email / Stripe customer identity and either a synthetic-pubkey namespace or
a polymorphic buyer key, plus a `stripe_customers` link table. Touches the
core identity model.

### Obstacle 2 — Receipt schema assumes on-chain provenance

`usdc_purchase_receipts` columns are chain-shaped: `payment_tx_signature`
(NOT NULL UNIQUE), `recipient_ata`, `purchase_pda`, `settlement_pda`,
`x402_settlement_*`. A Stripe charge has none of these. The prototype stuffs
sentinels in; a real design likely wants a dedicated `stripe:` provenance
shape rather than overloading chain columns.

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

| Scope                                                              | Effort                            | Notes                                                                                      |
| ------------------------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------ |
| Stripe -> wallet-bound entitlement only (this prototype, hardened) | ~2-4 days                         | refund/chargeback webhooks, reconciliation, payout policy                                  |
| + email-only card buyers                                           | +1 week                           | identity link table, customer portal/session auth                                          |
| + author fiat payouts                                              | +1-2 weeks                        | Stripe Connect, onboarding, KYC, off-chain 60/40 accounting                                |
| + preserve on-chain economics                                      | several weeks + design/compliance | fiat->USDC, treasury-pushed settlement, voucher rewards, dispute/chargeback reconciliation |

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
- `STRIPE_API_BASE` — optional, defaults to `https://api.stripe.com`.
- `AGENTVOUCH_PUBLIC_BASE_URL` — optional, for checkout success/cancel URLs;
  falls back to the request origin.
