import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  sql: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  verifyWalletSignature: vi.fn(),
}));

vi.mock("@/lib/ipfs", () => ({
  pinSkillContent: vi.fn(),
}));

import { POST } from "@/app/api/skills/[id]/versions/route";
import { verifyWalletSignature } from "@/lib/auth";
import { sql } from "@/lib/db";
import { pinSkillContent } from "@/lib/ipfs";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockVerifyWalletSignature =
  verifyWalletSignature as unknown as ReturnType<typeof vi.fn>;
const mockPinSkillContent = pinSkillContent as unknown as ReturnType<
  typeof vi.fn
>;

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/skills/uuid-skill/versions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/skills/[id]/versions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects missing auth or content", async () => {
    const res = await POST(makeRequest({ content: "" }), {
      params: Promise.resolve({ id: "uuid-skill" }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects non-author version publishes", async () => {
    const dbQuery = vi.fn().mockResolvedValueOnce([
      {
        id: "uuid-skill",
        skill_id: "calendar-agent",
        author_pubkey: "AuthorWallet1111111111111111111111111111111",
        current_version: 2,
        ipfs_cid: "bafy-existing",
      },
    ]);
    mockSql.mockReturnValue(dbQuery);
    mockVerifyWalletSignature.mockReturnValue({
      valid: true,
      pubkey: "OtherWallet11111111111111111111111111111111",
    });

    const res = await POST(
      makeRequest({
        auth: {
          pubkey: "OtherWallet11111111111111111111111111111111",
          signature: "sig",
          message: "msg",
          timestamp: Date.now(),
        },
        content: "# Updated\n",
      }),
      { params: Promise.resolve({ id: "uuid-skill" }) }
    );

    expect(res.status).toBe(403);
  });

  it("rejects wallet-signed version publishes for unverified publishers", async () => {
    const dbQuery = vi.fn().mockResolvedValueOnce([
      {
        id: "uuid-skill",
        skill_id: "calendar-agent",
        author_pubkey: null,
        current_version: 2,
        ipfs_cid: "bafy-existing",
      },
    ]);
    mockSql.mockReturnValue(dbQuery);
    mockVerifyWalletSignature.mockReturnValue({
      valid: true,
      pubkey: "AuthorWallet1111111111111111111111111111111",
    });

    const res = await POST(
      makeRequest({
        auth: {
          pubkey: "AuthorWallet1111111111111111111111111111111",
          signature: "sig",
          message: "msg",
          timestamp: Date.now(),
        },
        content: "# Updated\n",
      }),
      { params: Promise.resolve({ id: "uuid-skill" }) }
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/has not linked a wallet/i);
  });

  it("pins content and increments the repo version", async () => {
    const dbQuery = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "uuid-skill",
          skill_id: "calendar-agent",
          author_pubkey: "AuthorWallet1111111111111111111111111111111",
          current_version: 2,
          ipfs_cid: "bafy-existing",
        },
      ])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    mockSql.mockReturnValue(dbQuery);
    mockVerifyWalletSignature.mockReturnValue({
      valid: true,
      pubkey: "AuthorWallet1111111111111111111111111111111",
    });
    mockPinSkillContent.mockResolvedValue({
      success: true,
      cid: "bafy-new-version",
    });

    const res = await POST(
      makeRequest({
        auth: {
          pubkey: "AuthorWallet1111111111111111111111111111111",
          signature: "sig",
          message: "msg",
          timestamp: Date.now(),
        },
        content: "# Updated\n",
        changelog: "Improve author actions",
      }),
      { params: Promise.resolve({ id: "uuid-skill" }) }
    );

    expect(res.status).toBe(201);
    expect(mockPinSkillContent).toHaveBeenCalledWith(
      "# Updated\n",
      "calendar-agent",
      3
    );
    expect(dbQuery).toHaveBeenCalledTimes(3);

    const body = await res.json();
    expect(body).toEqual({
      version: 3,
      ipfs: {
        success: true,
        cid: "bafy-new-version",
      },
    });
  });
});
