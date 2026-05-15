---
name: phase-1-track-b-x402-settlement-bridge
overview: "Restore frictionless x402 for protocol-listed paid skills through a settlement bridge that creates purchase state and preserves author/voucher economics."
todos:
  - id: prove-settlement-destination
    content: Prove whether stock @x402/svm exact payments can credit the intended protocol settlement destination.
    status: completed
  - id: choose-vault-design
    content: Choose the bridge settlement account design before adding program or API implementation.
    status: completed
  - id: add-settlement-instruction
    content: Add settle_x402_purchase, receipt state, events, and generated client support after the destination POC passes.
    status: completed
  - id: fresh-devnet-reset
    content: Deploy the fresh Track B devnet Program ID and initialize config with the stock-compatible x402 settlement vault ATA.
    status: completed
  - id: wire-bridge-api
    content: Add the /api/skills/{id}/raw x402 bridge path behind AGENTVOUCH_X402_PROTOCOL_BRIDGE_ENABLED.
    status: pending
  - id: record-bridge-entitlements
    content: Persist bridge receipts and entitlements only after both x402 settlement and on-chain settlement succeed.
    status: pending
  - id: update-agent-facing-surfaces
    content: Update /api/x402/supported, public docs, CLI, and web behavior for bridge-enabled protocol-listed skills.
    status: pending
  - id: verify-track-b
    content: Run Anchor, generated client, web, CLI, build, and devnet bridge smoke checks.
    status: pending
isProject: true
---

# Phase 1 Track B: x402 Settlement Bridge

## Goal

Keep x402 as the frictionless agent-facing payment envelope while preserving AgentVouch protocol economics. An agent can request `/api/skills/{id}/raw`, pay through x402, and have the backend settle that payment into the same on-chain purchase path used by `purchase_skill`.

## Scope

- In scope: x402 settlement destination POC, bridge vault/account design, `settle_x402_purchase`, generated clients, raw route bridge flow, facilitator verification, DB bridge receipts/entitlements, docs, tests, and devnet smoke.
- Out of scope: repo-only direct x402 for new paid marketplace purchases, Stripe, fiat onramp, mainnet launch, and Phantom embedded paid checkout as an acceptance path.
- This plan starts only after Track A disables new repo-only paid x402 purchases.

## Current State

- `purchase_skill` is the only current path that creates `Purchase` PDA state, author proceeds accounting, voucher rewards, and refund/dispute semantics.
- `ReputationConfig` already stores `settlement_authority` and `x402_settlement_vault`.
- The local Track B implementation changes `initialize_config` so `x402_settlement_vault` is the USDC ATA owned by `x402_settlement_vault_authority`.
- The local Track B implementation adds `settle_x402_purchase`, `X402SettlementReceipt`, and `X402SettlementSignatureGuard`.
- Fresh devnet is now on Program ID `AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg` with config `8RQ1ySTxbmsYwcnucZZ4VgYg5pzwEbmBreEKJHLfdgha`.
- The bridge remains API-disabled until `/api/skills/{id}/raw`, DB receipt persistence, and retry behavior are wired.

## Settlement destination POC result — 2026-05-15

`npm run x402:bridge-poc --workspace @agentvouch/web` completed against devnet.

- `@x402/svm` package version: `2.10.0`.
- Stock exact SVM client destination rule: `TransferChecked.destination = ATA(owner: paymentRequirements.payTo, mint: paymentRequirements.asset)`.
- Stock exact SVM facilitator validation rule: reject payloads whose `TransferChecked.destination` is not the ATA for `requirements.payTo`.
- Pre-reset AgentVouch config PDA: `BWcLtsDEaLfBhHweJo6u9kgNn47xJDpz22Q3Q8BhQFVS`.
- Configured `x402_settlement_vault`: `EQvu7FMSuzdBDtJ1HUNxn7F4RBg6wENgaXJKkfC9ENYF`.
- Custom x402 vault PDA: `EQvu7FMSuzdBDtJ1HUNxn7F4RBg6wENgaXJKkfC9ENYF`.
- x402 vault authority PDA: `FFPzNBnZgL4ncznfJMgneEPAkAvDagMcPLRGRHfHUX5Q`.
- `payTo = configured x402 vault` derives destination ATA `HWoqGSy9sb2JLQQJgJXnSSTwNW4mrwkpS423XRWBNgzq`.
- `payTo = x402 vault authority` derives destination ATA `HZfsgqBPcfgtMM7GayuFiLPfHym1i4mW3kXdgWe7xN1C`.
- `payTo = backend settlement authority` derives destination ATA `5ZkdpGwowBDyDVjBZBAZ6TuBsLNH3ae8jvdYe3cKXCsQ`.
- None of the stock x402 destinations credit the configured custom vault.

Decision: the current custom PDA token-account vault is not compatible with stock `@x402/svm` exact settlement. Track B should use a stock-compatible ATA settlement vault, preferably the ATA owned by `x402_settlement_vault_authority` for the configured USDC mint. Because this changes config/vault shape, keep the bridge disabled and use a fresh devnet Program ID/config rather than migrating stale PDAs.

Step 3 and 4 implementation details are split into `.agents/plans/phase-1-track-b-stock-ata-vault-settlement-instruction.plan.md`.

## Settlement instruction implementation result — 2026-05-15

The step 3/4 child plan has been implemented locally:

- `initialize_config` now stores a stock-compatible x402 settlement vault: the USDC ATA owned by `x402_settlement_vault_authority`.
- `settle_x402_purchase` creates the normal `Purchase` PDA for the x402 buyer and routes USDC through the same author/voucher economics as `purchase_skill`.
- `X402SettlementReceipt` and `X402SettlementSignatureGuard` PDAs provide payment-ref and settlement-signature idempotency guards.
- Generated Anchor/Web clients include the new instruction and account types.
- The bridge remains API-disabled until the fresh devnet Program ID/config and raw-route bridge are wired.

Verification completed:

```bash
NO_DNA=1 anchor build
NO_DNA=1 anchor test --skip-build
npm run generate:client
npm run x402:bridge-poc --workspace @agentvouch/web
npm run test --workspace @agentvouch/web
npm run test --workspace @agentvouch/cli
npm run lint --workspace @agentvouch/web
npm run build
git diff --check
```

## Fresh devnet Program ID/config reset — 2026-05-15

The fresh devnet reset is complete:

- Program ID: `AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg`.
- ProgramData: `KzkKz12Jbv8EYQ3iLkZepW3xpB7UwGD1r83XKYxVFQs`.
- Deploy tx: `4YgndRgBoqmBZ4jWcVc6rhomZWcjr9Td7Yg2Vh18SDQS2mUZ5kqJnFznTa5G2cwL9Ns59HJBNNku435L9cnZuoGo`.
- Config PDA: `8RQ1ySTxbmsYwcnucZZ4VgYg5pzwEbmBreEKJHLfdgha`.
- Config init tx: `4sabP2jqmF8dNqnCxrdL25NMUijSx5f6TBLcMs7qu6spwcJj5rJkPP9TJ8rjNQ6vkaZ5w24EAk2tdteAMj4sgJJp`.
- x402 settlement vault authority: `3ueLzqB5SiFLdGqGqJ55PNBffcgUqJ5iLf7pJMGrfCdj`.
- x402 settlement vault ATA: `3Z7VPVVA4ehG7hcsdGbKJcZgvAfPNbSSbFGJCyEFbzdr`.

`npm run x402:bridge-poc --workspace @agentvouch/web -- --strict` now reports the configured x402 settlement vault is compatible with stock `@x402/svm` exact settlement (`currentVaultCompatible: true`). A direct devnet USDC smoke also passed against the new Program ID, including listing creation, vouching, `purchase_skill`, and voucher revenue claim. The API bridge is still intentionally disabled.

## Files To Change

- `programs/agentvouch/src/lib.rs`, `programs/agentvouch/src/instructions/mod.rs`, `programs/agentvouch/src/instructions/settle_x402_purchase.rs`: add the bridge instruction after the destination POC passes.
- `programs/agentvouch/src/state/*`, `programs/agentvouch/src/events.rs`, `programs/agentvouch/src/errors.rs`: add receipt state, events, and validation errors.
- `programs/agentvouch/tests/*`: cover settlement authority, amount, duplicate receipt, voucher split, no-voucher split, and purchase PDA creation.
- `web/agentvouch.json`, `web/generated/agentvouch/`, `packages/agentvouch-protocol/src/index.{ts,js,d.ts}`: regenerate and sync after Anchor interface changes.
- `web/app/api/skills/[id]/raw/route.ts`: add the bridge payment-requirement and settlement path behind a feature flag.
- `web/lib/x402.ts`, `web/lib/x402BridgePoc.ts`, `web/app/api/x402/supported/route.ts`: verify facilitator behavior and advertise bridge support only when enabled.
- `web/lib/usdcPurchases.ts`, `web/lib/directPurchaseVerification.ts`: record bridge receipts and entitlements without weakening direct purchase verification.
- `packages/agentvouch-cli/src/lib/install.ts`, `packages/agentvouch-cli/src/lib/http.ts`, `packages/agentvouch-cli/src/lib/format.ts`: use or explain the bridge path for agent installs.
- `web/public/skill.md`, `web/app/docs/page.tsx`, `docs/USDC_NATIVE_MIGRATION.md`, `docs/ARCHITECTURE.md`: document bridge status and economics.

## Implementation Steps

1. Prove settlement destination compatibility.
   - Build a local/devnet POC that uses stock `@x402/svm` exact payments to settle USDC.
   - Verify the settled destination token account, payer, mint, amount, memo, and transaction success from chain data.
   - Determine whether `payTo` can cause funds to land in `config.x402_settlement_vault`.
   - Stop here if the current vault cannot be credited without bypassing facilitator verification.

2. Choose the vault/account design.
   - If stock exact-SVM can credit the current `x402_settlement_vault`, keep the existing config layout.
   - If stock exact-SVM only credits an ATA, prefer a fresh devnet program/config where `x402_settlement_vault` is that ATA owned by `x402_settlement_vault_authority`.
   - If a custom facilitator can safely pay a specific token account, document the custom scheme and verify client compatibility.
   - A temporary backend-custodied settlement account is acceptable only for POC, never as the mainnet design.
   - If the vault shape changes, prefer a fresh devnet Program ID plus DB cleanup over migrating stale PDAs.

3. Add on-chain bridge state and instruction.
   - Add `X402SettlementReceipt` with at least `payment_ref_hash`, `settlement_tx_signature`, `buyer`, `skill_listing`, `purchase`, `listing_revision`, `amount_usdc_micros`, `settled_at`, and `bump`.
   - Add `settle_x402_purchase` guarded by `config.settlement_authority`.
   - Accounts should mirror `purchase_skill` economics, but transfer from the protocol x402 settlement vault instead of the buyer USDC account.
   - Create the normal `Purchase` PDA for the x402 payer as buyer.
   - Split author/voucher proceeds exactly as `purchase_skill` does.
   - Reject duplicate `payment_ref_hash` and duplicate settlement signatures.
   - Emit an event with listing, buyer, purchase, payment ref hash, author share, voucher pool, and settlement transaction signature.

4. Regenerate clients after Anchor changes.
   - Run `NO_DNA=1 anchor build`.
   - Copy `target/idl/agentvouch.json` to `web/agentvouch.json`.
   - Run `npm run generate:client`.
   - Confirm generated files compile and do not expose unused Codama helpers to the web typecheck surface.

5. Wire the bridge API behind a feature flag.
   - Use `AGENTVOUCH_X402_PROTOCOL_BRIDGE_ENABLED=true` only in local/devnet preview after the POC passes.
   - Add `AGENTVOUCH_X402_SETTLEMENT_AUTHORITY_SECRET_KEY` for the backend signer; it must match `config.settlement_authority`.
   - Keep `FACILITATOR_URL`, `FACILITATOR_AUTH_HEADER`, `SOLANA_RPC_URL`, and `NEXT_PUBLIC_SOLANA_RPC_URL` aligned with the target cluster.
   - Require initial `X-AgentVouch-Auth` so the server can bind buyer, skill id, listing, chain context, and nonce into the x402 memo.
   - Memo format should contain only protocol references: protocol version, chain context, program id, listing PDA, skill DB id, buyer pubkey, and nonce.
   - After facilitator `/verify` and `/settle`, verify settled amount, mint, payer, memo, transaction success, and destination token account before calling `settle_x402_purchase`.
   - If x402 settles but program settlement fails, return a retryable error and persist enough metadata to retry. Do not grant entitlement yet.

6. Record bridge entitlements.
   - Add a DB payment flow such as `x402-bridge-purchase-skill` for transport-level provenance.
   - Store purchase PDA, listing revision, settlement receipt PDA, author proceeds vault, chain context, program id, protocol version, and settlement signature.
   - Grant raw download entitlement only after x402 settlement, on-chain `settle_x402_purchase`, and DB recording all succeed.
   - Treat bridge entitlements as protocol-visible purchase entitlements for signed raw downloads.

7. Update agent-facing surfaces.
   - `/api/x402/supported` should report `protocol_listed_x402_bridge: true` only when the feature flag is enabled and POC checks pass.
   - CLI/agent install can use bridge x402 once supported; otherwise explain direct purchase is required.
   - Browser UI should continue preferring direct `purchase_skill` until bridge UX is deliberately enabled.
   - Keep Phantom embedded paid checkout blocked until its hosted signing path is reliable.

## Verification

- POC checks:
  - Stock facilitator settlement lands in the intended protocol settlement destination or the plan stops for redesign.
  - Chain data confirms payer, mint, amount, memo, and destination.

- Program tests:
  - `settle_x402_purchase` creates a normal `Purchase` PDA for the x402 payer.
  - With external vouch stake, voucher pool is funded and claimable through `claim_voucher_revenue`.
  - With no external vouch stake, full payment routes to author proceeds.
  - Duplicate payment ref or settlement signature cannot create a second purchase.
  - Settlement authority mismatch is rejected.
  - Settled amount below listing price is rejected.

- API tests:
  - Bridge stays disabled unless `AGENTVOUCH_X402_PROTOCOL_BRIDGE_ENABLED=true`.
  - Missing initial `X-AgentVouch-Auth` cannot receive bridge payment requirements.
  - Facilitator success plus program failure is retryable and does not grant entitlement.
  - Facilitator success plus program success records receipt and entitlement.

- Commands:
  ```bash
  NO_DNA=1 anchor build
  npm run generate:client
  npm run test --workspace @agentvouch/web
  npm run test --workspace @agentvouch/cli
  npm run build --workspace @agentvouch/web
  rg "x402-bridge-purchase-skill|settle_x402_purchase|AGENTVOUCH_X402_PROTOCOL_BRIDGE_ENABLED" web packages programs docs
  ```

- Manual devnet smoke:
  - Agent requests `/api/skills/{id}/raw` for a protocol-listed paid skill and receives x402 requirements.
  - x402 payment settles into the protocol settlement destination.
  - Backend calls `settle_x402_purchase`.
  - Program creates purchase state, routes author/voucher proceeds, and records settlement receipt.
  - Signed raw download succeeds after bridge settlement.
  - Voucher rewards are claimable from the bridge purchase.

## Rollout

1. Complete Track A first so repo-only direct x402 is not the live paid path.
2. Run the settlement destination POC locally/devnet.
3. If a vault shape change is needed, cut a fresh devnet Program ID and reset stale devnet DB links before adding user-facing bridge support.
4. Add program/API implementation with `AGENTVOUCH_X402_PROTOCOL_BRIDGE_ENABLED=false` by default.
5. Enable the flag only in a Vercel preview for bridge smoke.
6. Promote to production devnet after purchase state, raw entitlement, author proceeds, and voucher rewards are all proven.

## Rollback

- Set `AGENTVOUCH_X402_PROTOCOL_BRIDGE_ENABLED=false` to disable bridge payment requirements immediately.
- If program changes are deployed on a fresh devnet Program ID and bridge smoke fails, switch metadata and Vercel env back to the previous Program ID or Neon branch as needed.
- If x402 settled but `settle_x402_purchase` failed, retry program settlement from persisted payment metadata.
- Do not manually grant raw entitlement unless on-chain purchase state exists.
- Keep Track A fail-closed behavior in place even if the bridge rolls back.

## Blockers

- Current `x402_settlement_vault` compatibility with stock `@x402/svm` exact destination derivation must be proven first.
- Settlement authority key management must be defined before non-devnet funds are accepted.
- Retry/refund policy for settled x402 funds with failed program settlement must exist before non-devnet rollout.
- Requiring initial `X-AgentVouch-Auth` adds one pre-payment message signature; browser UX needs testing before enabling bridge checkout for people.
- Phantom embedded paid checkout remains provider-blocked and is not an acceptance path for this bridge.
