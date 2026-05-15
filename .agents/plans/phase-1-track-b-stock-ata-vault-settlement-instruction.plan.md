---
name: phase-1-track-b-stock-ata-vault-settlement-instruction
overview: "Implement the stock @x402/svm-compatible settlement vault shape plus settle_x402_purchase and generated client support for Phase 1 Track B."
todos:
  - id: confirm-devnet-reset-boundary
    content: Confirm fresh devnet Program ID and DB cleanup are acceptable before changing config/vault shape.
    status: completed
  - id: update-settlement-vault-shape
    content: Change config initialization so x402_settlement_vault is the USDC ATA owned by x402_settlement_vault_authority.
    status: completed
  - id: add-x402-receipt-state
    content: Add x402 settlement receipt and signature guard PDAs for idempotent bridge settlement.
    status: completed
  - id: add-settle-x402-purchase
    content: Add settle_x402_purchase guarded by settlement_authority with purchase_skill-equivalent economics.
    status: completed
  - id: regenerate-anchor-clients
    content: Rebuild the Anchor IDL, sync web/agentvouch.json, and regenerate TypeScript clients.
    status: completed
  - id: verify-program-and-web
    content: Run Anchor, generated-client, web tests, bridge POC, and production build checks.
    status: completed
isProject: true
---

# Phase 1 Track B: Stock ATA Vault + Settlement Instruction

## Goal

Make the x402 bridge compatible with stock `@x402/svm` exact settlement while preserving the AgentVouch protocol path. x402 should pay a protocol-controlled USDC associated token account, then `settle_x402_purchase` should create normal purchase state and route author/voucher proceeds exactly like `purchase_skill`.

## Scope

- In scope: devnet reset decision, settlement vault account shape, on-chain receipt/idempotency state, `settle_x402_purchase`, generated clients, and verification.
- Out of scope: raw route bridge API wiring, DB entitlement persistence, CLI install flow, production flag enablement, and custom x402 facilitator schemes. Those remain in the parent Track B plan after the program surface is proven.

## Decision Context

The 2026-05-15 settlement destination POC proved:

- `@x402/svm` version `2.10.0` creates exact SVM payments whose transfer destination is `ATA(owner: paymentRequirements.payTo, mint: paymentRequirements.asset)`.
- The stock facilitator rejects payloads whose destination is not the ATA for `requirements.payTo`.
- The pre-reset devnet config stored `x402_settlement_vault = EQvu7FMSuzdBDtJ1HUNxn7F4RBg6wENgaXJKkfC9ENYF`, a custom PDA token account.
- `payTo = configured vault`, `payTo = x402_settlement_vault_authority`, and `payTo = settlement_authority` all derive different ATAs, so the current custom vault cannot be credited by the stock exact SVM path.

Decision: change the protocol settlement vault to the USDC ATA owned by `x402_settlement_vault_authority`, and do it on a fresh devnet Program ID/config rather than migrating stale PDAs.

## Implementation Result — 2026-05-15

Completed locally:

- `initialize_config` now initializes `x402_settlement_vault` as the USDC associated token account owned by `x402_settlement_vault_authority`.
- Added `X402SettlementReceipt` and `X402SettlementSignatureGuard` state.
- Added `settle_x402_purchase`, guarded by `config.settlement_authority`.
- The instruction transfers from the protocol x402 settlement vault into author proceeds and author reward vaults using the same split logic as `purchase_skill`.
- Added Anchor tests for x402 voucher economics and settlement amount mismatch rejection.
- Regenerated `target/idl`, `target/types`, `web/agentvouch.json`, and `web/generated/agentvouch`.

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

Fresh devnet has since been reset to Program ID `AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg` with config `8RQ1ySTxbmsYwcnucZZ4VgYg5pzwEbmBreEKJHLfdgha` and x402 settlement vault ATA `3Z7VPVVA4ehG7hcsdGbKJcZgvAfPNbSSbFGJCyEFbzdr`. `npm run x402:bridge-poc --workspace @agentvouch/web -- --strict` now reports `currentVaultCompatible: true`.

## Files To Change

- `programs/agentvouch/src/instructions/initialize_config.rs`: replace the custom seeded `x402_settlement_vault` token account with the associated token account for `x402_settlement_vault_authority` and the configured USDC mint.
- `programs/agentvouch/src/state/config.rs`: keep `ReputationConfig.x402_settlement_vault` as the configured token-account address; no field shape change is expected.
- `programs/agentvouch/src/state/mod.rs`: export new receipt/signature guard state.
- `programs/agentvouch/src/state/x402_settlement.rs`: add `X402SettlementReceipt` and `X402SettlementSignatureGuard`, or equivalent names with the same responsibilities.
- `programs/agentvouch/src/instructions/settle_x402_purchase.rs`: add the bridge settlement instruction.
- `programs/agentvouch/src/instructions/mod.rs`, `programs/agentvouch/src/lib.rs`: expose the instruction and its args.
- `programs/agentvouch/src/events.rs`: add `X402PurchaseSettled`.
- `programs/agentvouch/src/errors.rs` or local instruction errors: add settlement-specific failures for amount, mint, authority, duplicate receipt, duplicate signature, and vault mismatch.
- `programs/agentvouch/tests/*`: cover settlement authority, duplicate protections, price/mint checks, voucher split, no-voucher split, and purchase state.
- `target/idl/agentvouch.json`, `target/types/agentvouch.ts`, `web/agentvouch.json`, `web/generated/agentvouch/`, `packages/agentvouch-protocol/src/index.{ts,js,d.ts}`: regenerate/sync after Anchor changes.
- `web/lib/x402BridgePoc.ts`, `web/scripts/x402-bridge-poc.ts`: update the POC expectation so the configured vault must equal the ATA for `x402_settlement_vault_authority`.

## Implementation Steps

1. Confirm the devnet reset boundary.
   - Use a fresh devnet Program ID before deploying this config/vault shape change.
   - Plan DB cleanup for stale rows tied to the old Program ID: old `skills.on_chain_address`, `skills.on_chain_program_id`, `usdc_purchase_receipts`, `usdc_purchase_entitlements`, and persisted profile/listing bindings.
   - Keep `AGENTVOUCH_X402_PROTOCOL_BRIDGE_ENABLED=false` throughout this plan.

2. Update the x402 settlement vault shape.
   - Keep `x402_settlement_vault_authority` as the PDA at seed `[b"x402_settlement_vault_authority"]`.
   - Initialize `x402_settlement_vault` as the ATA for `(owner = x402_settlement_vault_authority, mint = usdc_mint)`.
   - Add the Anchor associated token program account to `InitializeConfig`.
   - Store the ATA address in `config.x402_settlement_vault`.
   - Remove reliance on the generated `findX402SettlementVaultPda` helper for the configured vault after client regeneration.

3. Add x402 settlement idempotency state.
   - Add `X402SettlementReceipt` PDA with seeds similar to `[b"x402_settlement_receipt", payment_ref_hash]`.
   - Store `payment_ref_hash`, `settlement_tx_signature_hash`, `buyer`, `skill_listing`, `purchase`, `listing_revision`, `listing_settlement`, `amount_usdc_micros`, `author_share_usdc_micros`, `voucher_pool_usdc_micros`, `settled_at`, and `bump`.
   - Add a second guard PDA with seeds similar to `[b"x402_settlement_signature", settlement_tx_signature_hash]` so one settled transaction cannot be replayed under a new payment ref.
   - Treat hashes as `[u8; 32]` instruction args, with raw memo/signature parsing handled off-chain by the backend bridge.

4. Add `settle_x402_purchase`.
   - Args: `payment_ref_hash: [u8; 32]`, `settlement_tx_signature_hash: [u8; 32]`, `buyer: Pubkey`, and `amount_usdc_micros: u64`.
   - Signer: `settlement_authority`, constrained to `config.settlement_authority`.
   - Source funds: `config.x402_settlement_vault`, constrained to USDC mint and owner `x402_settlement_vault_authority`.
   - Destination funds: the active listing settlement author proceeds vault and author reward vault.
   - Purchase PDA seeds must match `purchase_skill`: `[b"purchase", buyer, skill_listing, current_revision]`.
   - Economic logic must match `purchase_skill`: if external vouch stake exists, split by `author_share_bps`/`voucher_share_bps`; otherwise send the full price to author proceeds.
   - Require `amount_usdc_micros >= skill_listing.price_usdc_micros`, active listing status, unlocked settlement, valid listing settlement, valid USDC mint/token program, and nonzero paid price.
   - Transfer only `price_usdc_micros` into protocol economics. Any overpayment policy should be explicit before bridge enablement; the safest first implementation rejects overpayment unless the backend already normalizes exact amount.
   - Create the normal `Purchase` PDA and the x402 receipt/guard PDAs in the same instruction.
   - Emit `X402PurchaseSettled` with listing, buyer, purchase, payment ref hash, settlement tx signature hash, price, author share, voucher pool, listing revision, settlement, destination vaults, and timestamp.

5. Keep shared purchase accounting aligned.
   - Avoid drift between `purchase_skill` and `settle_x402_purchase`; extract a small internal helper only if it keeps account mutation clear and avoids broad refactors.
   - Update `SkillListing`, `AgentProfile`, and `ListingSettlement` counters exactly as `purchase_skill` does.
   - Initialize/update `author_profile.reward_vault` the same way direct purchases do.

6. Regenerate and sync clients.
   - Run `NO_DNA=1 anchor build`.
   - Copy `target/idl/agentvouch.json` to `web/agentvouch.json`.
   - Run `npm run generate:client`.
   - Check generated PDA helpers and initialize-config account names; update scripts that still expect `findX402SettlementVaultPda`.

## Verification

- Anchor/program:
  ```bash
  NO_DNA=1 anchor build
  NO_DNA=1 anchor test
  ```

- Generated clients and web:
  ```bash
  npm run generate:client
  npm run test --workspace @agentvouch/web
  npm run build --workspace @agentvouch/web
  npm run x402:bridge-poc --workspace @agentvouch/web
  ```

- Static checks:
  ```bash
  rg "settle_x402_purchase|X402PurchaseSettled|x402_settlement_receipt|x402_settlement_signature" programs web packages docs
  rg "findX402SettlementVaultPda" web packages scripts
  ```

- Acceptance criteria:
  - Fresh config stores `x402_settlement_vault = ATA(owner: x402_settlement_vault_authority, mint: USDC)`.
  - Bridge POC reports the configured vault is compatible with stock `@x402/svm`.
  - `settle_x402_purchase` creates a normal `Purchase` PDA for the x402 payer.
  - Duplicate `payment_ref_hash` and duplicate `settlement_tx_signature_hash` are both rejected.
  - Voucher-backed purchases fund the author reward vault and update voucher revenue indexes.
  - Purchases with no external vouch stake route the full price to author proceeds.
  - `AGENTVOUCH_X402_PROTOCOL_BRIDGE_ENABLED=false` still prevents API-level bridge exposure.

## Rollout

1. Keep this work on devnet only.
2. Cut the fresh Program ID and initialize fresh config with the ATA x402 settlement vault. Completed 2026-05-15.
3. Run the bridge POC before wiring `/api/skills/{id}/raw`. Completed 2026-05-15.
4. Only after the POC and program tests pass, return to the parent Track B plan for API, DB, CLI, and docs wiring.

## Rollback

- If the fresh Program ID deployment fails, keep the current deployed Program ID and Vercel env unchanged.
- If the instruction compiles but the POC still cannot credit the configured vault, do not wire the bridge API; revisit the x402 scheme or facilitator assumptions.
- If generated clients destabilize the web build, revert only the generated/client-facing changes from this plan and keep the parent Track B feature flag disabled.
- Do not grant paid raw entitlements from x402 bridge attempts unless a `Purchase` PDA and x402 receipt PDA both exist.

## Blockers

- Fresh devnet Program ID/reset approval is required before deploying config-shape changes.
- Settlement authority key management must be finalized before any non-devnet funds are accepted.
- The backend retry/refund policy for "x402 settled but program settlement failed" must be defined before enabling the raw route bridge.
- Mainnet remains out of scope until the bridge has a proven devnet run with voucher reward claims.
