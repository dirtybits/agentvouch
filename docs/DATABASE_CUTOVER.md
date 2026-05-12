# Database Cutover Runbook

This runbook covers the `v0.2.0` database cutover for AgentVouch.

Use a fresh Neon branch or database for `v0.2.0`. Keep the current database as a read-only archive and rollback target. Do not create long-lived `*_v2` tables in the old database.

## Policy

- Migrate selected repo-backed skills and their versions by default.
- Optionally migrate local agent identity cache rows if they are still useful.
- Optionally migrate API keys only if existing keys should survive cutover.
- Do not migrate `usdc_purchase_receipts` or `usdc_purchase_entitlements` by default.
- Do not commit database URLs, export files, or `.env.local` files.

## Environment Variables

Use shell-only env vars for cutover commands:

```bash
export DATABASE_URL='<old database url>'
export TARGET_DATABASE_URL='<new v0.2.0 database url>'
```

`DATABASE_URL` is the source for inventory/export unless a command documents otherwise. `TARGET_DATABASE_URL` is the target for bootstrap/import.

For Vercel, update project environment variables in this order:

1. Preview `DATABASE_URL`
2. Production `DATABASE_URL`

Use the Vercel dashboard or CLI. If using CLI, pipe values from a secure local source and do not echo secrets into logs.

```bash
vercel env ls preview
vercel env ls production
```

## 1. Inventory Current DB

Run a read-only inventory against the old database:

```bash
DATABASE_URL="$OLD_DB" \
  npm run db:cutover --workspace @agentvouch/web -- \
  inventory --out db-inventory.json
```

Review:

- counts for `skills`, `skill_versions`, `agents`, `agent_identity_bindings`, `api_keys`
- counts for `usdc_purchase_receipts` and `usdc_purchase_entitlements`
- sampled skill protocol metadata

Classification:

- `migrate`: selected repo-backed skills and versions
- `optional`: `agents`, `agent_identity_bindings`, `api_keys`
- `archive-only`: receipts and entitlements
- `drop-by-default`: old devnet purchase and entitlement state

## 2. Bootstrap New DB

Create the fresh Neon branch or database, then bootstrap the schema:

```bash
TARGET_DATABASE_URL="$NEW_DB" \
  npm run db:cutover --workspace @agentvouch/web -- bootstrap
```

This runs:

- `initializeDatabase()`
- `ensureUsdcPurchaseSchema()`
- `ensureAgentIdentitySchema()`

Then run a sanity check:

```bash
DATABASE_URL="$NEW_DB" \
  npm run db:cutover --workspace @agentvouch/web -- sanity
```

## 3. Export Durable Rows

Default export includes skills and versions only. Filter to the approved durable rows with `--skill-id` and `--author` as needed:

```bash
DATABASE_URL="$OLD_DB" \
  npm run db:cutover --workspace @agentvouch/web -- \
  export --out db-cutover-export.json --skill-id frontenddesign
```

If the inventory review approves all current repo skills, omit the filters.

Include local agent identity cache if approved:

```bash
DATABASE_URL="$OLD_DB" \
  npm run db:cutover --workspace @agentvouch/web -- \
  export --out db-cutover-export.json --include-agents
```

Include API keys only if approved:

```bash
DATABASE_URL="$OLD_DB" \
  npm run db:cutover --workspace @agentvouch/web -- \
  export --out db-cutover-export.json --include-agents --include-api-keys
```

Export never includes receipts or entitlements.

## 4. Import Into New DB

```bash
TARGET_DATABASE_URL="$NEW_DB" \
  npm run db:cutover --workspace @agentvouch/web -- \
  import --file db-cutover-export.json
```

Import clears `usdc_purchase_receipts` and `usdc_purchase_entitlements` on the target before inserting durable rows. This matters when the Neon/Vercel integration auto-branches from an existing database that already contains old receipt state.

Run sanity again:

```bash
DATABASE_URL="$NEW_DB" \
  npm run db:cutover --workspace @agentvouch/web -- sanity --expect-clean-purchases
```

Expected:

- selected skills and versions exist
- protocol-listed skills have complete protocol metadata
- receipt and entitlement counts are zero unless deliberately migrated outside this runbook

## 5. Preview Smoke

Point Vercel Preview `DATABASE_URL` to the new DB first.

For local smoke, run the app with the new DB:

```bash
DATABASE_URL="$NEW_DB" npm run dev --workspace @agentvouch/web
```

Smoke:

```bash
curl -s http://localhost:3000/api/skills | jq '.skills[:3]'
curl -s http://localhost:3000/api/skills/activity | jq
curl -s http://localhost:3000/api/x402/supported | jq
```

Manual flows:

- publish a repo-backed skill
- link an on-chain listing
- verify direct purchase entitlement through `/api/skills/{id}/purchase/verify`
- signed raw download with `X-AgentVouch-Auth`
- confirm old entitlements do not unlock paid content

## 6. Production Cutover

Before cutover:

- save old production `DATABASE_URL` in a secure password manager
- confirm preview smoke passed
- confirm public metadata and write flags are ready to cut together

Cutover:

1. Update Production `DATABASE_URL` to the new DB.
2. Redeploy or trigger a production deployment so serverless functions pick up the new env.
3. Run the same smoke checks against production.

Production smoke:

```bash
curl -s https://agentvouch.xyz/api/skills | jq '.skills[:3]'
curl -s https://agentvouch.xyz/api/skills/activity | jq
curl -s https://agentvouch.xyz/api/x402/supported | jq
```

## Rollback

If production smoke fails:

1. Restore Production `DATABASE_URL` to the old DB.
2. Roll back public metadata and write flags together.
3. Redeploy production.
4. Confirm production APIs are reading the old DB again.

Do not partially roll forward docs, manifests, or write paths while the DB is rolled back.

## Executed Cutover: v0.2.0 Branch DB

Cutover executed on 2026-05-05.

- Vercel project: `dirtybitsofficials-projects/agentvouch`
- Preview branch scope: `feat/usdc-native-v0.2.0`
- Source production DB host before cutover: `ep-quiet-moon-akkdsgnm-pooler.c-3.us-west-2.aws.neon.tech`
- Target v0.2.0 DB host: `ep-young-poetry-akcybu0s-pooler.c-3.us-west-2.aws.neon.tech`
- Target database name: `neondb`
- Production envs updated: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`
- Production env values were added as sensitive Vercel env vars.
- Production redeploy completed and aliased to `www.agentvouch.xyz`.

Rollback source values were pulled to a local temp file during cutover and must not be committed. If rollback is needed, restore the old production `DATABASE_URL` and `DATABASE_URL_UNPOOLED`, then redeploy production.
