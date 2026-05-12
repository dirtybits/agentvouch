import { beforeEach, describe, expect, it, vi } from "vitest";

const mockBootstrapDatabase = vi.fn();

vi.mock("@/lib/databaseBootstrap", () => ({
  bootstrapDatabase: () => mockBootstrapDatabase(),
}));

import { POST } from "@/app/api/setup/route";

describe("POST /api/setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBootstrapDatabase.mockResolvedValue(undefined);
  });

  it("runs the full database bootstrap", async () => {
    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockBootstrapDatabase).toHaveBeenCalledTimes(1);
  });

  it("returns a 500 when bootstrap fails", async () => {
    mockBootstrapDatabase.mockRejectedValue(new Error("boom"));

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toContain("boom");
  });
});
