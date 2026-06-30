---
name: skill-page-perf-isr-dedup
overview: "Cut skill detail page TTFB from ~0.6-1.6s to sub-150ms on the common path by adding ISR caching + static prerender of popular skills, deduping the doubled server-side DB work with React cache(), and stopping the redundant on-mount client refetch that forces the live on-chain trust path for every anonymous view."
todos:
  - id: add-isr-revalidate
    content: Add `export const revalidate = 300` to web/app/skills/[id]/[skill]/page.tsx so rendered HTML is edge-cached (ISR) instead of served no-store.
    status: completed
  - id: add-generate-static-params
    content: Add generateStaticParams() to the skill page backed by a new listStaticSkillRouteParams() query (top ~200 skills by created_at DESC), so popular pages prerender warm; keep dynamicParams default-true for the long tail.
    status: completed
  - id: dedup-with-react-cache
    content: Wrap resolveSkillRoutePath (skillRouteResolver.ts) and loadSkillDetailSnapshot (skillDetailSnapshot.ts) in React cache() so generateMetadata and the page component share one DB result instead of running each query twice per request.
    status: completed
  - id: guard-client-refetch
    content: In SkillDetailClient.tsx skip the on-mount refreshSkill() when initialSkill is present, so anonymous views render from the SSR snapshot and stop triggering /api/skills/[id]?trust=live (the on-chain path) on every load.
    status: completed
  - id: verify-cache-and-paint
    content: Local build/typecheck/lint DONE 2026-06-30 (route reclassified to ● ISR). PENDING post-deploy — confirm cache-control no longer no-store, 2nd hit x-vercel-cache HIT with sub-150ms TTFB, and an anonymous load fires no ?trust=live request.
    status: in_progress
isProject: false
---

# Skill Page Perf: ISR + cache() dedup + client refetch guard

## Goal
Make `/skills/[author]/[skill]` (e.g. `/skills/wallet-asuavudg/subagent-orchestration`)
serve from the Vercel edge cache for the overwhelming majority of requests, so TTFB
drops from the measured ~0.6-1.6s to tens of milliseconds. Where a request must still
render (cache miss / revalidation / long tail), halve its DB work and stop a redundant
client round-trip. These three changes are self-contained web-code edits with no
external dependency — they ship together. The DB-query and Solana-RPC work lives in the
companion plan `skill-page-perf-db-rpc.plan.md`.

## Evidence (measured 2026-06-30, prod `www.agentvouch.xyz`)
- Document fetch TTFB: 1.37s / 1.65s / 0.62s across 3 runs; total ≈ TTFB. DNS+TCP+TLS ≈ 75ms,
  116KB HTML downloads fast. **The cost is server-side, before first byte.**
- Response headers: `cache-control: private, no-cache, no-store, must-revalidate` and
  `x-vercel-cache: MISS` → the page is fully dynamic, never cached.
- `x-vercel-id: sfo1::iad1::…` → function executes in **iad1 (us-east-1)**.
- Content is present in the initial HTML (server-rendered), so this is not a client-render
  waterfall for the main content — it is an uncached dynamic render done twice (see below).

## Root causes addressed here
1. **No caching.** [web/app/skills/[id]/[skill]/page.tsx](web/app/skills/[id]/[skill]/page.tsx)
   sets no `revalidate` and no `generateStaticParams`; a dynamic `[id]/[skill]` segment with
   no enumerable params therefore renders dynamically with `no-store` on every hit. Confirmed
   the page reads **only `params`** — no `searchParams`, `cookies()`, or `headers()` — so
   nothing forces dynamic; ISR is a drop-in. (verified 2026-06-30)
2. **Doubled DB work.** `generateMetadata` and the page body each independently resolve the
   route and load the snapshot:
   - `generateMetadata` ([page.tsx:18](web/app/skills/[id]/[skill]/page.tsx)) → `resolveSkillRoutePath` →
     `buildSkillPageMetadata` → `getSkillMetadataSummary(route.id)`
     ([skillPageMetadata.ts:20](web/lib/skillPageMetadata.ts), [metadataData.ts:50-53](web/lib/metadataData.ts)) →
     `loadSkillDetailSnapshot` (the ~7-table LATERAL JOIN at
     [skillDetailSnapshot.ts:303-413](web/lib/skillDetailSnapshot.ts)).
   - Page body ([page.tsx:28,44](web/app/skills/[id]/[skill]/page.tsx)) → `resolveSkillRoutePath` *again* →
     `loadSkillDetailSnapshot` *again*.
   No React `cache()` exists in the app today, so this is up to 4 serial Neon HTTP round-trips
   (the serverless driver does one HTTP request per query).
3. **Redundant client refetch on the live path.** [SkillDetailClient.tsx:440-442](web/app/skills/[id]/SkillDetailClient.tsx)
   fires `refreshSkill({ includeBuyer: false })` on mount, which calls
   `/api/skills/[id]?trust=live` with `cache: "no-store"` ([:413,:418-423](web/app/skills/[id]/SkillDetailClient.tsx)).
   `trust=live` runs the **on-chain trust resolution** server-side for *every anonymous page
   view*, re-fetching data the server already embedded as `initialSkill`.

## Scope
- **In scope:** ISR + static prerender of the skill detail page; request-level dedup of its
  two DB reads; gating the on-mount client refetch.
- **Out of scope (companion plan):** merging the two queries into one, DB index/region work,
  setting a real Solana RPC, the slow `/api/index/skills` + `/api/skills` list endpoints,
  and `app/skills/page.tsx`'s separate `export const dynamic = "force-dynamic"` (marketplace
  list — leave as-is here).

## Files To Change
- `web/app/skills/[id]/[skill]/page.tsx`: add `export const revalidate = 300` and
  `export async function generateStaticParams()`.
- `web/lib/skillRouteResolver.ts`: add `listStaticSkillRouteParams()`; wrap
  `resolveSkillRoutePath` in `cache()` from `react`.
- `web/lib/skillDetailSnapshot.ts`: wrap `loadSkillDetailSnapshot` in `cache()` from `react`.
- `web/app/skills/[id]/SkillDetailClient.tsx`: gate the on-mount `refreshSkill` effect.

## Implementation Steps

### 1. ISR (`add-isr-revalidate`)
In `web/app/skills/[id]/[skill]/page.tsx` add at module scope:
```ts
export const revalidate = 300; // skill data only changes via daily cron; 300s is conservative
```
`redirect()`/`notFound()` in the page compose fine with ISR (canonical params won't redirect;
non-canonical URLs still redirect, redirects aren't page-cached). `after()`-scheduled trust
refresh ([skillDetailSnapshot.ts:418](web/lib/skillDetailSnapshot.ts)) simply won't run on a
pure cache HIT, which is fine — the daily cron is the source of truth.

### 2. Static prerender of popular skills (`add-generate-static-params`)
Follow the existing pattern in [app/blog/[slug]/page.tsx:12](web/app/blog/[slug]/page.tsx).
Add to `web/lib/skillRouteResolver.ts`:
```ts
export async function listStaticSkillRouteParams(
  limit = 200
): Promise<{ id: string; skill: string }[]> {
  try {
    await initializeDatabase();
    const rows = await sql()<{ public_author_slug: string; public_slug: string }>`
      SELECT public_author_slug, public_slug
      FROM skills
      WHERE public_author_slug IS NOT NULL AND public_slug IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    // route param [id] is the AUTHOR slug, [skill] is the skill slug (see resolveSkillRoutePath)
    return rows.map((r) => ({ id: r.public_author_slug, skill: r.public_slug }));
  } catch {
    return []; // build/DB hiccup -> fall back to all-on-demand ISR
  }
}
```
In `page.tsx`:
```ts
export async function generateStaticParams() {
  return listStaticSkillRouteParams();
}
```
Leave `dynamicParams` at its default (`true`) so non-prerendered skills still render on demand
and then cache. Note: `generateBuildId: () => marketplace-${Date.now()}`
([web/next.config.mjs](web/next.config.mjs)) gives every deploy a fresh ISR namespace, so these
params are re-prerendered at build (warm) and the long tail re-renders once post-deploy —
acceptable. `LIMIT 200` bounds added build time (~200 snapshot renders).

### 3. Dedup with React `cache()` (`dedup-with-react-cache`)
- `web/lib/skillRouteResolver.ts`: `import { cache } from "react";` and wrap the resolver:
  `export const resolveSkillRoutePath = cache(async (rawAuthorSlug, rawSkillSlug) => { … })`
  (keep the exact body/signature). Dedups the identical `(id, skill)` call across
  `generateMetadata` and the page body.
- `web/lib/skillDetailSnapshot.ts`: `import { cache } from "react";` and wrap
  `loadSkillDetailSnapshot` the same way. This is the big win — the LATERAL JOIN runs once per
  request instead of twice (page body + metadata both call it with the same `route.id` uuid;
  the metadata path resolves the same id via `resolveSkillRouteParam` at
  [metadataData.ts:50](web/lib/metadataData.ts)).
- `cache()` is request-scoped and shared across `generateMetadata` + the page render in the
  App Router, so dedup is correct. It also means the `after()` trust refresh schedules once
  instead of twice — strictly better.
- Noted follow-up (cheap, optional, can defer to companion plan): the metadata path still calls
  `resolveSkillRouteParam(route.id)` ([metadataData.ts:50](web/lib/metadataData.ts)) — a separate
  PK lookup not deduped by the above. Eliminate by threading the already-resolved
  `SkillRouteRecord` into `getSkillMetadataSummary` instead of re-resolving. Low value (PK
  lookup), so not blocking.

### 4. Gate the on-mount client refetch (`guard-client-refetch`)
Key fact (verified 2026-06-30): [SkillDetailClient.tsx:319](web/app/skills/[id]/SkillDetailClient.tsx)
initializes `const [loading, setLoading] = useState(!initialSkill)`, and `skill`/`content` are
seeded from `initialSkill` ([:315-318](web/app/skills/[id]/SkillDetailClient.tsx)). So when the
SSR snapshot is present (the normal non-chain case) `loading` already starts `false` — skipping
the mount fetch does **not** strand a spinner. Only chain skills (`initialSkill == null`) need
the mount fetch.

Change the mount effect ([:440-442](web/app/skills/[id]/SkillDetailClient.tsx)):
```ts
useEffect(() => {
  // SSR already hydrated the snapshot (incl. cached trust). Skip the on-mount live
  // refresh for anonymous views — it otherwise forces ?trust=live (on-chain) on every
  // page load. Chain skills / SSR misses (initialSkill == null) still need this fetch;
  // wallet-driven buyer/live refresh is handled by the wallet-change effect below.
  if (initialSkill) return;
  void refreshSkill({ includeBuyer: false });
}, [refreshSkill, initialSkill]);
```
**Verify during implementation:** the wallet-change effect at
[SkillDetailClient.tsx:446](web/app/skills/[id]/SkillDetailClient.tsx) still triggers a
buyer/live refresh when a wallet is connected on or after mount (so a logged-in buyer's
purchase state and live trust still load). If that effect does not cover the
already-connected-on-mount case, extend the guard to `if (initialSkill && !walletAddress) return;`
instead — but avoid double-fetching when both effects would fire on a wallet change.

## Verification
- Local: from `web/`, `npm run build` (confirm the skill route prerenders without error and
  build time is acceptable) and `npm run typecheck`.
- Local smoke: `npm run dev`, load a skill page, confirm in devtools Network that an anonymous
  load makes **no** `GET /api/skills/[id]?trust=live` call, and the page shows full content
  immediately (no spinner).
- Post-deploy (prod or preview):
  - `curl -sI 'https://<host>/skills/wallet-asuavudg/subagent-orchestration'` →
    `cache-control` no longer `no-store`; a second request returns `x-vercel-cache: HIT`.
  - `curl -s -o /dev/null -w 'ttfb=%{time_starttransfer}s\n' <url>` twice → HIT TTFB < 150ms
    (target 200-400ms met with margin).
  - Network tab on an anonymous load: no `?trust=live` request fired.

## Rollout
- Single PR; ship behind a normal Vercel deploy. No flag needed — changes are additive and
  isolated to the skill detail route + two lib functions + one client effect.
- Watch the first post-deploy hit per skill (cold ISR render) then confirm subsequent HITs.

## Rollback
- Remove `export const revalidate` and `generateStaticParams` (reverts to dynamic render).
- Unwrap the two `cache()` calls (functions keep identical signatures).
- Restore the unconditional on-mount `refreshSkill({ includeBuyer: false })`.
All four are independently revertible; none touch the DB schema or external services.

## Assumptions / Blockers
- **Assumption:** up-to-300s staleness on the skill detail page is acceptable. The data is
  refreshed by the daily `/api/cron/refresh-snapshots` job plus opportunistic `after()` refresh,
  so this holds. Lower `revalidate` if product wants fresher trust numbers.
- **No hard blockers** — none of these require live-DB access or env changes.
- Cross-check with companion plan: the `guard-client-refetch` change also reduces load on the
  `?trust=live` / Solana path that `skill-page-perf-db-rpc.plan.md` addresses.

## Implementation log (2026-06-30)
Executed in worktree `charming-germain-ab913f`. All four code changes landed:
- `web/app/skills/[id]/[skill]/page.tsx`: added `export const revalidate = 300` and
  `generateStaticParams()` (delegates to `listStaticSkillRouteParams`).
- `web/lib/skillRouteResolver.ts`: `resolveSkillRoutePath` wrapped in React `cache()`; added
  `listStaticSkillRouteParams(limit = 200)` (returns `[]` on failure → all-on-demand ISR).
- `web/lib/skillDetailSnapshot.ts`: `loadSkillDetailSnapshot` wrapped in React `cache()` (inner
  declaration renamed `loadSkillDetailSnapshotUncached`; hoisted, so the wrapper precedes it).
- `web/app/skills/[id]/SkillDetailClient.tsx`: on-mount `refreshSkill` guarded with
  `if (initialSkill) return;`. Verified the buyer-refresh effect (SkillDetailClient.tsx:464-467)
  still loads live/buyer data for connected wallets, and `loading` inits to `!initialSkill`
  (SkillDetailClient.tsx:319) so there is no spinner when the SSR snapshot is present.

Local verification (Node 24, deps reflinked via `scripts/worktree-setup.sh --web`):
- `npm run typecheck` (`next typegen && tsc --noEmit`): clean, no diagnostics.
- `npx eslint` on all four edited files: exit 0 (react-hooks/exhaustive-deps satisfied).
- `npm run build`: exit 0. **`/skills/[id]/[skill]` reclassified `ƒ` (Dynamic, no-store) →
  `●` (SSG/ISR)** — same bucket as `/blog/[slug]`; sibling routes `ƒ /skills` and
  `ƒ /skills/[id]` (untouched) stayed dynamic. Build ran without DB env, so
  `generateStaticParams` returned `[]` (no prod prerender, no trust-refresh writes); on deploy
  it prerenders the top ~200 and on-demand-caches the rest under the 300s policy.

PENDING (needs a deploy; tracked by `verify-cache-and-paint`): confirm `cache-control` is no
longer `no-store`, the 2nd hit is `x-vercel-cache: HIT` with sub-150ms TTFB, and an anonymous
load fires no `?trust=live`. Not done locally because dev mode renders dynamically (ISR is not
observable in dev) and a real-data render would require pointing local dev at the production DB,
which would risk build/render-time `after()` trust-refresh writes to prod.
