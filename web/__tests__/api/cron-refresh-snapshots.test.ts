import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockRefreshMetrics, mockRefreshTrust } = vi.hoisted(() => ({
  mockRefreshMetrics: vi.fn(),
  mockRefreshTrust: vi.fn(),
}));

vi.mock("@/lib/platformMetrics", () => ({
  refreshPlatformMetricsSnapshot: mockRefreshMetrics,
}));

vi.mock("@/lib/trustSnapshots", () => ({
  refreshAllAuthorTrustSnapshots: mockRefreshTrust,
}));

import { GET } from "@/app/api/cron/refresh-snapshots/route";

function request(headers: Record<string, string> = {}) {
  return new Request("https://example.com/api/cron/refresh-snapshots", {
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

describe("GET /api/cron/refresh-snapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefreshMetrics.mockResolvedValue({
      metrics: {
        agents: 1,
        authors: 1,
        skills: 2,
        revenue: 0,
        staked: 0,
        onChainDownloads: 0,
        downloads: 0,
      },
    });
    mockRefreshTrust.mockResolvedValue({ authors: 3 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refreshes both snapshots when no secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.authorTrust.authors).toBe(3);
    expect(mockRefreshMetrics).toHaveBeenCalledOnce();
    expect(mockRefreshTrust).toHaveBeenCalledOnce();
  });

  it("rejects requests without the bearer token when a secret is set", async () => {
    vi.stubEnv("CRON_SECRET", "topsecret");
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(mockRefreshMetrics).not.toHaveBeenCalled();
    expect(mockRefreshTrust).not.toHaveBeenCalled();
  });

  it("accepts the configured bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "topsecret");
    const res = await GET(
      request({ authorization: "Bearer topsecret" })
    );
    expect(res.status).toBe(200);
    expect(mockRefreshMetrics).toHaveBeenCalledOnce();
  });

  it("returns 500 when a refresh fails", async () => {
    vi.stubEnv("CRON_SECRET", "");
    mockRefreshTrust.mockRejectedValueOnce(new Error("rpc down"));
    const res = await GET(request());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.authorTrust.status).toBe("error");
  });
});
