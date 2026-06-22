import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRefreshFor } = vi.hoisted(() => ({ mockRefreshFor: vi.fn() }));

vi.mock("next/server", () => ({ after: (cb: () => unknown) => void cb() }));
vi.mock("@solana/kit", () => ({ isAddress: () => true }));
vi.mock("@/lib/trustSnapshots", () => ({
  refreshAuthorTrustSnapshotsFor: mockRefreshFor,
}));

import {
  getCachedTrust,
  partitionAuthorsByTrustFreshness,
  scheduleBackgroundTrustRefresh,
  type CachedTrustRow,
} from "@/lib/authorTrustView";

const trust = {
  reputationScore: 10,
} as unknown as CachedTrustRow["cached_author_trust"];
const fresh = () => new Date().toISOString();
const old = () => new Date(Date.now() - 60 * 60_000).toISOString();

function repoRow(overrides: Record<string, unknown>): CachedTrustRow {
  return {
    author_pubkey: "AuthorX",
    source: "repo",
    cached_author_trust: trust,
    cached_trust_refreshed_at: fresh(),
    ...overrides,
  } as unknown as CachedTrustRow;
}

describe("getCachedTrust", () => {
  it("parses a JSON-string snapshot and ignores non-repo rows", () => {
    expect(
      getCachedTrust(repoRow({ cached_author_trust: JSON.stringify(trust) }))
    ).toEqual(trust);
    expect(getCachedTrust(repoRow({ source: "chain" }))).toBeNull();
    expect(getCachedTrust(repoRow({ cached_author_trust: null }))).toBeNull();
  });
});

describe("partitionAuthorsByTrustFreshness", () => {
  it("classifies fresh, stale, and missing authors", () => {
    const { missing, stale } = partitionAuthorsByTrustFreshness([
      repoRow({ author_pubkey: "Fresh", cached_trust_refreshed_at: fresh() }),
      repoRow({ author_pubkey: "Stale", cached_trust_refreshed_at: old() }),
      repoRow({ author_pubkey: "Missing", cached_author_trust: null }),
    ]);
    expect(missing).toEqual(["Missing"]);
    expect(stale).toEqual(["Stale"]);
  });

  it("treats an unparseable refreshed_at as stale", () => {
    const { stale } = partitionAuthorsByTrustFreshness([
      repoRow({
        author_pubkey: "Bad",
        cached_trust_refreshed_at: "not-a-date",
      }),
    ]);
    expect(stale).toEqual(["Bad"]);
  });

  it("dedupes an author across rows, preferring the cached entry", () => {
    const { missing, stale } = partitionAuthorsByTrustFreshness([
      repoRow({
        author_pubkey: "Dupe",
        source: "chain",
        cached_author_trust: null,
      }),
      repoRow({ author_pubkey: "Dupe", cached_trust_refreshed_at: fresh() }),
    ]);
    expect(missing).toEqual([]);
    expect(stale).toEqual([]);
  });
});

describe("scheduleBackgroundTrustRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefreshFor.mockResolvedValue({ authors: 0 });
  });

  it("refreshes a non-empty author set", () => {
    scheduleBackgroundTrustRefresh(["A", "B"]);
    expect(mockRefreshFor).toHaveBeenCalledWith(["A", "B"]);
  });

  it("is a no-op for an empty set", () => {
    scheduleBackgroundTrustRefresh([]);
    expect(mockRefreshFor).not.toHaveBeenCalled();
  });
});
