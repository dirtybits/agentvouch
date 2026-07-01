---
name: solana-usdc-sponsored-checkout
overview: "Spike Solana-native USDC sponsored checkout before Kora: prove typed sponsored purchase transactions, add the rent-payer shape needed for no-SOL buyers, and keep Kora as later production hardening."
todos:
  - id: source-audit
    content: Audit current purchase UI, transaction helpers, preflight copy, and Anchor payer constraints for sponsored-checkout readiness
    status: completed
  - id: quote-design
    content: Implement or specify server-side USDC setup-fee quoting without an on-chain SOL/USDC oracle for the first spike
    status: completed
  - id: native-sponsored-prepare
    content: Add a feature-flagged typed prepare/submit flow using a server sponsor fee payer and wallet partial signing, without Kora
    status: completed
  - id: purchase-rent-payer
    content: Add the minimum purchase_skill rent_payer interface needed for fresh buyers to complete checkout without SOL
    status: completed
  - id: web-checkout
    content: Wire the Marketplace/skill purchase UI to sponsored checkout with direct-wallet fallback and accurate copy
    status: completed
  - id: devnet-smoke
    content: Smoke a devnet purchase where the buyer has USDC but no SOL, including quote, sign, submit, verify, and download
    status: pending
  - id: docs-handoff
    content: Update docs/runbook only after behavior is verified, and leave Kora as the follow-up production relayer plan
    status: pending
isProject: false
---

# Solana USDC Sponsored Checkout

## Goal

Prove the shortest Solana-native path to "buyer has USDC, no SOL required" for AgentVouch paid checkout. This plan intentionally starts with native Solana fee/rent sponsorship and a typed server-side transaction helper, then leaves Kora as production relayer hardening once the transaction shape and economics are proven.

Design decision recorded 2026-06-22: defer Kora for the first implementation branch. Kora remains useful later for validation policy, signer custody, rate limits, USDC fee collection, and monitoring, but it should not be the first dependency for proving the core checkout flow.

## Non-Goals

- Do not migrate this work to Base.
- Do not introduce Openfort for the first spike.
- Do not run a Kora server in this branch.
- Do not add an on-chain SOL/USDC oracle unless the program must enforce variable sponsor reimbursement on-chain.
- Do not claim every AgentVouch flow is no-SOL. This branch starts with paid checkout.
- Do not expose a generic "sign arbitrary transaction" relayer API.

## Current Facts

Verified from source on 2026-06-22:

- `web/hooks/useMarketplaceOracle.ts` and `web/hooks/useReputationOracle.ts` build `purchaseSkill` transactions with the connected wallet signer as `feePayer`.
- `purchase_skill` initializes the `Purchase` PDA with `payer = buyer`.
- `purchase_skill` also initializes the author's reward vault with `payer = buyer` when needed.
- Because of those Anchor constraints, fee-only sponsorship is not enough for a fresh buyer with zero SOL. A separate transaction `feePayer` can pay the network fee, but the buyer still needs lamports when Anchor account creation uses `payer = buyer`.
- `settle_x402_purchase` already demonstrates the backend-mediated payer pattern: `settlement_authority` pays rent for program-created purchase/receipt accounts while preserving buyer-facing purchase state.
- Several account structs already store rent-payer-like fields (`Vouch`, `AuthorBond`, `SkillListing`, `AgentProfile`, `AuthorDispute`, `AuthorDisputeVouchLink`), so explicit rent-payer accounting is already part of the program's vocabulary.

Audit update 2026-06-22:

- The current framework-kit helper in `web/lib/solanaTransactionHelper.ts` is intentionally small and wallet-paid. Sponsored checkout should use a separate helper/API surface rather than mutating the direct `prepareAndSend` path.
- The first code-bearing slice should start with the Anchor `purchase_skill` rent-payer account. Fee-only sponsorship would still fail the fresh-buyer target because Anchor currently debits buyer lamports for the receipt PDA and purchase-time reward vault creation.
- Implementation update 2026-06-22: `purchase_skill` now accepts `rent_payer` and uses it for the purchase PDA plus purchase-time author reward vault creation. Existing direct web/CLI/smoke paths pass the buyer as `rent_payer`, preserving current behavior. Anchor tests include a separate-rent-payer purchase regression and passed with 36 tests.
- Sponsored API update 2026-06-22: `web/lib/sponsoredPurchase.ts` and `/api/transactions/sponsored/purchase/{prepare,submit}` implement the first typed native relayer surface. The prepare route builds exactly one `purchaseSkill` instruction plus an optional exact `TransferChecked` sponsor reimbursement, sets the sponsor as fee/rent payer, partial-signs as sponsor, and returns a base64 legacy transaction. The submit route re-decodes and revalidates the fee payer, purchase accounts, instruction data, reimbursement destination, reimbursement cap, buyer signer, and buyer USDC balance before simulation/send. This is intentionally not a generic transaction relay.

## Scope

- In scope: direct on-chain `purchase_skill` checkout for protocol-listed paid skills.
- In scope: typed server-side quote/prepare/submit APIs.
- In scope: a local/devnet sponsor signer, feature flags, spend caps, and fallback to the current wallet-paid path.
- In scope: the smallest Anchor interface change needed to let a sponsor/rent payer pay checkout account rent while the buyer remains the USDC authority.
- In scope: web UI/preflight copy that truthfully says when sponsored checkout is available.
- Out of scope: Kora production deployment, Openfort, Base, MCP payment flows, all non-purchase AgentVouch writes, and generalized relayer infrastructure.

## User Experience Target

For an eligible paid listing:

1. Buyer connects a Solana wallet with USDC but no SOL.
2. UI shows the skill price plus a small USDC network/setup fee, when charged.
3. Buyer signs one transaction.
4. Sponsor pays SOL fee and any checkout rent.
5. Program transfers skill price in USDC, records the purchase receipt, and transfers sponsor reimbursement in USDC in the same transaction.
6. The existing purchase verification API confirms the on-chain receipt and unlocks raw content.

If any step fails, no misleading entitlement should be recorded. The direct wallet-paid path stays available as fallback.

## Design

### Phase 1: Native Sponsored Transaction Shape

Build a typed sponsored transaction path without Kora:

- Server owns a devnet sponsor signer.
- Server validates a typed purchase intent: buyer, skill database id, listing PDA, expected price, expected mint, expected network, and optional max setup fee.
- Server builds the `purchase_skill` transaction shape.
- Server sets the transaction `feePayer` to the sponsor.
- Server adds a bounded USDC reimbursement transfer from the buyer's USDC ATA to a sponsor/protocol USDC ATA when a fee is charged.
- Server partial-signs only as sponsor/rent payer.
- Browser wallet signs as buyer.
- Submit route re-validates the final transaction and sends it.

Important: this phase proves partial signing and typed validation. It does not, by itself, make fresh buyers no-SOL until `purchase_skill` stops charging account rent to `buyer`.

### Phase 2: Purchase Rent Payer

Change only the purchase path needed for checkout:

- Add `rent_payer: Signer<'info>` to `purchase_skill`.
- Use `rent_payer` for the `Purchase` PDA creation.
- Use `rent_payer` for any `init_if_needed` author reward vault creation in the purchase path.
- Keep `buyer` as the signer and USDC token authority.
- Keep all buyer, listing, settlement, mint, vault, and chain-context validation unchanged.
- Record rent payer deliberately where the program already tracks rent payer fields, or document why checkout-created accounts close to a sponsor-controlled destination later.

This is an Anchor interface change. After implementation, rebuild IDL and regenerate clients.

### Phase 3: USDC Setup Fee Quote

Start off-chain:

- Estimate network fee and rent exposure server-side from the typed transaction and expected account creations.
- Convert the SOL-denominated cost to micro-USDC using a server quote source, a configured static fallback, or an operator-provided env value.
- Add a conservative buffer and cap.
- Show the exact fee to the user before signing.
- Bind the transaction to the displayed cap so the buyer cannot be charged more than approved.

Do not add Pyth/Switchboard/Chainlink in the first spike. An on-chain oracle is only needed if the Solana program itself must enforce a dynamic SOL/USDC conversion. In this design, the server quote plus exact user-signed USDC transfer is enough for the spike because the buyer sees and signs the reimbursement amount.

Recommended initial policy:

- repeat/small network-fee-only cases: absorb or charge a tiny fixed fee.
- first-time rent-bearing checkout: actual estimated rent + tx fee + buffer, capped around a small published amount.
- promos: allow zero setup fee through an explicit server policy, not by weakening validation.

Implementation update 2026-06-22: `web/lib/sponsoredCheckout.ts` implements the off-chain quote math. It converts rent/fee lamports into micro-USDC using a server-configured micro-USDC-per-SOL price, applies a default 20% buffer, caps the buyer-facing fee when configured, and rejects missing/zero SOL/USDC price input. Focused Vitest coverage lives in `web/__tests__/lib/sponsoredCheckout.test.ts`.

### Phase 4: Web Checkout

Feature flag the sponsored path:

- `AGENTVOUCH_SPONSORED_CHECKOUT_ENABLED`
- `AGENTVOUCH_SPONSOR_KEYPAIR_PATH` or managed signer equivalent for devnet only
- `AGENTVOUCH_SPONSOR_USDC_FEE_DESTINATION`
- `AGENTVOUCH_SPONSOR_MAX_FEE_USDC_MICROS`
- `AGENTVOUCH_SPONSOR_SOL_USDC_MICRO_PRICE` or equivalent quote-source env
- `NEXT_PUBLIC_AGENTVOUCH_SPONSORED_CHECKOUT_ENABLED`

UI behavior:

- If sponsored checkout is available, show "Pay in USDC" with price and setup fee.
- If not available, preserve current copy that buyers need USDC and SOL.
- If wallet lacks partial `signTransaction`, fall back instead of showing a broken sponsored path.
- After confirmation, reuse the existing purchase verification/download flow.

Implementation update 2026-06-22: `web/lib/sponsoredPurchaseClient.ts` wires the feature-flagged browser path through the existing `purchaseSkill` hooks. It uses connector wallets with `canSign`, shows a spike-level confirmation containing the exact USDC price and setup fee before the wallet prompt, signs the server-prepared partial transaction, submits through the typed route, and falls back to direct wallet-paid checkout only when sponsorship is disabled or server-unavailable. A polished in-page fee review panel can replace the browser confirmation after the devnet smoke.

Verification update 2026-06-22: after clearing stale worktree `.next` output and using symlinked workspace dependencies, `next build --webpack` completed successfully with the sponsored purchase API routes included. `NO_DNA=1 anchor test --skip-build` completed with 36 passing tests, including the separate `rent_payer` purchase regression.

## Files To Change

- `programs/agentvouch/src/instructions/purchase_skill.rs`: split `buyer` from `rent_payer` for checkout account creation.
- `programs/agentvouch/src/lib.rs`: update purchase instruction signature only if arguments/accounts require it.
- `tests/agentvouch-usdc-marketplace.ts` or current purchase test suite: cover buyer authority plus separate rent payer.
- `web/hooks/useMarketplaceOracle.ts`: route eligible purchases through sponsored checkout.
- `web/hooks/useReputationOracle.ts`: keep direct path compatible or add shared helper support if dashboard purchases use this hook.
- `web/lib/solanaTransactionHelper.ts`: support prepare/sign/submit or delegate to a sponsored helper.
- `web/lib/purchasePreflight.ts`: distinguish direct SOL-required path from sponsored path.
- `web/lib/agentvouchUsdc.ts`: include sponsor fee/rent-payer data in transaction logs where helpful.
- `web/app/api/transactions/sponsored/purchase/prepare/route.ts`: typed prepare route.
- `web/app/api/transactions/sponsored/purchase/submit/route.ts`: typed submit/re-validation route.
- `web/generated/agentvouch/`, `web/agentvouch.json`, `packages/agentvouch-protocol/src/index.{ts,js,d.ts}`, `packages/agentvouch-cli/src/idl/agentvouch.ts`: regenerate after Anchor IDL changes.
- `scripts/devnet-usdc-smoke.mjs`: add a sponsored checkout smoke path after the web/server flow exists.
- `docs/PRODUCTION_RUNBOOK.md`, `docs/MAINNET_READINESS.md`, `web/public/skill.md`: update only after the behavior is verified live.

## Implementation Steps

1. Audit the current purchase flow and write down exact account/rent blockers.
   - Confirm every account created by `purchase_skill`.
   - Confirm which token accounts may need pre-existing ATAs.
   - Confirm wallet adapter support for partial signing in the target wallets.

2. Add feature flags and server-only sponsor config.
   - Fail closed when sponsor env is missing.
   - Never bundle sponsor secrets into browser code.
   - Keep the direct purchase path unchanged.

3. Add typed prepare route.
   - Accept buyer pubkey, skill/listing identifiers, expected price, expected mint, and max setup fee.
   - Re-read listing/skill state server-side.
   - Build the purchase transaction.
   - Add reimbursement transfer if charged.
   - Set sponsor as fee payer.
   - Partial-sign as sponsor/rent payer only.
   - Return serialized transaction, blockhash metadata, quote, and expiry.

4. Add typed submit route.
   - Accept signed serialized transaction.
   - Decode and validate program IDs, accounts, fee payer, buyer signer, USDC transfer amount, listing PDA, mint, and purchase instruction.
   - Reject unknown instructions or inflated sponsor reimbursement.
   - Submit and return signature/status.

5. Add `purchase_skill` rent payer support.
   - Change account constraints so `rent_payer` pays the `Purchase` PDA and purchase-time reward-vault creation.
   - Keep buyer authority over USDC transfers.
   - Update tests for direct buyer-as-rent-payer and sponsor-as-rent-payer.
   - Regenerate IDL and clients.

6. Wire web purchase UI.
   - Use sponsored prepare/submit when feature-enabled and wallet supports partial signing.
   - Show exact setup fee before wallet prompt.
   - Keep existing verification and entitlement logic after confirmation.
   - Fall back cleanly to direct wallet-paid purchase.

7. Smoke on devnet.
   - Use a buyer wallet with USDC and effectively no SOL.
   - Purchase a protocol-listed paid skill.
   - Verify the purchase PDA exists.
   - Verify USDC split matches existing purchase economics.
   - Verify sponsor reimbursement is at or below the quoted cap.
   - Verify raw download unlocks through the existing API.

8. Decide Kora follow-up.
   - If the native flow works, move production relayer concerns back into `.agents/plans/kora-usdc-fee-abstraction.plan.md`.
   - If the native flow fails because validation, signer custody, or fee pricing is too much bespoke infrastructure, promote Kora earlier.

## Invariants

- Buyer signs and authorizes all USDC movement from buyer-owned token accounts.
- Sponsor pays only transaction fees and expected checkout rent.
- Sponsor reimbursement is explicit, capped, displayed, and signed by the buyer.
- A sponsored transaction cannot call arbitrary programs or AgentVouch instructions.
- The fallback direct path remains functional.
- No docs or UI claim "no SOL" for flows that still charge rent to the user.
- If the transaction reverts, no purchase entitlement is recorded.

## Verification

Plan-only changes:

```bash
git diff --check
```

After Anchor purchase rent-payer changes:

```bash
NO_DNA=1 anchor build
cp target/idl/agentvouch.json web/agentvouch.json
npm run generate:client
NO_DNA=1 anchor test
npm run build --workspace @agentvouch/web
git diff --check
```

After web/API sponsored checkout changes:

```bash
npm run test --workspace @agentvouch/web
npm run build --workspace @agentvouch/web
git diff --check
```

Devnet acceptance test:

- buyer wallet starts with enough USDC and insufficient SOL to pay purchase rent/fee.
- sponsored checkout completes.
- purchase verification records entitlement.
- raw content download succeeds with the existing signed-auth flow.
- sponsor USDC reimbursement is reconciled against the quote.

## Rollout

1. Local/devnet only.
2. Hidden feature flag and one smoke listing.
3. Preview deployment with low-balance sponsor wallet.
4. Expand to devnet paid marketplace listings after repeated clean smokes.
5. Only then decide whether Kora becomes the production relayer/paymaster implementation.

## Rollback

- Disable `AGENTVOUCH_SPONSORED_CHECKOUT_ENABLED`.
- Keep direct wallet-paid checkout unchanged.
- If the Anchor rent-payer interface regresses, use the normal devnet clean-break process before claiming the sponsored path is live.
- Do not update `web/public/skill.md` to advertise sponsored checkout until rollback is tested.

## Blockers / Open Questions

- Which server quote source should be used for SOL/USDC during devnet: static env, operator-updated env, or external API?
- Should setup fees be absorbed for curated launch-backed skills?
- Who receives rent refunds for sponsor-paid checkout accounts if close paths are added later?
- Should the sponsor reimbursement go to protocol treasury, a dedicated sponsor USDC ATA, or a Kora-compatible fee account for later migration?
- Can the current transaction helper safely handle server-partial-signed transactions, or should sponsored checkout use a separate helper to avoid weakening the direct path?
