import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  initializeDatabase: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  verifyWalletSignature: vi.fn(),
}));

import { GET } from "@/app/api/keys/route";
import { verifyWalletSignature } from "@/lib/auth";
import { sql } from "@/lib/db";

const mockVerifyWalletSignature =
  verifyWalletSignature as unknown as ReturnType<typeof vi.fn>;
const mockSql = sql as unknown as ReturnType<typeof vi.fn>;

const signedAuth = {
  pubkey: "Wallet111",
  signature: "signature",
  message: "AgentVouch Skill Repo\nAction: list-keys\nTimestamp: 1",
  timestamp: 1,
};

describe("GET /api/keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockReturnValue(
      vi.fn().mockResolvedValue([
        {
          id: "key-1",
          key_prefix: "sk_abc123",
          name: "default",
          permissions: [],
          created_at: "2026-07-10T00:00:00.000Z",
          last_used_at: null,
          revoked_at: null,
        },
      ])
    );
  });

  it("authenticates a signed JSON header so browser GET requests need no body", async () => {
    mockVerifyWalletSignature.mockReturnValue({
      valid: true,
      pubkey: "Wallet111",
    });

    const response = await GET(
      new NextRequest("http://localhost/api/keys", {
        headers: { "X-AgentVouch-Auth": JSON.stringify(signedAuth) },
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      keys: [
        expect.objectContaining({
          id: "key-1",
          key_prefix: "sk_abc123",
        }),
      ],
    });
    expect(mockVerifyWalletSignature).toHaveBeenCalledWith(signedAuth);
  });

  it("rejects a malformed signed auth header", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/keys", {
        headers: { "X-AgentVouch-Auth": "not-json" },
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Malformed X-AgentVouch-Auth header",
    });
    expect(mockVerifyWalletSignature).not.toHaveBeenCalled();
  });
});
