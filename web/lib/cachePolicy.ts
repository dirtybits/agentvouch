export const PUBLIC_ROUTE_CACHE_SECONDS = {
  landing: 60,
  skillsList: 60,
  skillDetail: 30,
  authorTrust: 60,
} as const;

// stale-while-revalidate windows are generous so a low-traffic site still
// serves an instant (slightly stale) edge response on sporadic visits while the
// function revalidates in the background. `s-maxage` (above) stays modest so the
// data still refreshes regularly.
export const PUBLIC_ROUTE_STALE_SECONDS = {
  landing: 86_400,
  skillsList: 86_400,
  skillDetail: 3_600,
  authorTrust: 3_600,
} as const;

export const IN_MEMORY_CACHE_TTL_MS = {
  landing: 60_000,
  authorTrust: 30_000,
  authorDisputes: 30_000,
  onChainListings: 60_000,
} as const;

// A persisted author_trust_snapshots row older than this is served immediately
// but triggers a background recompute (stale-while-revalidate), so trusted
// surfaces stay fast without resolving trust from chain on the request path.
export const AUTHOR_TRUST_SNAPSHOT_STALE_MS = 15 * 60_000;

export const READ_MODEL_GRADUATION_THRESHOLDS = {
  maxSkillsRouteP95Ms: 1_200,
  maxProgramScanCallsPerMinute: 30,
  maxRpc429sPer5Minutes: 5,
  maxSharedStalenessSeconds: 60,
} as const;

export const PRIVATE_NO_STORE_CACHE_CONTROL = "private, no-store, max-age=0";

export function buildPublicCacheControl(
  sMaxAgeSeconds: number,
  staleWhileRevalidateSeconds: number
) {
  return `public, s-maxage=${sMaxAgeSeconds}, stale-while-revalidate=${staleWhileRevalidateSeconds}`;
}
