---
name: skill-page-perf-db-rpc
overview: "Shrink the skill-page cache-MISS render cost and fix the slow list/live-trust paths: verify indexes via EXPLAIN on the LATERAL-join snapshot query, collapse the two serial Neon round-trips into one, confirm DB/function region co-location, and point prod at a real Solana RPC instead of the public devnet endpoint. Gated on confirming which Neon project is live."
todos:
  - id: confirm-live-neon-project
    content: "BLOCKER: confirm the live Neon project backing prod DATABASE_URL (expected agentvouch-postgres, NOT legacy agent-reputation-oracle) before running any SQL/EXPLAIN against it."
    status: pending
  - id: explain-analyze-snapshot-query
    content: Run EXPLAIN ANALYZE on the loadSkillDetailSnapshot query against the live DB; focus on the skill_versions laterals, the skill_scans join, and the agent_identity_bindings joins (resolver + author_trust_snapshots are already indexed).
    status: pending
  - id: add-missing-indexes
    content: For any join confirmed seq-scanning, add CREATE INDEX IF NOT EXISTS in web/lib/db.ts following the existing idempotent-DDL pattern (candidates listed in body).
    status: pending
  - id: verify-db-region-colocation
    content: Confirm the Neon region matches the Vercel function region (functions observed in iad1/us-east-1); if mismatched, move Neon or pin vercel.json regions to the DB region.
    status: pending
  - id: collapse-resolver-into-snapshot
    content: Add loadSkillDetailSnapshotBySlug(authorSlug, skillSlug) that resolves by (public_author_slug, public_slug) and returns canonical fields, so the page does one DB round-trip instead of resolve-then-load; preserve chain-skill handling. Do after EXPLAIN.
    status: pending
  - id: set-prod-solana-rpc
    content: Set SOLANA_RPC_URL (and NEXT_PUBLIC_SOLANA_RPC_URL) in Vercel prod to a paid endpoint (Helius/Triton/QuickNode); confirm no fallback to the public api.devnet.solana.com (web/lib/solanaRpc.ts).
    status: pending
  - id: profile-list-endpoints
    content: Profile /api/index/skills (~4.9s) and /api/skills (~2.0s); if the latency is on-chain RPC move to snapshot reads / add caching like /api/skills/[id]; if DB aggregation, index/optimize.
    status: pending
  - id: verify-db-rpc
    content: Re-measure — EXPLAIN shows index scans, cache-MISS skill-page render sub-400ms, and list endpoints materially faster.
    status: pending
isProject: false
---

# Skill Page Perf: DB query + Solana RPC

## Goal
Reduce the cost of the work that still runs when the skill detail page is *not* served from
the edge cache (first hit after revalidation, long-tail skills, and the live-trust path), and
fix the slow marketplace data endpoints. Target: cache-MISS skill-page render under ~400ms and
the list endpoints down from multi-second. This plan is the companion to
`skill-page-perf-isr-dedup.plan.md` (ISR + dedup + client guard) — do that one first; it
removes most of the user-visible latency and the duplicate query, leaving this plan to tackle
the per-render DB cost and the chain-RPC tail.

## Evidence (measured 2026-06-30, prod `www.agentvouch.xyz`)
- Skill-page function runs in **iad1 (us-east-1)** (`x-vercel-id: sfo1::iad1::…`).
- DB client is the Neon serverless **HTTP** driver (`@neondatabase/serverless`,
  [web/lib/db.ts:23-36](web/lib/db.ts)) — one HTTP round-trip per query, no pipelining. The page
  does two serial queries (resolve slug → id, then the snapshot), so ≥2 RTTs per render.
- The snapshot query is a single ~7-table LATERAL JOIN
  ([web/lib/skillDetailSnapshot.ts:308-413](web/lib/skillDetailSnapshot.ts)).
- Backing API latency: `/api/skills/[id]` ≈ 0.36s (fine, CDN-cacheable), but the **list**
  endpoints `/api/skills` ≈ 2.0s and `/api/index/skills` ≈ 4.9s TTFB.
- `DEFAULT_SOLANA_RPC_URL` falls back to **public `https://api.devnet.solana.com`**
  ([web/lib/solanaRpc.ts:1-4](web/lib/solanaRpc.ts)) when `SOLANA_RPC_URL`/`NEXT_PUBLIC_SOLANA_RPC_URL`
  are unset — rate-limited, 300ms-2s+ per call.

## Already indexed (verified 2026-06-30 from web/lib/db.ts) — do NOT re-add
- Resolver lookup `(public_author_slug, public_slug)`: `idx_skills_public_route` UNIQUE
  ([db.ts:885](web/lib/db.ts)) — the slug resolve is already a unique-index hit.
- Trust join `author_trust_snapshots(wallet_pubkey, chain_context)`: covered by the table PRIMARY
  KEY ([db.ts:911](web/lib/db.ts)).
So the resolver and trust joins are fast; the snapshot query's likely soft spots are elsewhere
(see EXPLAIN focus below). This tempers the expected win from indexing — the reliable DB gains
here are **fewer round-trips** (collapse) and **region co-location**, not blanket indexing.

## Scope
- **In scope:** EXPLAIN-driven index check + targeted indexes; collapsing the page's two serial
  DB reads into one; DB/function region co-location; setting a real Solana RPC; profiling and
  fixing the slow list endpoints; keeping chain reads off the synchronous render path.
- **Out of scope:** the ISR/cache()/client-guard changes (companion plan); any change to the
  on-chain program or snapshot cron cadence.

## Blockers
- **Confirm the live Neon project before touching the DB.** Memory + topology: prod uses
  `agentvouch-postgres` (Vercel-managed); a legacy `agent-reputation-oracle` project also exists
  and is a known trap (stale integration, branch-limit deploy failures). Do not run EXPLAIN /
  CREATE INDEX until the project behind prod `DATABASE_URL` is confirmed. Resolve via:
  `vercel env pull` (read the `DATABASE_URL` host) or Neon MCP `list_projects` +
  `describe_project`, and match the host. (owner: Andy to confirm)

## Implementation Steps

### A. EXPLAIN the snapshot query (`explain-analyze-snapshot-query`)
After the blocker clears, run `EXPLAIN (ANALYZE, BUFFERS)` on the
[skillDetailSnapshot.ts:308-413](web/lib/skillDetailSnapshot.ts) query for a real `skillDbId`
(use Neon MCP `explain_sql_statement` / `run_sql`, or `prepare_query_tuning`). Focus on:
- `skill_versions` — the two LATERAL subqueries (latest-version `ORDER BY version DESC LIMIT 1`,
  and the `jsonb_agg` over all versions). Existing index is `idx_skill_versions_tree_hash`
  ([db.ts:639](web/lib/db.ts)); a `(skill_id, version DESC)` index may be missing.
- `skill_scans` join on `(tree_hash, rubric_version, model)` — confirm an index exists.
- `agent_identity_bindings` joins on `(binding_type, binding_ref, chain_context)` and
  `(agent_id)` — no matching index seen in db.ts; likely seq-scanned.
Record the plan + timings in this file (dated) so the next session knows what was found.

### B. Add only the indexes EXPLAIN proves missing (`add-missing-indexes`)
Add to the idempotent DDL in [web/lib/db.ts](web/lib/db.ts) (same `CREATE INDEX IF NOT EXISTS`
pattern as [db.ts:639,868,885,916](web/lib/db.ts)). Candidate set (add only those that EXPLAIN
shows seq-scanning):
```sql
CREATE INDEX IF NOT EXISTS idx_skill_versions_skill_version
  ON skill_versions(skill_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_skill_scans_tree_rubric_model
  ON skill_scans(tree_hash, rubric_version, model);
CREATE INDEX IF NOT EXISTS idx_agent_identity_bindings_lookup
  ON agent_identity_bindings(binding_type, binding_ref, chain_context);
CREATE INDEX IF NOT EXISTS idx_agent_identity_bindings_agent
  ON agent_identity_bindings(agent_id);
```
db.ts DDL runs on first request; for large tables prefer creating indexes out-of-band with
`CREATE INDEX CONCURRENTLY` (cannot run in the idempotent batch's transaction) and keep the
`IF NOT EXISTS` form in db.ts for fresh environments.

### C. Verify region co-location (`verify-db-region-colocation`)
Functions execute in **iad1**. Confirm the Neon project region via Neon MCP `describe_project`.
If Neon is not in `us-east` / `aws-us-east-*`, every HTTP query crosses regions ×N — fix by
either provisioning/moving Neon to us-east, or pinning the Vercel function region to the DB
region (add `regions` in [web/vercel.json](web/vercel.json), e.g. `"regions": ["iad1"]`, or via
route segment config). Co-location matters more than indexing for a 2-RTT HTTP query.

### D. Collapse the two serial reads into one (`collapse-resolver-into-snapshot`)
Today the page does `resolveSkillRoutePath(id, skill)` then `loadSkillDetailSnapshot(route.id)`
— two serial Neon RTTs ([page.tsx:28,44](web/app/skills/[id]/[skill]/page.tsx)). Add
`loadSkillDetailSnapshotBySlug(authorSlug, skillSlug)` in
[web/lib/skillDetailSnapshot.ts](web/lib/skillDetailSnapshot.ts) that filters
`WHERE s.public_author_slug = $1 AND s.public_slug = $2` (hits `idx_skills_public_route`) and
still selects `s.*` (which already includes `id`, `skill_id`, `public_slug`,
`public_author_slug` for the canonical-redirect check at
[page.tsx:34-40](web/app/skills/[id]/[skill]/page.tsx)). Update the page to call it once and
derive the redirect from the returned row.
- **Caveat — chain skills:** `resolveSkillRouteParam` synthesizes a record for `chain-` params
  ([skillRouteResolver.ts:89-96](web/lib/skillRouteResolver.ts)) and the page sets
  `initialSkill = null` for them ([page.tsx:42-44](web/app/skills/[id]/[skill]/page.tsx)). Verify
  whether chain skills actually route through `[id]/[skill]` (their synthetic author slug is
  `"chain"`); preserve the existing chain branch and only take the by-slug fast path for
  non-chain skills. Keep `resolveSkillRoutePath` for callers that still need it.
- Sequencing: do this **after** EXPLAIN (A) so the merged query is validated against the plan,
  and after the companion plan's `cache()` lands (which already removes the *duplicate* of these
  reads) — so this step is purely the extra RTT, lower risk.

### E. Set a real Solana RPC (`set-prod-solana-rpc`)
In Vercel prod env set `SOLANA_RPC_URL` (server) and `NEXT_PUBLIC_SOLANA_RPC_URL` (browser, used
by `browserX402`) to a paid endpoint (Helius/Triton/QuickNode) on the correct cluster. Confirm
prod is not silently using the public `api.devnet.solana.com` fallback
([web/lib/solanaRpc.ts:1-4](web/lib/solanaRpc.ts)). This is the likely cause of the multi-second
list endpoints and the `?trust=live` tail.

### F. Profile + fix the list endpoints (`profile-list-endpoints`)
Profile `/api/index/skills` (~4.9s) and `/api/skills` (~2.0s). Determine whether the time is
on-chain RPC (then move to Postgres snapshot reads — the cron already populates snapshot tables
— and/or apply the same `s-maxage`/SWR `Cache-Control` used by `/api/skills/[id]`) or DB
aggregation (then index/optimize the aggregate query). Note the marketplace page itself is
`export const dynamic = "force-dynamic"` ([app/skills/page.tsx:8](web/app/skills/page.tsx)) — if
"skill page loads" includes browse, consider ISR there too (separate follow-up).

## Verification
- EXPLAIN after indexing shows index scans (no seq scans) on `skill_versions`, `skill_scans`,
  `agent_identity_bindings`; record before/after timings here.
- Re-measure a **cache-MISS** skill page (e.g. a never-visited skill, or right after a deploy):
  `curl -s -o /dev/null -w 'ttfb=%{time_starttransfer}s\n' <url>` → target < 400ms.
- `/api/index/skills` and `/api/skills` TTFB materially lower after E/F.
- Confirm no regression: canonical-path redirects and `notFound()` still behave for non-canonical
  and missing slugs after the query collapse (D).

## Rollout
- Indexes: `CREATE INDEX IF NOT EXISTS` is online/idempotent; for large tables use
  `CONCURRENTLY` out-of-band. Low risk, additive.
- Env (RPC): set in Vercel → redeploy; verify a server log / health check shows the configured
  endpoint, not the devnet fallback.
- Query collapse (D): ship behind the companion plan's `cache()` safety net; the old two-call
  path stays available via `resolveSkillRoutePath` for rollback.

## Rollback
- Drop any index added (`DROP INDEX IF EXISTS …`) — no data impact.
- Revert the page to `resolveSkillRoutePath` + `loadSkillDetailSnapshot` (two-call path).
- Revert the RPC env vars (falls back to prior value). Avoid touching unrelated schema/env.

## Open questions / assumptions
- Which Neon project is live (the blocker above) — must be confirmed before A/B/C.
- Whether the list-endpoint latency is RPC-bound or DB-bound is unverified; step F decides.
- Expected DB win is modest given resolver+trust are already indexed; if EXPLAIN shows the
  snapshot query is already fast, the value of this plan concentrates in E/F (RPC + list
  endpoints) and the region check (C), not new indexes.
