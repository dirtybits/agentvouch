---
name: skills-fast-first-rpc-hydration
overview: "Make landing and marketplace skill cards render from fast Postgres-backed data first, then hydrate trust, purchase status, and on-chain preflight asynchronously so RPC latency no longer blocks first paint."
todos:
  - id: instrument-current-path
    content: Add timing instrumentation around /api/skills DB, on-chain listings, trust, buyer status, and preflight work so the baseline and improvement are measurable.
    status: completed
  - id: add-fast-skills-mode
    content: Add a DB-first /api/skills fast mode that skips RPC enrichment and returns renderable cards within the 200-400ms target path.
    status: completed
  - id: add-hydration-endpoint
    content: Add a side-effect-free skills hydration endpoint that enriches visible skill ids with author trust, on-chain state, buyer purchase status, and purchase preflight.
    status: completed
  - id: hydrate-marketplace
    content: Update the skills marketplace to render fast cards immediately and merge hydration results in the background without resetting the grid loading state.
    status: completed
  - id: hydrate-landing
    content: Update the landing page to fetch landing metrics and fast featured skills in parallel, then hydrate featured cards after first render.
    status: completed
  - id: add-trust-read-model
    content: Add or populate a cached trust read model so Most Trusted can stay fast without requiring live RPC on the initial list response.
    status: completed
  - id: verify-performance
    content: Run focused tests, typecheck, web build, and local timing checks proving first-card render is DB-first and RPC hydration is non-blocking.
    status: completed
isProject: false
---

# Plan — Fast-First Skill Cards & RPC Hydration

## Goal

Render skill cards on the landing page and marketplace from fast DB-backed data first, then update them with live on-chain trust, purchase status, and preflight details after the page is already usable. The first paint target is **200-400ms for the initial skills payload** on a warm app/database path; full trust/preflight hydration may still take 1-2s depending on RPC health, but it must not block the cards from appearing.

## Current Findings

- `SkillPreviewCard` is not the slow part; it is a prop renderer.
- `web/app/skills/page.tsx` blocks the whole grid on `fetch("/api/skills?...")` before rendering any cards.
- `web/app/api/skills/route.ts` currently waits on:
  - `fetchOnChainListings()` / `listOnChainSkillListings()` for a program-account scan.
  - `resolveMultipleAuthorTrust()` for author profile and dispute reads.
  - `createPurchasePreflightContext()` for rent, buyer balance, ATA, and author balance RPC reads.
  - `hasOnChainPurchase()` when `buyerStatus=1`.
- `web/app/page.tsx` fetches `/api/landing` and then `/api/skills?sort=trusted` sequentially, so featured landing cards inherit the same slow path.

## Scope

- In scope:
  - `/api/skills` fast mode for renderable, DB-first cards.
  - A new hydration route for visible skill-card enrichment.
  - Marketplace client state changes so initial cards stay visible while hydration runs.
  - Landing client changes so featured skills do not wait behind `/api/landing` or RPC.
  - Tests and timing instrumentation proving RPC work is off the first-card path.
  - A small trust/listing read model if needed to preserve fast `sort=trusted`.
- Out of scope:
  - Rewriting `SkillPreviewCard` layout.
  - Changing purchase, x402, or on-chain settlement semantics.
  - Replacing Solana RPC providers.
  - Building a full indexer. This plan should use lightweight snapshots/cache tables and explicit hydration first.

## Files To Change

- `web/app/api/skills/route.ts`: add fast mode, skip RPC enrichment when requested, and expose timing headers.
- `web/app/api/skills/hydrate/route.ts`: new route that enriches a bounded list of visible skill ids.
- `web/app/skills/page.tsx`: render fast skills immediately; trigger hydration in a background effect and merge results by skill id.
- `web/app/page.tsx`: fetch `/api/landing` and fast featured skills in parallel; hydrate featured cards after render.
- `web/lib/db.ts`: add snapshot/read-model tables if using cached trust or cached on-chain listing state for fast trusted sorting.
- `web/lib/trust.ts`: add helper to serialize/upsert cached trust snapshots after live trust resolution, if using the read model.
- `web/lib/onchain.ts`: optionally add helper to serialize cached on-chain listing snapshots.
- `web/__tests__/*`: add focused route/client tests for fast mode, hydration, and non-blocking behavior.

## Data Contract

### Fast Skills Response

Add a query flag such as:

```text
GET /api/skills?sort=trusted&page=1&mode=fast
```

or:

```text
GET /api/skills?sort=trusted&page=1&deferRpc=1
```

The fast response should:

- Query Postgres `skills` plus latest `skill_versions` metadata exactly as today.
- Include DB-native fields needed by `SkillPreviewCard`: id, name, summary/description, tags, source, author fields, publisher tier, price fields, on-chain address, installs/downloads, and payment flow.
- Include cached `author_trust` / `author_trust_summary` only if present in the DB read model.
- Return `author_trust: null` when no cache exists; let the card render neutral/unverified state rather than blocking.
- Return purchase/preflight fields as absent or `estimateUnavailable`; do not calculate them on the first response.
- Avoid calling `listOnChainSkillListings`, `resolveMultipleAuthorTrust`, `createPurchasePreflightContext`, or `hasOnChainPurchase`.

### Hydration Request

Add a bounded endpoint:

```text
POST /api/skills/hydrate
{
  "skillIds": ["uuid", "..."],
  "buyer": "optional-connected-wallet"
}
```

The response should be a map keyed by DB skill id:

```json
{
  "skills": {
    "uuid": {
      "author_trust": {},
      "author_trust_summary": {},
      "author_identity": {},
      "total_downloads": 2,
      "total_revenue": 10000,
      "purchasePreflightStatus": "ok",
      "purchasePreflightMessage": null,
      "purchaseRiskWarning": null,
      "buyerHasPurchased": false
    }
  }
}
```

The route must:

- Cap `skillIds` to the visible page size plus a small buffer, for example 24.
- Validate UUIDs and optional Solana buyer address.
- Fetch only those DB rows, not the whole marketplace.
- Resolve trust and preflight exactly as `/api/skills` currently does, but only for visible cards.
- Preserve current buyer status semantics.
- Be side-effect-free: no install increments, no purchase creation, no content serving.

## Implementation Steps

1. **Add instrumentation first**
   - Add local timing helpers in `web/app/api/skills/route.ts`.
   - Emit `Server-Timing` segments for `db`, `chain`, `trust`, `identity`, `preflight`, and `buyer-status`.
   - Add a coarse `X-AgentVouch-Skills-Mode: full|fast` response header.
   - Use these headers in local curl/browser checks before and after the change.

2. **Extract reusable skill enrichment helpers**
   - Keep DB row selection logic shared between full mode, fast mode, and hydration.
   - Extract pure helpers for:
     - `normalizeRepoSkillRow`
     - `applyPaymentFlow`
     - `buildTrustSummaryFields`
     - `applyPurchasePreflightAndBuyerStatus`
   - Avoid changing response field names consumed by existing pages and agent APIs.

3. **Add `/api/skills` fast mode**
   - Parse `mode=fast` or `deferRpc=1`.
   - In fast mode, skip `fetchOnChainListings()` and return DB-backed skills only.
   - If preserving chain-only cards matters for production, read them from a snapshot table rather than live RPC.
   - Use cached trust data for `sort=trusted` when available; otherwise fall back to a stable DB sort such as newest within missing trust scores.
   - Keep existing full mode available for callers that still expect fully hydrated results.

4. **Add trust/read-model snapshots for fast trusted sort**
   - Add a table in `initializeDatabase()` such as `author_trust_snapshots`:
     - `wallet_pubkey VARCHAR(44) PRIMARY KEY`
     - `chain_context VARCHAR(64)`
     - `reputation_score INTEGER NOT NULL DEFAULT 0`
     - `author_trust JSONB NOT NULL`
     - `author_trust_summary JSONB`
     - `refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
   - Left join this table in fast `/api/skills` when `author_pubkey` is present.
   - Upsert snapshots from the hydration endpoint after live `resolveMultipleAuthorTrust()` succeeds.
   - Treat stale/missing snapshots as a display fallback, not an error.

5. **Add `/api/skills/hydrate`**
   - Implement the bounded POST route.
   - Reuse the same trust, identity, preflight, and buyer purchase helpers used by full `/api/skills`.
   - Return partial updates only; the client should merge them into existing skill rows.
   - Set `Cache-Control: private, no-store` when buyer is present; otherwise short public/stale cache is acceptable.

6. **Update marketplace client**
   - Change `fetchSkills()` in `web/app/skills/page.tsx` to call fast mode for the browse tab.
   - Set `skills` and clear `loading` as soon as the fast response returns.
   - Add a background `hydrateSkills()` effect keyed by visible skill ids and `publicKey`.
   - Merge hydration response by `skill.id`.
   - Do not set global `loading` during hydration; optional small per-card visual changes are acceptable, but avoid layout jumps.
   - Preserve existing `purchasedSkillListingKeys` merge so locally known purchases still show immediately.

7. **Update landing page**
   - In `web/app/page.tsx`, fetch `/api/landing` and `/api/skills?sort=trusted&mode=fast` concurrently with `Promise.all`.
   - Render featured skills as soon as fast skills arrive.
   - Hydrate only the three featured skill ids in the background.
   - Keep landing metrics independent from featured cards; one slow response should not block the other.

8. **Keep full mode and agent APIs stable**
   - Do not change paid raw download behavior.
   - Do not change `/api/index/skills` without checking whether it depends on fully hydrated `/api/skills`.
   - If any crawler/index feed still wants full trust data, keep it on full mode or move it to the cached read model explicitly.

## Verification

Run before implementation to capture baseline when a dev server is available:

```bash
curl -sS -o /tmp/skills-full.json -D /tmp/skills-full.headers \
  -w 'full http=%{http_code} ttfb=%{time_starttransfer} total=%{time_total}\n' \
  'http://localhost:3000/api/skills?sort=trusted&page=1'

curl -sS -o /tmp/landing.json -D /tmp/landing.headers \
  -w 'landing http=%{http_code} ttfb=%{time_starttransfer} total=%{time_total}\n' \
  'http://localhost:3000/api/landing'
```

Run after implementation:

```bash
curl -sS -o /tmp/skills-fast.json -D /tmp/skills-fast.headers \
  -w 'fast http=%{http_code} ttfb=%{time_starttransfer} total=%{time_total}\n' \
  'http://localhost:3000/api/skills?sort=trusted&page=1&mode=fast'
```

Required checks:

```bash
npx tsc --noEmit -p web/tsconfig.json
npm run test --workspace @agentvouch/web
npm run build --workspace @agentvouch/web
```

Focused acceptance criteria:

- Fast `/api/skills` returns renderable card rows without invoking:
  - `listOnChainSkillListings`
  - `resolveMultipleAuthorTrust`
  - `createPurchasePreflightContext`
  - `hasOnChainPurchase`
- Marketplace first response clears the grid loader and renders cards before hydration completes.
- Hydration updates trust, buyer purchase state, and preflight fields without replacing the whole grid.
- Landing featured cards render without waiting for `/api/landing` metrics.
- Connected-wallet browse no longer turns the initial list response into a private RPC-heavy request; buyer-specific state hydrates separately.
- Local fast response target: **200-400ms TTFB/total on a warm local dev path**. If Neon/network adds unavoidable overhead, record the measured floor and ensure RPC segments are absent from `Server-Timing`.

## Rollout

1. Ship fast mode behind the explicit `mode=fast` / `deferRpc=1` query first.
2. Update marketplace and landing to use fast mode only after route tests prove RPC helpers are skipped.
3. Keep the old full `/api/skills` behavior available for one deploy.
4. Watch Vercel function logs for:
   - `/api/skills` latency drop.
   - RPC 429 reduction.
   - Hydration route error rate.
5. After confidence, consider making fast mode the default public list behavior and require `mode=full` for legacy hydrated callers.

## Rollback

- Revert client calls to `/api/skills?sort=trusted` full mode.
- Leave snapshot tables in place; they are additive and harmless.
- Disable hydration calls by short-circuiting the client effect or returning `{ skills: {} }` from `/api/skills/hydrate`.
- Remove the fast-mode query branch only if it causes response contract issues; do not drop DB snapshot data during rollback.

## Assumptions

- Repo-backed `skills` rows are the canonical marketplace inventory. Chain-only listings can be excluded from the first fast pass unless a cached on-chain listing snapshot is added.
- Slightly stale trust is acceptable on first paint as long as cards hydrate fresh data quickly and the UI does not claim the values are live before hydration.
- It is better to preserve card position during hydration than to re-sort the grid after trust arrives; unexpected reorder would feel like layout instability.
- The 200-400ms target applies to the initial renderable skills payload, not to complete RPC hydration.

## Blockers

- If product requires perfectly fresh `Most Trusted` ordering before any cards render, the 200-400ms target is not realistic without a maintained DB/indexer read model.
- If production has important chain-only skills that are not mirrored in Postgres, add `on_chain_listing_snapshots` before switching the client to fast mode.
- If the hydration endpoint starts hitting RPC 429s, keep fast rendering but degrade hydration with a quiet retry/backoff instead of blocking cards again.
