import { beforeEach, describe, expect, it, vi } from "vitest";
import { after, NextRequest } from "next/server";

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: vi.fn(),
  };
});

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

vi.mock("@vercel/blob", () => ({
  put: vi.fn().mockResolvedValue({
    url: "https://blob.example/skills/tree.tar",
    downloadUrl: "https://blob.example/skills/tree.tar?download=1",
    pathname: "skills/tree.tar",
  }),
  get: vi.fn(),
}));

vi.mock("@/lib/onchain", () => ({
  fetchOnChainSkillListing: vi.fn(),
  getOnChainUsdcPrice: vi.fn(),
}));

vi.mock("@/lib/agentIdentity", () => ({
  ensureAgentIdentitySchema: vi.fn(),
  resolveManyAgentIdentitiesByWallet: vi.fn(),
  upsertLocalAgentIdentity: vi.fn(),
}));

vi.mock("@/lib/githubOAuth", () => ({
  getGithubSessionFromRequest: vi.fn(),
}));

// Public-slug routing runs real slug-uniqueness sql() queries; stub it so it
// doesn't consume the mocked db response queue meant for the INSERTs. Keep the
// module's other exports real (the PATCH tests rely on them).
vi.mock("@/lib/skillRouteResolver", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/skillRouteResolver")
  >();
  return {
    ...actual,
    buildUniquePublicSkillRoute: vi.fn(async () => ({
      publicAuthorSlug: "author-slug",
      publicSlug: "skill-slug",
    })),
  };
});

import { POST } from "@/app/api/skills/route";
import { PATCH } from "@/app/api/skills/[id]/route";
import { verifyWalletSignature } from "@/lib/auth";
import { initializeDatabase, sql } from "@/lib/db";
import { upsertLocalAgentIdentity } from "@/lib/agentIdentity";
import { pinSkillContent } from "@/lib/ipfs";
import { getOnChainUsdcPrice } from "@/lib/onchain";
import { getGithubSessionFromRequest } from "@/lib/githubOAuth";
import {
  MAX_SKILL_DESCRIPTION_LENGTH,
  MAX_SKILL_UPLOAD_BYTES,
} from "@/lib/skillDraft";
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
const mockGetOnChainUsdcPrice = getOnChainUsdcPrice as unknown as ReturnType<
  typeof vi.fn
>;
const mockGetGithubSessionFromRequest =
  getGithubSessionFromRequest as unknown as ReturnType<typeof vi.fn>;
const mockAfter = after as unknown as ReturnType<typeof vi.fn>;

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/skills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeRawRequest(body: string, headers: Record<string, string>) {
  return new NextRequest("http://localhost/api/skills", {
    method: "POST",
    headers,
    body,
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
    mockGetGithubSessionFromRequest.mockReturnValue(null);
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
    // One after(): runReviewSafe orchestrates the summary + scan passes.
    expect(mockAfter).toHaveBeenCalledTimes(1);
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

  it("allows a GitHub-authenticated publisher to create a free unverified skill", async () => {
    mockGetGithubSessionFromRequest.mockReturnValue({
      provider: "github",
      id: "12345",
      login: "dirtybits",
      name: "Dirty Bits",
      avatarUrl: null,
      createdAt: Date.now(),
    });
    const dbQuery = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "uuid-skill-2",
          skill_id: "free-skill",
          author_pubkey: null,
          author_kind: "github",
          author_external_id: "12345",
          author_handle: "dirtybits",
          author_display_name: "Dirty Bits",
          publisher_identity_key: "github:12345",
          publisher_tier: "unverified",
          name: "Free Skill",
          description: "Free unverified skill",
          tags: [],
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
        skill_id: "free-skill",
        name: "Free Skill",
        description: "Free unverified skill",
        tags: [],
        content: "# Free Skill\n\nHello",
        price_usdc_micros: "0",
      })
    );

    expect(res.status).toBe(201);
    expect(mockVerifyWalletSignature).not.toHaveBeenCalled();
    expect(mockVerifyAuthorTrust).not.toHaveBeenCalled();
    expect(mockUpsertLocalAgentIdentity).not.toHaveBeenCalled();

    const body = await res.json();
    expect(body.author_kind).toBe("github");
    expect(body.author_handle).toBe("dirtybits");
    expect(body.publisher_tier).toBe("unverified");
  });

  it("rejects oversized upload Content-Length before parsing the body", async () => {
    const res = await POST(
      makeRawRequest("not-json", {
        "Content-Type": "application/json",
        "Content-Length": String(MAX_SKILL_UPLOAD_BYTES + 1),
      })
    );

    expect(res.status).toBe(413);
    expect(mockInitializeDatabase).not.toHaveBeenCalled();
    expect(mockPinSkillContent).not.toHaveBeenCalled();
  });

  it("rejects oversized tar_base64 payloads before base64 decoding", async () => {
    const res = await POST(
      makeRequest({
        tar_base64: "a".repeat(MAX_SKILL_UPLOAD_BYTES + 1),
      })
    );

    expect(res.status).toBe(413);
    expect(mockInitializeDatabase).not.toHaveBeenCalled();
    expect(mockPinSkillContent).not.toHaveBeenCalled();
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

describe("PATCH /api/skills/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyWalletSignature.mockReturnValue({
      valid: true,
      pubkey: "AuthorWallet1111111111111111111111111111111",
    });
    mockGetOnChainUsdcPrice.mockResolvedValue({
      priceUsdcMicros: "10000",
      author: "AuthorWallet1111111111111111111111111111111",
    });
  });

  it("bypasses stale on-chain lookup cache when linking a fresh listing", async () => {
    const dbQuery = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "uuid-skill-1",
          author_pubkey: "AuthorWallet1111111111111111111111111111111",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "uuid-skill-1",
          skill_id: "my-skill",
          author_pubkey: "AuthorWallet1111111111111111111111111111111",
          name: "My Skill",
          description: "Test description",
          tags: [],
          current_version: 1,
          ipfs_cid: "bafy-test-cid",
          on_chain_address: "Listing1111111111111111111111111111111111",
          chain_context: "solana:devnet",
          total_installs: 0,
          price_usdc_micros: "10000",
          currency_mint: "UsdcMint1111111111111111111111111111111111",
          on_chain_protocol_version: "v0.2.0",
          on_chain_program_id: "Program1111111111111111111111111111111111",
          contact: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);
    mockSql.mockReturnValue(dbQuery);

    const res = await PATCH(
      new NextRequest("http://localhost/api/skills/uuid-skill-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: {
            pubkey: "AuthorWallet1111111111111111111111111111111",
            signature: "sig",
            message: "msg",
            timestamp: Date.now(),
          },
          on_chain_address: "Listing1111111111111111111111111111111111",
        }),
      }),
      { params: Promise.resolve({ id: "uuid-skill-1" }) }
    );

    expect(res.status).toBe(200);
    expect(mockGetOnChainUsdcPrice).toHaveBeenCalledWith(
      "Listing1111111111111111111111111111111111",
      { useCache: false }
    );
  });
});
