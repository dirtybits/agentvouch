import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  initializeDatabase: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  verifyWalletSignature: vi.fn(),
}));

vi.mock("@/lib/trust", () => ({
  verifyAuthorTrust: vi.fn(),
  resolveMultipleAuthorTrust: vi.fn(),
}));

vi.mock("@/lib/ipfs", () => ({
  pinSkillContent: vi.fn(),
}));

vi.mock("@/lib/agentIdentity", () => ({
  resolveManyAgentIdentitiesByWallet: vi.fn(),
  upsertLocalAgentIdentity: vi.fn(),
}));

import { POST } from "@/app/api/skills/route";
import { verifyWalletSignature } from "@/lib/auth";
import { initializeDatabase, sql } from "@/lib/db";
import { upsertLocalAgentIdentity } from "@/lib/agentIdentity";
import { pinSkillContent } from "@/lib/ipfs";
import { MAX_SKILL_DESCRIPTION_LENGTH } from "@/lib/skillDraft";
import { verifyAuthorTrust } from "@/lib/trust";

const mockInitializeDatabase = initializeDatabase as unknown as ReturnType<
  typeof vi.fn
>;
const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockVerifyWalletSignature =
  verifyWalletSignature as unknown as ReturnType<typeof vi.fn>;
const mockVerifyAuthorTrust = verifyAuthorTrust as unknown as ReturnType<
  typeof vi.fn
>;
const mockPinSkillContent = pinSkillContent as unknown as ReturnType<
  typeof vi.fn
>;
const mockUpsertLocalAgentIdentity =
  upsertLocalAgentIdentity as unknown as ReturnType<typeof vi.fn>;

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/skills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/skills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitializeDatabase.mockResolvedValue(undefined);
    mockVerifyWalletSignature.mockReturnValue({
      valid: true,
      pubkey: "AuthorWallet1111111111111111111111111111111",
    });
    mockVerifyAuthorTrust.mockResolvedValue({ isRegistered: true });
    mockPinSkillContent.mockResolvedValue({
      success: true,
      cid: "bafy-test-cid",
    });
    mockUpsertLocalAgentIdentity.mockResolvedValue({
      id: "agent-1",
      canonicalAgentId: "solana:devnet:agentvouch-local#AuthorWallet",
      identitySource: "local",
      homeChainContext: "solana:devnet",
      status: "active",
      displayName: null,
      bindings: [],
      ownerWallet: "AuthorWallet1111111111111111111111111111111",
      operationalWallet: null,
      agentProfilePda: null,
      registryAsset: null,
    });
  });

  it("initializes the database before inserting a published skill", async () => {
    const dbQuery = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "uuid-skill-1",
          skill_id: "my-skill",
          author_pubkey: "AuthorWallet1111111111111111111111111111111",
          name: "My Skill",
          description: "Test description",
          tags: ["tag-a"],
          current_version: 1,
          ipfs_cid: "bafy-test-cid",
          on_chain_address: null,
          chain_context: "solana:devnet",
          total_installs: 0,
          contact: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ])
      .mockResolvedValueOnce([]);
    mockSql.mockReturnValue(dbQuery);

    const res = await POST(
      makeRequest({
        auth: {
          pubkey: "AuthorWallet1111111111111111111111111111111",
          signature: "sig",
          message: "msg",
          timestamp: Date.now(),
        },
        skill_id: "my-skill",
        name: "My Skill",
        description: "Test description",
        tags: ["tag-a"],
        content: "# My Skill\n\nHello",
      })
    );

    expect(res.status).toBe(201);
    expect(mockInitializeDatabase).toHaveBeenCalledTimes(1);
    expect(mockInitializeDatabase.mock.invocationCallOrder[0]).toBeLessThan(
      mockSql.mock.invocationCallOrder[0]
    );
    expect(mockPinSkillContent).toHaveBeenCalledWith(
      "# My Skill\n\nHello",
      "my-skill",
      1
    );
    expect(mockUpsertLocalAgentIdentity).toHaveBeenCalledWith({
      walletPubkey: "AuthorWallet1111111111111111111111111111111",
      chainContext: expect.any(String),
      hasAgentProfile: true,
    });

    const body = await res.json();
    expect(body.id).toBe("uuid-skill-1");
    expect(body.ipfs).toEqual({
      success: true,
      cid: "bafy-test-cid",
    });
  });

  it("rejects descriptions that exceed the on-chain byte cap", async () => {
    // The on-chain SkillListing account caps description at 256 bytes
    // (MAX_DESCRIPTION_LEN). The API now byte-length-validates and fails
    // fast with a 400 rather than silently truncating, so callers never
    // ship a repo row whose paired on-chain CreateSkillListing would
    // revert with DescriptionTooLong.
    const dbQuery = vi.fn();
    mockSql.mockReturnValue(dbQuery);

    const longDescription = "a".repeat(MAX_SKILL_DESCRIPTION_LENGTH + 25);

    const res = await POST(
      makeRequest({
        auth: {
          pubkey: "AuthorWallet1111111111111111111111111111111",
          signature: "sig",
          message: "msg",
          timestamp: Date.now(),
        },
        skill_id: "my-skill",
        name: "My Skill",
        description: longDescription,
        tags: [],
        content: "# My Skill\n\nHello",
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/description is \d+ bytes/i);
    expect(body.error).toContain(String(MAX_SKILL_DESCRIPTION_LENGTH));
    // No DB write should have happened.
    expect(dbQuery).not.toHaveBeenCalled();
  });
});
