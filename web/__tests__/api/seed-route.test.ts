import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockSql = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  sql: () => mockSql,
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/chains", () => ({
  getConfiguredSolanaChainContext: () => "solana:devnet",
}));

import { POST } from "@/app/api/seed/route";

function request(
  headers: Record<string, string> = {},
  method: "GET" | "POST" = "POST"
): NextRequest {
  return new NextRequest("https://example.com/api/seed", {
    method,
    headers,
  });
}

describe("POST /api/seed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("seeds into an empty database in local development without a secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("VERCEL_ENV", "");
    // First query: SELECT COUNT(*) -> 0 rows exist. Second: INSERT skills.
    // Third: INSERT skill_versions.
    mockSql.mockResolvedValueOnce([{ count: "0" }]);
    mockSql.mockResolvedValueOnce([
      { id: "11111111-1111-1111-1111-111111111111" },
    ]);
    mockSql.mockResolvedValueOnce([]);

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockSql).toHaveBeenCalledTimes(3);
  });

  it("skips seeding when data already exists", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("VERCEL_ENV", "");
    mockSql.mockResolvedValueOnce([{ count: "5" }]);

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.skipped).toBe(true);
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it("fails closed in production when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("VERCEL_ENV", "production");

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("fails closed in preview when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("VERCEL_ENV", "preview");

    const res = await POST(request());

    expect(res.status).toBe(401);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("rejects requests without the bearer token when a secret is set", async () => {
    vi.stubEnv("CRON_SECRET", "topsecret");
    vi.stubEnv("VERCEL_ENV", "production");

    const res = await POST(request());

    expect(res.status).toBe(401);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("rejects a wrong bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "topsecret");
    vi.stubEnv("VERCEL_ENV", "production");

    const res = await POST(request({ authorization: "Bearer wrong" }));

    expect(res.status).toBe(401);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("accepts a valid bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "topsecret");
    vi.stubEnv("VERCEL_ENV", "production");
    mockSql.mockResolvedValueOnce([{ count: "0" }]);
    mockSql.mockResolvedValueOnce([
      { id: "11111111-1111-1111-1111-111111111111" },
    ]);
    mockSql.mockResolvedValueOnce([]);

    const res = await POST(request({ authorization: "Bearer topsecret" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});
