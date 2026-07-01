import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockReadSnapshot,
  mockComputeFromChain,
  mockWriteSnapshot,
  mockRefreshSnapshot,
} = vi.hoisted(() => ({
  mockReadSnapshot: vi.fn(),
  mockComputeFromChain: vi.fn(),
  mockWriteSnapshot: vi.fn(),
  mockRefreshSnapshot: vi.fn(),
}));

// Run after() callbacks synchronously so background scheduling is observable.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (cb: () => unknown) => {
      void cb();
    },
  };
});

vi.mock("@/lib/platformMetrics", () => ({
  readPlatformMetricsSnapshot: mockReadSnapshot,
  computeLandingPayloadFromChain: mockComputeFromChain,
  writePlatformMetricsSnapshot: mockWriteSnapshot,
  refreshPlatformMetricsSnapshot: mockRefreshSnapshot,
}));

import { GET } from "@/app/api/landing/route";

const sampleMetrics = {
  agents: 3,
  authors: 2,
  skills: 5,
  revenue: 1000,
  staked: 2000,
  onChainDownloads: 7,
  downloads: 9,
};

describe("GET /api/landing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteSnapshot.mockResolvedValue(undefined);
    mockRefreshSnapshot.mockResolvedValue({ metrics: sampleMetrics });
    mockComputeFromChain.mockResolvedValue({ metrics: sampleMetrics });
  });

  it("serves a fresh snapshot from Postgres without recomputing", async () => {
    mockReadSnapshot.mockResolvedValue({
      metrics: sampleMetrics,
      refreshedAt: new Date().toISOString(),
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics).toEqual(sampleMetrics);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=60");
    expect(mockComputeFromChain).not.toHaveBeenCalled();
    expect(mockRefreshSnapshot).not.toHaveBeenCalled();
  });

  it("serves a stale snapshot immediately and triggers a background refresh", async () => {
    mockReadSnapshot.mockResolvedValue({
      metrics: sampleMetrics,
      refreshedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics).toEqual(sampleMetrics);
    expect(mockComputeFromChain).not.toHaveBeenCalled();
    expect(mockRefreshSnapshot).toHaveBeenCalledOnce();
  });

  it("computes live and persists a snapshot on a cold miss", async () => {
    mockReadSnapshot.mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics).toEqual(sampleMetrics);
    expect(mockComputeFromChain).toHaveBeenCalledOnce();
    expect(mockWriteSnapshot).toHaveBeenCalledWith(sampleMetrics);
  });

  it("falls back to live compute when the snapshot read fails", async () => {
    mockReadSnapshot.mockRejectedValue(new Error("db down"));

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics).toEqual(sampleMetrics);
    expect(mockComputeFromChain).toHaveBeenCalledOnce();
  });

  it("returns 500 when a cold-miss live compute fails", async () => {
    mockReadSnapshot.mockResolvedValue(null);
    mockComputeFromChain.mockRejectedValue(new Error("RPC timeout"));

    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("RPC timeout");
  });
});
