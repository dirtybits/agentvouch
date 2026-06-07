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
  chain context. If the row is missing (e.g. cold start before the first cron
  run) it falls back to a live on-chain compute, returns it, and persists the
  snapshot so subsequent requests are fast.
- `GET /api/skills?mode=fast` already reads only Postgres and attaches trust
  from `author_trust_snapshots`.

### Refresh path (slow, background)
`GET|POST /api/cron/refresh-snapshots` recomputes both snapshots from on-chain
data:
- `refreshPlatformMetricsSnapshot()` — listings + agent profiles aggregation →
  `platform_metrics_snapshot`.
- `refreshAllAuthorTrustSnapshots()` — resolves trust/identity for every author
  that has a repo skill → `author_trust_snapshots`.

It is scheduled in `web/vercel.json` (`*/15 * * * *`). Both refreshes run under
`Promise.allSettled`, so one failing does not block the other.

## Configuration

- `CRON_SECRET` (recommended in production): when set, the cron endpoint
  requires `Authorization: Bearer <CRON_SECRET>`. Vercel Cron sends this
  automatically. When unset, the endpoint runs without auth (dev / first
  deploy) and logs a warning.

### Cron cadence note
`*/15 * * * *` requires a Vercel plan that allows sub-daily crons. On the Hobby
plan crons are limited to once per day; adjust the schedule or trigger
`/api/cron/refresh-snapshots` from an external scheduler if needed. The live
fallback in `/api/landing` keeps the page correct regardless of cadence.

## Key files
- `web/lib/platformMetrics.ts` — metrics compute + snapshot read/write/refresh
- `web/lib/trustSnapshots.ts` — author trust snapshot upsert + refresh
- `web/app/api/landing/route.ts` — snapshot-first metrics endpoint
- `web/app/api/cron/refresh-snapshots/route.ts` — background refresh job
- `web/lib/db.ts` — `platform_metrics_snapshot` schema
- `web/vercel.json` — cron schedule
