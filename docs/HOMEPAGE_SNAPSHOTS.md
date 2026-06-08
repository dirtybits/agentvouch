# Homepage + marketplace snapshot layer

Trusted surfaces (homepage, marketplace, author pages, dashboard) are served
from Neon Postgres so they load in ~200-300ms, instead of scanning Solana
program accounts or resolving per-author trust from chain on every request.
On-chain data is pulled into Postgres by a periodic background job and by
stale-while-revalidate on the read paths.

## How it works

| Surface | Served from | Kept fresh by |
|---|---|---|
| Platform metrics (`GET /api/landing`) | `platform_metrics_snapshot` table | stale-while-revalidate + cron |
| Marketplace list (`GET /api/skills?mode=fast`) | `skills` + `author_trust_snapshots` (LEFT JOIN) | cron + full-mode requests |
| Card hydration (`POST /api/skills/hydrate`) | `author_trust_snapshots` (trust) + live RPC (buyer status) | snapshot-first trust + background revalidate |
| Author / dashboard (`GET /api/skills?author=…`) | `author_trust_snapshots` | snapshot-first trust + background revalidate |

Before this change, `/api/landing` ran two `getProgramAccounts` scans plus
author-identity resolution on the request path; `/api/skills` full mode and
`/api/skills/hydrate` resolved per-author trust from chain on every request.
All of that is now off the hot path.

### Trust is snapshot-first
`/api/skills` (full mode) and `/api/skills/hydrate` serve author trust from
`author_trust_snapshots` and only touch chain for **first-seen** authors
(resolved synchronously so they still get trust on that request). Authors whose
snapshot is older than `AUTHOR_TRUST_SNAPSHOT_STALE_MS` (15m) are served from
cache and refreshed in the background (`scheduleBackgroundTrustRefresh`). Buyer
status / purchase preflight stays live — it needs real balance and entitlement
checks. The classification lives in `lib/authorTrustView.ts`
(`partitionAuthorsByTrustFreshness`).

Not covered: `useMarketplaceOracle` still reads some program accounts
client-side; server-mediating those is a separate migration.

### Request path (fast, Postgres-only)
- `GET /api/landing` reads `platform_metrics_snapshot` for the configured
  chain context and serves it directly. It uses **stale-while-revalidate**:
  - **fresh** row → serve it;
  - **stale** row (older than 15 min) → serve it immediately *and* trigger a
    single-flighted background recompute (`after(() => refresh)`), so organic
    traffic keeps metrics fresh even if the cron is delayed or disabled;
  - **miss** (no row yet, e.g. first deploy) → live compute, serve, and persist
    the snapshot (deduped so a cold-start burst triggers one scan, not many).
- `GET /api/skills?mode=fast` already reads only Postgres and attaches trust
  from `author_trust_snapshots`.

Because the read path self-revalidates, the cron is a freshness *floor* for
zero-traffic windows, not the only thing keeping metrics current.

### Refresh path (slow, background)
`GET|POST /api/cron/refresh-snapshots` recomputes both snapshots from on-chain
data:
- `refreshPlatformMetricsSnapshot()` — listings + agent profiles aggregation →
  `platform_metrics_snapshot`.
- `refreshAllAuthorTrustSnapshots()` — resolves trust/identity for every author
  that has a repo skill → `author_trust_snapshots`.

The cron scans all `AgentProfile` accounts **once** and shares the decoded
result with both halves (metrics aggregation + per-author trust), so the same
accounts aren't scanned twice; if the shared scan fails, each half falls back to
fetching independently. Both refreshes run under `Promise.allSettled`, so one
failing does not block the other. Author trust snapshots are written with a
single multi-row upsert rather than one statement per author.

Scheduled in `web/vercel.json` (`0 6 * * *`, daily).

## Configuration

- `CRON_SECRET`: when set, the cron endpoint requires
  `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends this automatically).
  When **unset**, the endpoint **fails closed in production**
  (`VERCEL_ENV === "production"` → 401) and is only permissive in
  non-production environments (dev / preview), where it logs a warning.

### Cron cadence note
The daily `0 6 * * *` schedule is Hobby-plan compatible. For fresher metrics on
Pro you can tighten it; the stale-while-revalidate read path means correctness
does not depend on the cadence.

## Key files
- `web/lib/platformMetrics.ts` — metrics compute + snapshot read/write/refresh
- `web/lib/trustSnapshots.ts` — author trust resolve/upsert/refresh helpers
- `web/lib/authorTrustView.ts` — cached-trust helpers + freshness partition + background scheduling
- `web/app/api/landing/route.ts` — snapshot-first metrics endpoint
- `web/app/api/skills/route.ts` — snapshot-first trust in full mode
- `web/app/api/skills/hydrate/route.ts` — snapshot-first trust + live buyer status
- `web/app/api/cron/refresh-snapshots/route.ts` — background refresh job
- `web/lib/db.ts` — `platform_metrics_snapshot` schema
- `web/vercel.json` — cron schedule
