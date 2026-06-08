# Homepage snapshot layer

The homepage (skill preview cards + platform metrics) is served from Neon
Postgres so it loads in ~200-300ms, instead of scanning Solana program
accounts on every request. On-chain data is pulled into Postgres by a periodic
background job.

## How it works

| Surface | Served from | Kept fresh by |
|---|---|---|
| Platform metrics (`GET /api/landing`) | `platform_metrics_snapshot` table | cron refresh |
| Skill cards (`GET /api/skills?mode=fast`) | `skills` + `author_trust_snapshots` (LEFT JOIN) | cron refresh + live `/api/skills` requests |

Before this change, `/api/landing` ran two `getProgramAccounts` scans plus
author-identity resolution on the request path, and the homepage's card
hydration resolved per-author trust from chain. Both are now off the hot path.

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
- `web/lib/trustSnapshots.ts` — author trust snapshot upsert + refresh
- `web/app/api/landing/route.ts` — snapshot-first metrics endpoint
- `web/app/api/cron/refresh-snapshots/route.ts` — background refresh job
- `web/lib/db.ts` — `platform_metrics_snapshot` schema
- `web/vercel.json` — cron schedule
