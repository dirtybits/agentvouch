export const PUBLIC_ROUTE_CACHE_SECONDS = {
  landing: 60,
  skillsList: 60,
  skillDetail: 30,
  authorTrust: 30,
} as const;

export const PUBLIC_ROUTE_STALE_SECONDS = {
  landing: 300,
  skillsList: 300,
  skillDetail: 120,
  authorTrust: 120,
} as const;

export const IN_MEMORY_CACHE_TTL_MS = {
  landing: 60_000,
  authorTrust: 30_000,
  authorDisputes: 30_000,
  onChainListings: 60_000,
} as const;

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
