---
name: Milestone 9 Database Cutover
overview: Plan the v0.2.0 database cutover around a fresh Neon branch/database, preserving selected durable repo data while avoiding legacy purchase and entitlement carryover. The plan keeps current idempotent bootstrap code intact and adds a runbook/scripted path for inventory, selective migration, Vercel env cutover, smoke tests, and rollback.
todos:
  - id: m9-inventory
    content: Inventory current DB tables and classify rows for migrate/archive/drop
    status: completed
  - id: m9-new-db
    content: Create or configure the fresh v0.2.0 Neon branch/database and bootstrap schema
    status: completed
  - id: m9-migration-script
    content: Add a selective export/import runbook or script for approved durable rows
    status: completed
  - id: m9-preview-smoke
    content: Point preview/local env to the new DB and smoke core APIs and entitlement flows
    status: completed
  - id: m9-prod-cutover
    content: Document and execute production DATABASE_URL cutover with rollback steps
    status: completed
  - id: m9-verify
    content: Run build, targeted tests, API curls, and SQL sanity checks against the new DB
    status: completed
isProject: false
---

# Milestone 9: Database Cutover

## Goal
Move `v0.2.0` onto a clean database branch or database while preserving the current DB as archive/rollback. Avoid adding parallel `*_v2` tables or long-lived API branching.

## Current Patterns To Use
- Schema bootstrap is application-driven in [`/Users/andysustic/Repos/agent-reputation-oracle/web/lib/db.ts`](/Users/andysustic/Repos/agent-reputation-oracle/web/lib/db.ts), not Prisma migrations.
- Receipt/entitlement bootstrap and upsert behavior live in [`/Users/andysustic/Repos/agent-reputation-oracle/web/lib/usdcPurchases.ts`](/Users/andysustic/Repos/agent-reputation-oracle/web/lib/usdcPurchases.ts).
- The roadmap entry is now in [`/Users/andysustic/Repos/agent-reputation-oracle/docs/USDC_NATIVE_MIGRATION.md`](/Users/andysustic/Repos/agent-reputation-oracle/docs/USDC_NATIVE_MIGRATION.md).
- Root scripts already include `build:web`, `test:web`, and Vercel dependency support in [`/Users/andysustic/Repos/agent-reputation-oracle/package.json`](/Users/andysustic/Repos/agent-reputation-oracle/package.json).

## Plan
1. Inventory old DB data without migrating anything yet:
   - Count and sample `skills`, `skill_versions`, `api_keys`, local agent identity/profile cache tables, `usdc_purchase_receipts`, and `usdc_purchase_entitlements`.
   - Classify rows as `migrate`, `archive-only`, or `drop`.
   - Default: migrate selected repo skills and versions only; do not migrate old devnet purchases, receipts, or entitlements.

2. Create the v0.2.0 DB target:
   - Create a fresh Neon branch or fresh database.
   - Pull/set a preview `DATABASE_URL` that points to the new DB.
   - Boot the app or run a small bootstrap command that calls `initializeDatabase()` and `ensureUsdcPurchaseSchema()` against the new DB.

3. Add a selective migration runbook or script:
   - Prefer a small one-off script under `scripts/` or `web/scripts/` that exports/imports selected tables.
   - Preserve `skills.id` and `skill_versions.skill_id` for chosen repo skills so URLs and versions stay stable.
   - Rewrite or validate protocol metadata fields: `chain_context`, `on_chain_protocol_version`, `on_chain_program_id`, `price_usdc_micros`, `currency_mint`, and `on_chain_address`.
   - Explicitly exclude `usdc_purchase_receipts` and `usdc_purchase_entitlements` unless the inventory gate says otherwise.

4. Verify the new DB before production cutover:
   - Start the web app with the new preview DB.
   - Smoke `/api/skills`, `/api/skills/[id]`, `/api/skills/activity`, `/api/x402/supported`, publish/listing link, direct purchase verify, and raw download entitlement behavior.
   - Confirm no old entitlement grants access in the new DB.

5. Cut over Vercel envs:
   - Point preview first, then production `DATABASE_URL` to the new DB.
   - Keep the old DB credentials archived but inactive.
   - Document the exact Neon branch/database names and Vercel env scopes used.

6. Rollback path:
   - Restore production `DATABASE_URL` to the old DB if smoke fails.
   - Roll public metadata/write flags back together, not piecemeal.
   - Keep old DB read-only during the cutover window.

## Verification
- `npm run build --workspace @agentvouch/web`
- `npm run test --workspace @agentvouch/web -- __tests__/api/skills-route.test.ts __tests__/api/skills-raw.test.ts __tests__/api/skills-purchase-verify.test.ts __tests__/api/x402-supported.test.ts`
- `curl -s http://localhost:3000/api/skills | jq '.skills[:3]'`
- `curl -s http://localhost:3000/api/x402/supported | jq`
- Optional SQL checks against the new DB: counts by table, sampled `skills` protocol metadata, zero migrated legacy receipt/entitlement rows unless explicitly approved.