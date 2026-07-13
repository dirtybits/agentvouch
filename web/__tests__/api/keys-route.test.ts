import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  initializeDatabase: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    verifyWalletSignature: vi.fn(),
  };
});

import { DELETE, GET, POST } from "@/app/api/keys/route";
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

function authFor(action: string) {
  return {
    ...signedAuth,
    message: `AgentVouch Skill Repo\nAction: ${action}\nTimestamp: 1`,
  };
}

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

  it("rejects a valid signature whose message is not scoped to list-keys", async () => {
    const replayedAuth = authFor("download-raw");
    mockVerifyWalletSignature.mockReturnValue({
      valid: true,
      pubkey: "Wallet111",
    });

    const response = await GET(
      new NextRequest("http://localhost/api/keys", {
        headers: { "X-AgentVouch-Auth": JSON.stringify(replayedAuth) },
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'Signature is not for action "list-keys" (got "download-raw").',
    });
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("rejects a signed message whose textual timestamp differs from the payload", async () => {
    const detachedTimestampAuth = { ...authFor("list-keys"), timestamp: 2 };
    mockVerifyWalletSignature.mockReturnValue({
      valid: true,
      pubkey: "Wallet111",
    });

    const response = await GET(
      new NextRequest("http://localhost/api/keys", {
        headers: {
          "X-AgentVouch-Auth": JSON.stringify(detachedTimestampAuth),
        },
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'Message scope mismatch: expected Action "list-keys".',
    });
    expect(mockSql).not.toHaveBeenCalled();
  });
});

describe("API-key mutation signature scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockReturnValue(vi.fn());
    mockVerifyWalletSignature.mockReturnValue({
      valid: true,
      pubkey: "Wallet111",
    });
  });

  it("rejects a valid list signature replayed into key creation", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth: authFor("list-keys"), name: "replayed" }),
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'Signature is not for action "create-key" (got "list-keys").',
    });
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("accepts the canonical create-key action", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "key-1",
          key_prefix: "sk_generated",
          name: "work",
          permissions: [],
          created_at: "2026-07-13T00:00:00.000Z",
        },
      ]);
    mockSql.mockReturnValue(query);

    const response = await POST(
      new NextRequest("http://localhost/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth: authFor("create-key"), name: "work" }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        id: "key-1",
        key_prefix: "sk_generated",
        name: "work",
        key: expect.stringMatching(/^sk_[a-f0-9]{64}$/),
      })
    );
  });

  it("rejects a valid list signature replayed into key revocation", async () => {
    const response = await DELETE(
      new NextRequest("http://localhost/api/keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth: authFor("list-keys"), key_id: "key-1" }),
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'Signature is not for action "revoke-key" (got "list-keys").',
    });
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("accepts the canonical revoke-key action for the owning wallet", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ id: "key-1", owner_pubkey: "Wallet111" }])
      .mockResolvedValueOnce([]);
    mockSql.mockReturnValue(query);

    const response = await DELETE(
      new NextRequest("http://localhost/api/keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: authFor("revoke-key"),
          key_id: "key-1",
        }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      revoked: "key-1",
    });
  });
});
