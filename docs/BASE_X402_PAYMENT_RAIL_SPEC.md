# Base/x402 Payment Rail Spec (WIP)

Status: WIP. This spec turns the Base POC findings into a payment-rail
decision surface for AgentVouch. It should be read with
`docs/KORA_VS_BASE_X402.md`, `docs/X402_REVSPLIT_BASE_VS_SOLANA.md`, and
`docs/STRIPE_FEASIBILITY.md`.

## Goal

Make Base/USDC/x402 the preferred agent-native payment rail when it can create
protocol-visible purchase state, preserve the author/voucher split, and avoid a
trusted settlement hop.

## Non-Goals

- Do not make Stripe the canonical settlement ledger.
- Do not call Base canonical until the trust half of the protocol is complete:
  disputes, voucher slashing, refunds, audit, and migration plan.
- Do not treat off-chain Stripe entitlements as voucher yield, author proceeds
  escrow, or protocol refund claims.

## Actors

- Buyer: signs either a Base USDC authorization/UserOp or an AgentVouch wallet
  auth message for download access.
- Author: creates listings and receives proceeds through the protocol path.
- Voucher: stakes behind authors/listings and receives claimable reward share
  only when the purchase rail funds protocol reward accounting.
- Relayer/paymaster: sponsors Base gas for UserOps or submits EIP-3009
  authorizations under an allowlisted policy.
- Stripe operator: runs card checkout and webhook fulfillment for off-chain
  entitlements only.
- Settlement authority: exists for bridge-style lanes only; minimize or avoid
  this role where Base Lane B can consume authorization in-contract.

## Assets And Units

- USDC uses 6 decimals and remains the common unit for prices, author proceeds,
  voucher rewards, bonds, and refund accounting.
- Base gas is paid by a paymaster/relayer policy. Buyers should not need ETH.
- Stripe charges USD by card. A Stripe sale is not USDC settlement unless the
  operator later converts and settles into the protocol path.

## State Model

- Solana canonical state remains the live trust system until an explicit Base
  canonical migration is approved.
- Base POC state covers profiles, author bonds, vouches, listings, purchase
  accounting, proceeds, voucher revenue, and x402 lanes.
- Stripe state is DB entitlement state:
  `payment_flow = "stripe-mpp-offchain"`. It must remain visibly separate from
  `purchase_skill`, Base purchase, and x402 protocol-settlement receipts.

## Payment Lanes

1. **Solana direct USDC:** buyer calls `purchase_skill`; program creates the
   purchase receipt and routes proceeds/rewards atomically.
2. **Solana x402 bridge:** buyer pays x402 into the protocol settlement vault;
   backend verifies settlement and calls `settle_x402_purchase`.
3. **Base direct purchase:** buyer uses Base USDC through the Base contract/UI;
   purchase verification records entitlement against the Base chain context.
4. **Base x402 Lane B:** buyer signs an EIP-3009 authorization; the AgentVouch
   contract consumes it and records purchase/reward state atomically. This is
   the preferred Base agent rail.
5. **Base x402 Lane C:** backend-settled bridge-equivalent path. Keep as a
   fallback or compatibility lane, not the preferred trust model.
6. **Stripe MPP:** buyer signs AgentVouch wallet checkout auth, pays by card,
   and webhook records an off-chain entitlement for that wallet.

## Stripe Calculus

Base changes Stripe from "shortcut around crypto checkout" into "card-funded
demand capture." The better Base/x402 gets, the narrower Stripe should become:

- Stripe is useful for humans who want to pay by card now.
- Stripe is not useful as proof of protocol purchase, voucher yield, or refund
  coverage unless fiat is converted to USDC and settled through a protocol lane.
- Stripe for Base buyers needs an explicit identity decision before production:
  keep card checkout AgentVouch-wallet-bound, add chain-qualified buyer
  entitlements, or build a customer identity model.

## Invariants

- Protocol purchase metrics must exclude `stripe-mpp-offchain`.
- Voucher rewards must only accrue from rails that fund protocol reward state.
- A paid download entitlement must be redeemable by the same buyer identity that
  authorized checkout or settlement.
- x402 settlement must bind buyer, listing, skill id, amount, chain context, and
  nonce/payment reference.
- Base Lane B must not allow a relayer to redirect a buyer authorization to a
  different listing, price, revision, or recipient.
- Paymaster and relayer policies must be allowlisted and rate-limited before
  mainnet.

## Launch Gates

- Base backed x402 purchase smoke on a live network: author/voucher split proves
  60/40 when external backing exists and 100% author when no backing exists.
- Base paymaster policy limits: contract allowlist, function allowlist, per
  wallet rate limits, and monthly cap.
- Stripe test-mode rollout passes `docs/STRIPE_TEST_MODE_ROLLOUT.md`.
- Entitlement reporting separates Solana direct, Solana x402 bridge, Base direct,
  Base x402, and Stripe MPP.
- Product copy labels card checkout as an off-chain entitlement unless/until
  fiat -> USDC -> protocol settlement ships.

## Open Decisions

1. Does Base become canonical, or stay a parallel protocol-visible rail while
   Solana remains canonical?
2. Is Stripe a limited early-sales rail, a parallel MPP marketplace, or a card
   on-ramp that settles to USDC on-chain?
3. Should Stripe card buyers stay AgentVouch-wallet-bound, or should the product
   add email/customer identity plus chain-qualified entitlement redemption?
4. Which Base x402 lane is production default: Lane B only, or Lane B plus Lane C
   fallback?
