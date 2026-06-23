---
name: Milestone 8 API x402 Entitlements
overview: "Align API, x402, receipts, entitlements, and direct purchase indexing with the USDC-native v0.2.0 protocol. Direct purchase_skill remains the canonical protocol-visible paid purchase path unless the x402 settlement bridge POC passes."
todos:
  - id: m8-schema
    content: Add protocol metadata and receipt audit schema for skills, USDC receipts, and entitlements
    status: completed
  - id: m8-direct-verify
    content: Add a direct purchase verification endpoint that turns confirmed v0.2.0 purchase_skill transactions into download entitlements
    status: completed
  - id: m8-api-read-paths
    content: Update skill API read paths, signed download checks, and activity feeds to use protocol metadata and direct-purchase entitlements
    status: completed
  - id: m8-x402-gating
    content: Make /api/x402/supported fail-closed for protocol-listed paid skills unless bridge support is explicitly enabled
    status: completed
  - id: m8-bridge-poc
    content: Build and document the x402 bridge POC decision path without enabling protocol-listed x402 by default
    status: completed
  - id: m8-wallet-ui
    content: Gate browser x402 by wallet capability and route unsupported wallets to direct purchase or agent/API fallback
    status: completed
  - id: m8-observability-tests
    content: Add logging/tests for entitlement writes, verification failures, x402 support metadata, and raw download access
    status: completed
  - id: m8-verify
    content: Run Milestone 8 grep, targeted tests, and npm run build --workspace @agentvouch/web
    status: completed
isProject: false
---

# Milestone 8: API, x402, And Entitlements Alignment

## Scope
- Target API and commerce files from `docs/USDC_NATIVE_MIGRATION.md`: `web/app/api/skills/route.ts`, `web/app/api/skills/[id]/route.ts`, `web/app/api/skills/[id]/raw/route.ts`, `web/app/api/x402/supported/route.ts`, `web/lib/usdcPurchases.ts`, `web/lib/x402.ts`, and `web/lib/browserX402.ts`.
- Add schema support through the repo's current idempotent SQL bootstrap pattern in `web/lib/db.ts` and `web/lib/usdcPurchases.ts`; there is no Prisma schema in this repo.
- Keep direct `purchase_skill` as the canonical protocol-visible paid purchase path for v0.2.0.
- Keep x402 available for repo-only/off-chain entitlements, but fail closed for protocol-listed paid skills until the bridge POC passes.
- Do not edit `docs/USDC_NATIVE_MIGRATION.md` during implementation unless the x402 bridge POC result or another durable protocol decision changes.

## Implementation Plan
1. Normalize protocol metadata and receipt schema:
   - Add `skills.on_chain_protocol_version` and `skills.on_chain_program_id`.
   - Backfill linked v0.2.0 rows from the generated `AGENTVOUCH_PROGRAM_ADDRESS` and current chain context.
   - Add a unique partial index on `(chain_context, on_chain_program_id, on_chain_address)` where `on_chain_address IS NOT NULL`.
   - Add receipt audit fields: `payment_flow`, nullable `protocol_version`, nullable `on_chain_program_id`, nullable `chain_context`, nullable `on_chain_address`, and any direct purchase signature/reference fields needed for idempotency.
   - Keep `payment_tx_signature` globally unique and keep entitlement identity as `(skill_db_id, buyer_pubkey)`.
   - Mark existing receipt rows as legacy/off-chain x402 where they lack protocol metadata.

2. Add direct purchase verification:
   - Add a route such as `POST /api/skills/[id]/purchase/verify`.
   - Request body should include the confirmed transaction signature and, optionally, buyer/listing hints for clearer errors.
   - Verify against configured RPC: transaction exists, succeeded, references the v0.2.0 program id, matches configured chain context, and is not already recorded under a conflicting skill/buyer.
   - Verify on-chain state with generated client helpers: listing address belongs to the skill row, purchase PDA exists for `(buyer, listing)`, purchase buyer/listing/price match, listing price/mint/program metadata match, and transaction signature is consistent with the purchase.
   - Record a receipt and entitlement through a shared helper using `payment_flow = "direct-purchase-skill"` and `protocol_version = "v0.2.0"`.
   - Make the browser purchase flow submit the returned `purchase_skill` signature after wallet confirmation so raw downloads unlock without relying on x402.

3. Update API read and download paths:
   - Return protocol metadata in `/api/skills`, `/api/skills/[id]`, `/api/skills/[id]/update`, and activity payloads.
   - Treat `price_usdc_micros` plus `on_chain_address` as protocol-listed paid skill metadata, not automatically as x402-primary.
   - In `raw/route.ts`, check direct-purchase entitlements for protocol-listed paid skills before requiring any x402 payment.
   - Preserve `buildDownloadRawMessage` exactly; only the listing value changes to the v0.2.0 listing address.
   - Keep repo-only/off-chain USDC x402 entitlement writes working for skills that are explicitly not protocol-visible.

4. Gate `/api/x402/supported`:
   - Remove the legacy SOL asset advertisement from the public supported response.
   - Advertise protocol-listed x402 bridge support only behind an explicit capability/feature flag after the POC passes.
   - When disabled, return capability metadata that says protocol-listed paid skills require direct `purchase_skill` and x402 is limited to repo-only/off-chain entitlement flows.
   - Include chain context, program id, configured USDC mint, facilitator URL, and bridge status so agents can decide the correct payment path.

5. Define and run the x402 bridge POC decision path:
   - Build a local script/test harness that attempts exact USDC x402 settlement into the intended protocol settlement vault pattern.
   - Test PDA/off-curve owner compatibility, deterministic memo binding, payer extraction, idempotent payment references, mint/amount checks, and retry/refund failure handling.
   - Keep this POC non-production: do not enable `settle_x402_purchase` or protocol-listed x402 support unless all pass criteria from the roadmap are met.
   - If the POC fails, document the failure reason and keep `/api/x402/supported` fail-closed for protocol-listed paid skills.

6. Gate browser wallet support:
   - Add wallet capability detection for browser x402 split-signature support.
   - Route wallets without required partial-signing support, including Phantom embedded/send-only cases, to direct `purchase_skill` checkout or agent/API fallback copy.
   - Keep UI copy aligned with Milestone 7: USDC primary, SOL only for fees/rent/legacy context.

7. Add observability and tests:
   - Log direct purchase verification failures with reason, chain context, program id, listing, buyer, and signature when safe.
   - Log entitlement write/upsert outcomes and x402 bridge-disabled responses.
   - Add unit/source tests for schema bootstrap, receipt/entitlement upserts, direct verification helper behavior, `/api/x402/supported` gating, and raw download entitlement access.
   - Add a reconciliation design or gated endpoint for missed direct purchases; implementation can be minimal if the indexer is not ready, but the API shape and safety checks should be explicit.

## Verification
- `rg "legacy-sol|purchaseSkill|hasOnChainPurchase|x402-usdc" web/app/api web/lib web/app/skills`
- Targeted tests for `web/lib/usdcPurchases.ts`, `web/lib/x402.ts`, raw skill downloads, and `/api/x402/supported`.
- `npm run build --workspace @agentvouch/web`

## Notes
- Milestone 8 should not require an Anchor build unless the bridge POC intentionally adds or syncs a new `settle_x402_purchase` instruction.
- Schema changes should be idempotent because production/local bootstrap currently runs from application code rather than Prisma migrations.
- If implementation uncovers a durable decision change, update `docs/USDC_NATIVE_MIGRATION.md` after the decision, not as a running task tracker.
