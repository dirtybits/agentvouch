# Making skill cards (and metrics) blazingly fast

Status: analysis + plan. The Postgres snapshot work (PR #11) removed on-chain RPC
from the request path, but cards/metrics can still feel slow. This documents
*where the time actually goes* and the highest-leverage fixes, in order.

## Where the time actually goes

Lifecycle of a skill card on the homepage / marketplace today:

1. HTML shell arrives (the page is a `"use client"` component).
2. JS bundle downloads + parses (Solana + wallet SDKs are heavy).
3. React hydrates.
4. `useEffect` fires `GET /api/skills?mode=fast`.
5. Server: `initializeDatabase()` (cold-instance DDL) + one Postgres query
   (`loadRepoSkillRows`, which loads *all* matching rows, then sorts + slices in
   JS) + enrichment.
6. Cards render.
7. `POST /api/skills/hydrate` enriches (trust is now snapshot-first; buyer
   status stays live).

So perceived "card load" = **client waterfall (2–4)** + **API (5)** + **cold
starts**. The snapshot work made (5) fast *when warm*. What's left:

- **Client waterfall** — cards can't paint until the JS bundle loads, hydrates,
  and the fetch returns. This is invisible to server-side timing.
- **Cold Neon** — first query after autosuspend is ~0.5–5s.
- **Cold-function DDL tax** — `initializeDatabase` runs ~50 idempotent DDL
  statements on each cold instance's first request, before the first byte.
- **Load-all-then-slice** — `/api/skills` paginates in JS, so payload/work scale
  with catalog size, not page size.

Use the diagnostics added in PR #12 to confirm which dominates:
`/api/landing` → `X-AgentVouch-Source` (`snapshot-hit` = fast; `live-compute` =
slow) and `Server-Timing: snapshot;dur=` (big = cold Neon); `/api/skills?mode=fast`
→ `Server-Timing: db;dur=`. If API timings are small but cards still appear
late, the bottleneck is the client waterfall (lever 1).

## Levers, ranked

### 1. Server-render the initial cards via ISR — biggest perceived win
Move the first card grid (homepage featured + marketplace page 1) to a React
Server Component with `export const revalidate = N`. Cards then arrive *in the
first HTML*, cached at the edge globally — no client fetch, not gated on
bundle/hydration, and immune to cold DB (the edge serves the cached render while
revalidating). Keep wallet connect / buyer-status as client islands layered on
top.

Sketch:
- Extract `FeaturedSkillsServer` / `MarketplaceListServer` RSCs that call
  `loadRepoSkillRows` directly (no HTTP hop) and render `SkillPreviewCard`.
- Make the route segment a server component; push `useState`/wallet/toggle
  interactivity into child client components.
- Keep the client `useEffect` only for pagination/search beyond page 1 and for
  buyer-status hydration.

### 2. Keep Neon warm (infra)
Neon autosuspend makes the first query cold. Disable scale-to-zero or raise the
autosuspend window (or use a tier that stays warm). Single biggest infra lever
for first-visit latency — the snapshot reads only pay off against a warm DB.

### 3. Cut the cold-function DDL tax
`initializeDatabase()` runs the full schema (~50 `CREATE/ALTER ... IF NOT EXISTS`
statements) on every cold instance's first request. Gate it behind a
schema-version marker (run migrations only when the version changes) or run
migrations at deploy time instead of lazily per request. Turns ~50 round-trips
into ~1 on warm-schema cold starts.

### 4. Edge-cache tuning — done in this branch
Extend `stale-while-revalidate` on the public card/metrics lists so the edge
serves an instant (slightly stale) response on sporadic visits while
revalidating in the background. `s-maxage` stays modest so data still refreshes
regularly. This is the safest immediate win for a low-traffic site.

### 5. SQL-side pagination (scale)
`/api/skills` loads all rows then sorts + slices in JS. Push `ORDER BY` +
`LIMIT/OFFSET` (+ a windowed `COUNT(*) OVER()` for the total) into SQL for the
fast-mode browse path, so payload and work scale with page size, not catalog
size. Be careful to reproduce the existing sort semantics exactly (the
`trusted` sort orders by `cached_reputation_score`).

### 6. Trim the client bundle on `/skills`
Per AGENTS.md, keep `/skills` on `useMarketplaceOracle` (already done) and defer
wallet/oracle code until needed so the card grid isn't gated on heavy JS. The
client-side `useMarketplaceOracle.getAllSkillListings` `getProgramAccounts` read
is also a candidate to server-mediate (separate migration AGENTS.md tracks).

## Recommended sequence
1. Edge-cache SWR bump (this branch) — instant, safe.
2. Measure with PR #12's headers to confirm API-cold vs client-waterfall.
3. If client-dominated → lever 1 (server-render/ISR). If DB-cold → levers 2 + 3.
4. Lever 5 for scale.

## Acceptance criteria
- `/api/landing` and `/api/skills?mode=fast`, warm: `Server-Timing` p50 < ~50ms,
  `X-AgentVouch-Source: snapshot-hit`.
- Homepage featured cards visible in the first paint (server-rendered) — no
  spinner waiting on a client fetch.
- Cold-visit TTFB dominated by an edge-served (stale) response, not a cold
  function + cold DB.
