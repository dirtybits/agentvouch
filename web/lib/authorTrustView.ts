import { after } from "next/server";
import { isAddress } from "@solana/kit";
import type { AgentTrustSummary } from "@/lib/agentDiscovery";
import { AUTHOR_TRUST_SNAPSHOT_STALE_MS } from "@/lib/cachePolicy";
import type { AuthorTrust } from "@/lib/trust";
import { refreshAuthorTrustSnapshotsFor } from "@/lib/trustSnapshots";

/**
 * Minimal shape of a skill row carrying the `author_trust_snapshots` LEFT JOIN
 * columns. Both `/api/skills` and `/api/skills/hydrate` select these so trust
 * can be served from Postgres instead of resolved from chain on the hot path.
 */
export type CachedTrustRow = {
  author_pubkey?: string | null;
  source?: string;
  cached_author_trust?: AuthorTrust | string | null;
  cached_author_trust_summary?: AgentTrustSummary | string | null;
  cached_reputation_score?: number | string | null;
  cached_trust_refreshed_at?: string | null;
};

export function parseCachedJson<T>(
  value: T | string | null | undefined
): T | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value;
}

export function getCachedTrust(row: CachedTrustRow): AuthorTrust | null {
  if (row.source && row.source !== "repo") return null;
  return parseCachedJson<AuthorTrust>(row.cached_author_trust);
}

export function getCachedTrustSummary(
  row: CachedTrustRow
): AgentTrustSummary | null {
  if (row.source && row.source !== "repo") return null;
  return parseCachedJson<AgentTrustSummary>(row.cached_author_trust_summary);
}

/**
 * Partition authors by the freshness of their cached trust snapshot:
 *  - `missing`: no cached trust at all (must be resolved synchronously so a
 *    first-seen author still gets trust on this request);
 *  - `stale`: cached trust exists but is older than `staleMs` (serve it, then
 *    refresh in the background).
 * Authors with fresh cached trust are omitted (served straight from cache).
 */
export function partitionAuthorsByTrustFreshness(
  rows: CachedTrustRow[],
  staleMs = AUTHOR_TRUST_SNAPSHOT_STALE_MS
): { missing: string[]; stale: string[] } {
  const byAuthor = new Map<
    string,
    { hasCached: boolean; refreshedAt: string | null }
  >();

  for (const row of rows) {
    const author = row.author_pubkey;
    if (!author || !isAddress(author)) continue;
    const hasCached = Boolean(getCachedTrust(row));
    const refreshedAt = row.cached_trust_refreshed_at ?? null;
    const existing = byAuthor.get(author);
    // Prefer the entry that actually has cached trust.
    if (!existing || (hasCached && !existing.hasCached)) {
      byAuthor.set(author, { hasCached, refreshedAt });
    }
  }

  const now = Date.now();
  const missing: string[] = [];
  const stale: string[] = [];
  for (const [author, info] of byAuthor) {
    if (!info.hasCached) {
      missing.push(author);
      continue;
    }
    const refreshedMs = info.refreshedAt ? Date.parse(info.refreshedAt) : NaN;
    if (Number.isNaN(refreshedMs) || now - refreshedMs > staleMs) {
      stale.push(author);
    }
  }
  return { missing, stale };
}

/** Refresh trust snapshots for the given authors after the response is sent. */
export function scheduleBackgroundTrustRefresh(authorPubkeys: string[]): void {
  if (authorPubkeys.length === 0) return;
  const run = () =>
    refreshAuthorTrustSnapshotsFor(authorPubkeys).catch((error) =>
      console.error("Background author trust refresh failed:", error)
    );
  try {
    after(run);
  } catch {
    void run();
  }
}
