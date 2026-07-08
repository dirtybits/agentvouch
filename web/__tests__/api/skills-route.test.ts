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

vi.mock("@/lib/evmAuth", () => ({
  verifyEvmWalletSignature: vi.fn(),
}));

vi.mock("@/lib/baseAuthorTrust", () => ({
  resolveBaseAuthorTrust: vi.fn(),
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

const mockVerifyBaseSkillListing = vi.fn();
vi.mock("@/lib/baseListingVerification", () => ({
  verifyBaseSkillListing: (...args: unknown[]) =>
    mockVerifyBaseSkillListing(...args),
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
import { verifyEvmWalletSignature } from "@/lib/evmAuth";
import { resolveBaseAuthorTrust } from "@/lib/baseAuthorTrust";
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
const mockVerifyEvmWalletSignature =
  verifyEvmWalletSignature as unknown as ReturnType<typeof vi.fn>;
const mockResolveBaseAuthorTrust =
  resolveBaseAuthorTrust as unknown as ReturnType<typeof vi.fn>;
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
    mockVerifyEvmWalletSignature.mockResolvedValue({
      valid: true,
      pubkey: "0x1111111111111111111111111111111111111111",
    });
    mockVerifyAuthorTrust.mockResolvedValue({ isRegistered: true });
    mockResolveBaseAuthorTrust.mockResolvedValue({ isRegistered: true });
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

  it("accepts an explicit Base USDC currency mint on paid Base publishes", async () => {
    const dbQuery = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "uuid-base-skill",
          skill_id: "base-skill",
          author_pubkey: "0x1111111111111111111111111111111111111111",
          name: "Base Skill",
          description: "Base paid skill",
          tags: [],
          current_version: 1,
          ipfs_cid: "bafy-test-cid",
          on_chain_address: null,
          chain_context: "eip155:84532",
          price_usdc_micros: "10000",
          currency_mint: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
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
          pubkey: "0x1111111111111111111111111111111111111111",
          signature: "sig",
          message: "msg",
          timestamp: Date.now(),
        },
        skill_id: "base-skill",
        name: "Base Skill",
        description: "Base paid skill",
        tags: [],
        content: "# Base Skill\n\nHello",
        chain_context: "eip155:84532",
        price_usdc_micros: "10000",
        currency_mint: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
      })
    );

    expect(res.status).toBe(201);
    expect(dbQuery.mock.calls[0][17]).toBe("eip155:84532");
    expect(dbQuery.mock.calls[0][18]).toBe("10000");
    expect(dbQuery.mock.calls[0][19]).toBe(
      "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
    );
  });

  it("rejects a Solana currency mint on paid Base publishes", async () => {
    const dbQuery = vi.fn();
    mockSql.mockReturnValue(dbQuery);

    const res = await POST(
      makeRequest({
        auth: {
          pubkey: "0x1111111111111111111111111111111111111111",
          signature: "sig",
          message: "msg",
          timestamp: Date.now(),
        },
        skill_id: "base-skill",
        name: "Base Skill",
        description: "Base paid skill",
        tags: [],
        content: "# Base Skill\n\nHello",
        chain_context: "eip155:84532",
        price_usdc_micros: "10000",
        currency_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      })
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "currency_mint must be a valid Base USDC address",
    });
    expect(mockInitializeDatabase).not.toHaveBeenCalled();
    expect(dbQuery).not.toHaveBeenCalled();
  });

  it("rejects a Solana-signed publish that tries to stamp a Base chain context", async () => {
    const dbQuery = vi.fn();
    mockSql.mockReturnValue(dbQuery);

    const res = await POST(
      makeRequest({
        auth: {
          pubkey: "AuthorWallet1111111111111111111111111111111",
          signature: "sig",
          message: "msg",
          timestamp: Date.now(),
        },
        skill_id: "base-stamped-by-solana",
        name: "Base Stamped By Solana",
        description: "Should fail before DB writes",
        tags: [],
        content: "# Base Stamped By Solana\n\nHello",
        chain_context: "eip155:84532",
        price_usdc_micros: "10000",
      })
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error:
        "Wallet-authored skills must use the signing wallet chain context.",
    });
    expect(mockInitializeDatabase).not.toHaveBeenCalled();
    expect(dbQuery).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/skills/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyBaseSkillListing.mockResolvedValue({
      authorAddress: "0x1111111111111111111111111111111111111111",
      txHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      listingId:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      skillIdHash:
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      priceUsdcMicros: "10000",
      currencyMint: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      protocolVersion: "base-poc-v0",
      onChainProgramId: "0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854",
      chainContext: "eip155:84532",
      listingRevision: "1",
    });
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

  it("links a Base listing only after verifying the Base tx and row author", async () => {
    const baseSkill = {
      id: "uuid-skill-1",
      skill_id: "my-skill",
      author_pubkey: "0x1111111111111111111111111111111111111111",
      name: "My Skill",
      description: "Test description",
      price_usdc_micros: "10000",
      currency_mint: null,
      chain_context: "eip155:84532",
      on_chain_protocol_version: null,
      on_chain_program_id: null,
      evm_listing_id: null,
      evm_contract_address: null,
    };
    const updated = {
      ...baseSkill,
      evm_listing_id:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      evm_contract_address: "0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854",
      evm_tx_hash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      currency_mint: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      total_installs: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const dbQuery = vi
      .fn()
      .mockResolvedValueOnce([baseSkill])
      .mockResolvedValueOnce([updated]);
    mockSql.mockReturnValue(dbQuery);

    const res = await PATCH(
      new NextRequest("http://localhost/api/skills/uuid-skill-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: {
            pubkey: "0x1111111111111111111111111111111111111111",
            signature: "0xsigned",
            message: "AgentVouch Skill Repo\nAction: link-base-listing",
            timestamp: Date.now(),
          },
          baseListing: {
            txHash:
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            authorAddress: "0x1111111111111111111111111111111111111111",
            chainContext: "eip155:84532",
            expectedPriceUsdcMicros: "10000",
          },
        }),
      }),
      { params: Promise.resolve({ id: "uuid-skill-1" }) }
    );

    expect(res.status).toBe(200);
    expect(mockVerifyBaseSkillListing).toHaveBeenCalledWith({
      skill: baseSkill,
      mode: "create",
      txHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      authorAddress: "0x1111111111111111111111111111111111111111",
      expectedPriceUsdcMicros: "10000",
      expectedUri: "https://agentvouch.xyz/api/skills/uuid-skill-1/raw",
    });
    expect(dbQuery).toHaveBeenCalledTimes(2);
  });

  it("rejects a baseListing PATCH without wallet signature auth (Bugbot #78)", async () => {
    const baseSkill = {
      id: "uuid-skill-1",
      skill_id: "skill-one",
      author_pubkey: "0x1111111111111111111111111111111111111111",
      name: "Skill One",
      description: "desc",
      price_usdc_micros: "10000",
      currency_mint: null,
      chain_context: "eip155:84532",
      on_chain_protocol_version: null,
      on_chain_program_id: null,
      evm_listing_id: null,
      evm_contract_address: null,
    };
    const dbQuery = vi.fn().mockResolvedValueOnce([baseSkill]);
    mockSql.mockReturnValue(dbQuery);

    const res = await PATCH(
      new NextRequest("http://localhost/api/skills/uuid-skill-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseListing: {
            relinkExisting: true,
            authorAddress: "0x1111111111111111111111111111111111111111",
            chainContext: "eip155:84532",
          },
        }),
      }),
      { params: Promise.resolve({ id: "uuid-skill-1" }) }
    );

    expect(res.status).toBe(401);
    expect(mockVerifyBaseSkillListing).not.toHaveBeenCalled();
  });

  it("relinks an existing Base listing without requiring the original tx hash", async () => {
    const baseSkill = {
      id: "uuid-skill-1",
      skill_id: "my-skill",
      author_pubkey: "0x1111111111111111111111111111111111111111",
      name: "My Skill",
      description: "Test description",
      price_usdc_micros: "10000",
      currency_mint: null,
      chain_context: "eip155:84532",
      on_chain_protocol_version: null,
      on_chain_program_id: null,
      evm_listing_id: null,
      evm_contract_address: null,
    };
    const updated = {
      ...baseSkill,
      evm_listing_id:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      evm_contract_address: "0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854",
      evm_tx_hash: null,
      currency_mint: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      total_installs: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockVerifyBaseSkillListing.mockResolvedValueOnce({
      authorAddress: "0x1111111111111111111111111111111111111111",
      txHash: null,
      listingId:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      skillIdHash:
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      priceUsdcMicros: "10000",
      currencyMint: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      protocolVersion: "base-poc-v0",
      onChainProgramId: "0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854",
      chainContext: "eip155:84532",
      listingRevision: "1",
    });
    const dbQuery = vi
      .fn()
      .mockResolvedValueOnce([baseSkill])
      .mockResolvedValueOnce([updated]);
    mockSql.mockReturnValue(dbQuery);

    const res = await PATCH(
      new NextRequest("http://localhost/api/skills/uuid-skill-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: {
            pubkey: "0x1111111111111111111111111111111111111111",
            signature: "0xsigned",
            message: "AgentVouch Skill Repo\nAction: link-base-listing",
            timestamp: Date.now(),
          },
          baseListing: {
            relinkExisting: true,
            authorAddress: "0x1111111111111111111111111111111111111111",
            chainContext: "eip155:84532",
          },
        }),
      }),
      { params: Promise.resolve({ id: "uuid-skill-1" }) }
    );

    expect(res.status).toBe(200);
    expect(mockVerifyBaseSkillListing).toHaveBeenCalledWith({
      skill: baseSkill,
      mode: "create",
      txHash: null,
      authorAddress: "0x1111111111111111111111111111111111111111",
      expectedPriceUsdcMicros: null,
      expectedUri: "https://agentvouch.xyz/api/skills/uuid-skill-1/raw",
    });
    expect(dbQuery).toHaveBeenCalledTimes(2);
  });

  it("updates a Base listing only after verifying the update tx and expected fields", async () => {
    const baseSkill = {
      id: "uuid-skill-1",
      skill_id: "my-skill",
      author_pubkey: "0x1111111111111111111111111111111111111111",
      name: "Old Skill",
      description: "Old description",
      price_usdc_micros: "10000",
      currency_mint: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      chain_context: "eip155:84532",
      on_chain_protocol_version: "base-poc-v0",
      on_chain_program_id: "0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854",
      evm_listing_id:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      evm_contract_address: "0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854",
    };
    const updated = {
      ...baseSkill,
      name: "New Skill",
      description: "New description",
      price_usdc_micros: "20000",
      evm_tx_hash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      total_installs: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockVerifyBaseSkillListing.mockResolvedValueOnce({
      authorAddress: "0x1111111111111111111111111111111111111111",
      txHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      listingId:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      skillIdHash:
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      priceUsdcMicros: "20000",
      currencyMint: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      protocolVersion: "base-poc-v0",
      onChainProgramId: "0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854",
      chainContext: "eip155:84532",
      listingRevision: "2",
    });
    const dbQuery = vi
      .fn()
      .mockResolvedValueOnce([baseSkill])
      .mockResolvedValueOnce([updated]);
    mockSql.mockReturnValue(dbQuery);

    const res = await PATCH(
      new NextRequest("http://localhost/api/skills/uuid-skill-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: {
            pubkey: "0x1111111111111111111111111111111111111111",
            signature: "0xsigned",
            message: "AgentVouch Skill Repo\nAction: update-base-listing",
            timestamp: Date.now(),
          },
          baseListing: {
            mode: "update",
            txHash:
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            authorAddress: "0x1111111111111111111111111111111111111111",
            chainContext: "eip155:84532",
            expectedName: "New Skill",
            expectedDescription: "New description",
            expectedUri: "https://agentvouch.xyz/api/skills/uuid-skill-1/raw",
            expectedPriceUsdcMicros: "20000",
          },
        }),
      }),
      { params: Promise.resolve({ id: "uuid-skill-1" }) }
    );

    expect(res.status).toBe(200);
    expect(mockVerifyBaseSkillListing).toHaveBeenCalledWith({
      skill: baseSkill,
      mode: "update",
      txHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      authorAddress: "0x1111111111111111111111111111111111111111",
      expectedPriceUsdcMicros: "20000",
      expectedUri: "https://agentvouch.xyz/api/skills/uuid-skill-1/raw",
      expectedName: "New Skill",
      expectedDescription: "New description",
    });
    expect(dbQuery).toHaveBeenCalledTimes(2);
  });

  it("rejects Base listing persistence for non-Base skill rows", async () => {
    const dbQuery = vi.fn().mockResolvedValueOnce([
      {
        id: "uuid-skill-1",
        skill_id: "my-skill",
        author_pubkey: "0x1111111111111111111111111111111111111111",
        name: "My Skill",
        description: "Test description",
        price_usdc_micros: "10000",
        currency_mint: null,
        chain_context: "solana:devnet",
        on_chain_protocol_version: null,
        on_chain_program_id: null,
        evm_listing_id: null,
        evm_contract_address: null,
      },
    ]);
    mockSql.mockReturnValue(dbQuery);

    const res = await PATCH(
      new NextRequest("http://localhost/api/skills/uuid-skill-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: {
            pubkey: "0x1111111111111111111111111111111111111111",
            signature: "0xsigned",
            message: "AgentVouch Skill Repo\nAction: link-base-listing",
            timestamp: Date.now(),
          },
          baseListing: {
            txHash:
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            authorAddress: "0x1111111111111111111111111111111111111111",
            chainContext: "eip155:84532",
            expectedPriceUsdcMicros: "10000",
          },
        }),
      }),
      { params: Promise.resolve({ id: "uuid-skill-1" }) }
    );

    expect(res.status).toBe(400);
    expect(mockVerifyBaseSkillListing).not.toHaveBeenCalled();
    expect(dbQuery).toHaveBeenCalledTimes(1);
  });
});
