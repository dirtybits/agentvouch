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
import {
  buildApiKeyAuthMessage,
  type ApiKeyAuthAction,
  type ApiKeyAuthPayload,
} from "@/lib/apiKeyAuth";
import { sql } from "@/lib/db";

const mockVerifyWalletSignature =
  verifyWalletSignature as unknown as ReturnType<typeof vi.fn>;
const mockSql = sql as unknown as ReturnType<typeof vi.fn>;

const NONCE_A = "11111111-1111-4111-8111-111111111111";
const NONCE_B = "22222222-2222-4222-8222-222222222222";
const KEY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_KEY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function authFor(
  action: ApiKeyAuthAction,
  input: {
    nonce?: string;
    timestamp?: number;
    audience?: string;
    keyName?: string;
    keyId?: string;
  } = {}
): ApiKeyAuthPayload {
  const timestamp = input.timestamp ?? 1;
  const nonce = input.nonce ?? NONCE_A;
  const audience = input.audience ?? "http://localhost";
  return {
    pubkey: "Wallet111",
    signature: "signature",
    message: buildApiKeyAuthMessage({
      action,
      audience,
      timestamp,
      nonce,
      keyName: input.keyName,
      keyId: input.keyId,
    }),
    timestamp,
    nonce,
  };
}

function signedGet(auth: ApiKeyAuthPayload) {
  return GET(
    new NextRequest("http://localhost/api/keys", {
      headers: { "X-AgentVouch-Auth": JSON.stringify(auth) },
    })
  );
}

function createRequest(auth: ApiKeyAuthPayload, name: unknown) {
  return new NextRequest("http://localhost/api/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ auth, name }),
  });
}

function revokeRequest(auth: ApiKeyAuthPayload, keyId: unknown) {
  return new NextRequest("http://localhost/api/keys", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ auth, key_id: keyId }),
  });
}

describe("GET /api/keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyWalletSignature.mockReturnValue({
      valid: true,
      pubkey: "Wallet111",
    });
  });

  it("consumes a signed one-time nonce before listing keys", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ nonce: NONCE_A }])
      .mockResolvedValueOnce([
        {
          id: KEY_ID,
          key_prefix: "sk_abc123",
          name: "default",
          permissions: [],
          created_at: "2026-07-10T00:00:00.000Z",
          last_used_at: null,
          revoked_at: null,
        },
      ]);
    mockSql.mockReturnValue(query);
    const auth = authFor("list-keys");

    const response = await signedGet(auth);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      keys: [expect.objectContaining({ id: KEY_ID })],
    });
    expect(mockVerifyWalletSignature).toHaveBeenCalledWith(auth);
    expect(query).toHaveBeenCalledTimes(2);
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

  it("rejects wrong action, detached timestamp, and missing nonce before SQL", async () => {
    const wrongAction = authFor("create-key", { keyName: "work" });
    expect((await signedGet(wrongAction)).status).toBe(401);

    const detachedTimestamp = { ...authFor("list-keys"), timestamp: 2 };
    expect((await signedGet(detachedTimestamp)).status).toBe(401);

    const missingNonce = {
      ...authFor("list-keys"),
      nonce: undefined,
    } as unknown as ApiKeyAuthPayload;
    expect((await signedGet(missingNonce)).status).toBe(401);

    expect(mockSql).not.toHaveBeenCalled();
  });

  it("rejects a signature captured on a different deployment origin", async () => {
    const auth = authFor("list-keys", {
      audience: "https://preview.example.com",
    });

    const response = await signedGet(auth);

    expect(response.status).toBe(401);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("rejects malformed signed message values without SQL", async () => {
    const auth = {
      ...authFor("list-keys"),
      message: { signed: true },
    } as unknown as ApiKeyAuthPayload;

    const response = await signedGet(auth);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "API key message must be a string",
    });
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("rejects a reused signed nonce before listing metadata", async () => {
    mockSql.mockReturnValue(vi.fn().mockResolvedValueOnce([]));

    const response = await signedGet(authFor("list-keys"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "API key signature nonce already used",
    });
  });

  it("preserves bearer API-key listing without a wallet nonce", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ owner_pubkey: "Wallet111" }])
      .mockResolvedValueOnce([]);
    mockSql.mockReturnValue(query);

    const response = await GET(
      new NextRequest("http://localhost/api/keys", {
        headers: { Authorization: "Bearer sk_test" },
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ keys: [] });
    expect(mockVerifyWalletSignature).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyWalletSignature.mockReturnValue({
      valid: true,
      pubkey: "Wallet111",
    });
  });

  it("binds the normalized key name and creates one credential", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ nonce: NONCE_A }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: KEY_ID,
          key_prefix: "sk_generated",
          name: "work",
          permissions: [],
          created_at: "2026-07-13T00:00:00.000Z",
        },
      ]);
    mockSql.mockReturnValue(query);

    const response = await POST(
      createRequest(authFor("create-key", { keyName: "work" }), " work ")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        id: KEY_ID,
        name: "work",
        key: expect.stringMatching(/^sk_[a-f0-9]{64}$/),
      })
    );
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0][0].join(" ")).toContain(
      "DELETE FROM api_key_auth_nonces"
    );
  });

  it("rejects name substitution and malformed names before side effects", async () => {
    const substituted = await POST(
      createRequest(authFor("create-key", { keyName: "work" }), "other")
    );
    expect(substituted.status).toBe(401);

    const nonString = await POST(
      createRequest(authFor("create-key", { keyName: "work" }), {
        value: "work",
      })
    );
    expect(nonString.status).toBe(400);

    const tooLong = await POST(
      createRequest(authFor("create-key", { keyName: "work" }), "x".repeat(65))
    );
    expect(tooLong.status).toBe(400);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("allows only one of two concurrent requests using the same nonce", async () => {
    let consumed = false;
    const sqlTexts: string[] = [];
    const query = vi.fn(
      async (strings: TemplateStringsArray): Promise<unknown[]> => {
        const statement = strings.join(" ").replace(/\s+/g, " ").trim();
        sqlTexts.push(statement);
        if (statement.includes("INSERT INTO api_key_auth_nonces")) {
          if (consumed) return [];
          consumed = true;
          return [{ nonce: NONCE_B }];
        }
        if (statement.includes("SELECT id FROM api_keys")) return [];
        if (statement.includes("INSERT INTO api_keys")) {
          return [
            {
              id: KEY_ID,
              key_prefix: "sk_generated",
              name: "work",
              permissions: [],
              created_at: "2026-07-13T00:00:00.000Z",
            },
          ];
        }
        return [];
      }
    );
    mockSql.mockReturnValue(query);
    const auth = authFor("create-key", {
      keyName: "work",
      nonce: NONCE_B,
    });

    const responses = await Promise.all([
      POST(createRequest(auth, "work")),
      POST(createRequest(auth, "work")),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect(
      sqlTexts.filter((statement) =>
        statement.includes("INSERT INTO api_keys (")
      )
    ).toHaveLength(1);
  });

  it("rejects reuse of one nonce across different API-key actions", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ nonce: NONCE_A }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mockSql.mockReturnValue(query);

    const listResponse = await signedGet(authFor("list-keys"));
    const createResponse = await POST(
      createRequest(authFor("create-key", { keyName: "work" }), "work")
    );

    expect(listResponse.status).toBe(200);
    expect(createResponse.status).toBe(409);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("burns a failed nonce and does not query or create an API key", async () => {
    const query = vi.fn().mockResolvedValueOnce([]);
    mockSql.mockReturnValue(query);

    const response = await POST(
      createRequest(authFor("create-key", { keyName: "work" }), "work")
    );

    expect(response.status).toBe(409);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("fails closed when nonce persistence throws", async () => {
    const query = vi.fn().mockRejectedValueOnce(new Error("database offline"));
    mockSql.mockReturnValue(query);

    const response = await POST(
      createRequest(authFor("create-key", { keyName: "work" }), "work")
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "database offline",
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("preserves expired-signature rejection before nonce consumption", async () => {
    mockVerifyWalletSignature.mockReturnValue({
      valid: false,
      pubkey: null,
      error: "Signature expired",
    });

    const response = await POST(
      createRequest(authFor("create-key", { keyName: "work" }), "work")
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Signature expired",
    });
    expect(mockSql).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyWalletSignature.mockReturnValue({
      valid: true,
      pubkey: "Wallet111",
    });
  });

  it("binds the exact key id before revocation", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ nonce: NONCE_A }])
      .mockResolvedValueOnce([{ id: KEY_ID, owner_pubkey: "Wallet111" }])
      .mockResolvedValueOnce([]);
    mockSql.mockReturnValue(query);

    const response = await DELETE(
      revokeRequest(authFor("revoke-key", { keyId: KEY_ID }), KEY_ID)
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      revoked: KEY_ID,
    });
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("rejects key-id substitution and malformed ids before SQL", async () => {
    const substituted = await DELETE(
      revokeRequest(authFor("revoke-key", { keyId: KEY_ID }), OTHER_KEY_ID)
    );
    expect(substituted.status).toBe(401);

    const malformed = await DELETE(
      revokeRequest(authFor("revoke-key", { keyId: KEY_ID }), "key-1")
    );
    expect(malformed.status).toBe(400);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("does not look up or revoke a key when nonce consumption fails", async () => {
    const query = vi.fn().mockResolvedValueOnce([]);
    mockSql.mockReturnValue(query);

    const response = await DELETE(
      revokeRequest(authFor("revoke-key", { keyId: KEY_ID }), KEY_ID)
    );

    expect(response.status).toBe(409);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
