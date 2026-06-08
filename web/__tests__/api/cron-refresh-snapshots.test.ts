import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockRefreshMetrics, mockRefreshTrust, mockScanAgentProfiles } =
  vi.hoisted(() => ({
    mockRefreshMetrics: vi.fn(),
    mockRefreshTrust: vi.fn(),
    mockScanAgentProfiles: vi.fn(),
  }));

vi.mock("@/lib/platformMetrics", () => ({
  refreshPlatformMetricsSnapshot: mockRefreshMetrics,
  scanAgentProfiles: mockScanAgentProfiles,
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

const fakeScan = {
  count: 2,
  totalStakedUsdcMicros: 500,
  byAuthority: new Map([["Author1", {}]]),
};

describe("GET /api/cron/refresh-snapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScanAgentProfiles.mockResolvedValue(fakeScan);
    mockRefreshMetrics.mockResolvedValue({
      metrics: {
        agents: 2,
        authors: 1,
        skills: 2,
        revenue: 0,
        staked: 500,
        onChainDownloads: 0,
        downloads: 0,
      },
    });
    mockRefreshTrust.mockResolvedValue({ authors: 3 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("shares one agent scan across both refreshes (non-production, no secret)", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("VERCEL_ENV", "preview");
    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.authorTrust.authors).toBe(3);
    expect(mockScanAgentProfiles).toHaveBeenCalledOnce();
    expect(mockRefreshMetrics).toHaveBeenCalledWith({ agentScan: fakeScan });
    expect(mockRefreshTrust).toHaveBeenCalledWith({
      agentProfilesByWallet: fakeScan.byAuthority,
    });
  });

  it("fails closed in production when no secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("VERCEL_ENV", "production");
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(mockScanAgentProfiles).not.toHaveBeenCalled();
    expect(mockRefreshMetrics).not.toHaveBeenCalled();
    expect(mockRefreshTrust).not.toHaveBeenCalled();
  });

  it("rejects requests without the bearer token when a secret is set", async () => {
    vi.stubEnv("CRON_SECRET", "topsecret");
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(mockRefreshMetrics).not.toHaveBeenCalled();
  });

  it("accepts the configured bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "topsecret");
    const res = await GET(request({ authorization: "Bearer topsecret" }));
    expect(res.status).toBe(200);
    expect(mockRefreshMetrics).toHaveBeenCalledOnce();
  });

  it("falls back to independent fetches when the shared scan fails", async () => {
    vi.stubEnv("CRON_SECRET", "");
    mockScanAgentProfiles.mockRejectedValueOnce(new Error("rpc down"));
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(mockRefreshMetrics).toHaveBeenCalledWith(undefined);
    expect(mockRefreshTrust).toHaveBeenCalledWith(undefined);
  });

  it("returns 500 when a refresh fails", async () => {
    vi.stubEnv("CRON_SECRET", "");
    mockRefreshTrust.mockRejectedValueOnce(new Error("db down"));
    const res = await GET(request());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.authorTrust.status).toBe("error");
  });
});
