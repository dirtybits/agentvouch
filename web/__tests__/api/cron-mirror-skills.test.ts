import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockSyncMirrorSkills, mockSyncConnectedRepos, mockInitializeDatabase } =
  vi.hoisted(() => ({
    mockSyncMirrorSkills: vi.fn(),
    mockSyncConnectedRepos: vi.fn(),
    mockInitializeDatabase: vi.fn(),
  }));

vi.mock("@/lib/mirror/sync", () => ({
  syncMirrorSkills: mockSyncMirrorSkills,
  syncConnectedRepos: mockSyncConnectedRepos,
}));

vi.mock("@/lib/db", () => ({
  initializeDatabase: mockInitializeDatabase,
  sql: vi.fn(),
}));

import { GET, POST } from "@/app/api/cron/mirror-skills/route";
import { NextRequest } from "next/server";

const emptyCounts = { create: 0, update: 0, unchanged: 0, skip: 0, error: 0 };

function request(
  headers: Record<string, string> = {},
  method: "GET" | "POST" = "GET"
) {
  return new NextRequest("https://example.com/api/cron/mirror-skills", {
    method,
    headers,
  });
}

describe("GET /api/cron/mirror-skills — auth gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitializeDatabase.mockResolvedValue(undefined);
    mockSyncMirrorSkills.mockResolvedValue({
      outcomes: [],
      counts: emptyCounts,
    });
    mockSyncConnectedRepos.mockResolvedValue({
      outcomes: [],
      counts: emptyCounts,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("succeeds without a secret in non-production", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("VERCEL_ENV", "preview");
    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockSyncMirrorSkills).toHaveBeenCalledOnce();
    expect(mockSyncConnectedRepos).toHaveBeenCalledOnce();
  });

  it("fails closed in production when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("VERCEL_ENV", "production");
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(mockSyncMirrorSkills).not.toHaveBeenCalled();
  });

  it("rejects requests without the bearer token when a secret is set", async () => {
    vi.stubEnv("CRON_SECRET", "mysecret");
    vi.stubEnv("VERCEL_ENV", "production");
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(mockSyncMirrorSkills).not.toHaveBeenCalled();
  });

  it("accepts a valid bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "mysecret");
    const res = await GET(request({ authorization: "Bearer mysecret" }));
    expect(res.status).toBe(200);
    expect(mockSyncMirrorSkills).toHaveBeenCalledOnce();
  });

  it("returns 500 when sync throws", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("VERCEL_ENV", "preview");
    mockSyncMirrorSkills.mockRejectedValueOnce(new Error("GitHub is down"));
    const res = await GET(request());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/GitHub is down/);
  });

  it("POST also works (Vercel Cron supports POST)", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("VERCEL_ENV", "preview");
    const res = await POST(request({}, "POST"));
    expect(res.status).toBe(200);
  });

  it("returns 500 and ok:false when mirror has errors", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("VERCEL_ENV", "preview");
    mockSyncMirrorSkills.mockResolvedValue({
      outcomes: [
        {
          source: "anthropic",
          skillId: "foo",
          action: "error",
          detail: "fetch failed",
        },
      ],
      counts: { ...emptyCounts, error: 1 },
    });
    const res = await GET(request());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.changed).toHaveLength(1);
  });
});
