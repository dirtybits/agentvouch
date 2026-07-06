import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  initializeDatabase: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@/lib/trust", () => ({
  verifyAuthorTrust: vi.fn(),
  resolveMultipleAuthorTrust: vi.fn(),
}));

vi.mock("@/lib/baseAuthorTrust", () => ({
  resolveBaseAuthorTrust: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  verifyWalletSignature: vi.fn(),
}));

vi.mock("@/lib/ipfs", () => ({
  pinSkillContent: vi.fn(),
}));

vi.mock("@/lib/agentIdentity", () => ({
  buildLocalCanonicalAgentId: vi.fn((wallet: string) => `local:${wallet}`),
  ensureAgentIdentitySchema: vi.fn(),
  resolveManyAgentIdentitiesByWallet: vi.fn(),
  upsertLocalAgentIdentity: vi.fn(),
}));

vi.mock("@/lib/onchain", () => ({
  listOnChainSkillListings: vi.fn(),
}));

vi.mock("@/lib/purchasePreflight", () => ({
  createPurchasePreflightContext: vi.fn(),
  assessPurchasePreflight: vi.fn(),
  serializePurchasePreflight: vi.fn(),
}));

import { GET } from "@/app/api/skills/route";
import { resolveManyAgentIdentitiesByWallet } from "@/lib/agentIdentity";
import { resolveBaseAuthorTrust } from "@/lib/baseAuthorTrust";
import { sql } from "@/lib/db";
import { listOnChainSkillListings } from "@/lib/onchain";
import {
  assessPurchasePreflight,
  createPurchasePreflightContext,
  serializePurchasePreflight,
} from "@/lib/purchasePreflight";
import { resolveMultipleAuthorTrust } from "@/lib/trust";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockResolveMultipleAuthorTrust =
  resolveMultipleAuthorTrust as unknown as ReturnType<typeof vi.fn>;
const mockResolveBaseAuthorTrust =
  resolveBaseAuthorTrust as unknown as ReturnType<typeof vi.fn>;
const mockResolveManyAgentIdentitiesByWallet =
  resolveManyAgentIdentitiesByWallet as unknown as ReturnType<typeof vi.fn>;
const mockListOnChainSkillListings =
  listOnChainSkillListings as unknown as ReturnType<typeof vi.fn>;
const mockCreatePurchasePreflightContext =
  createPurchasePreflightContext as unknown as ReturnType<typeof vi.fn>;
const mockAssessPurchasePreflight =
  assessPurchasePreflight as unknown as ReturnType<typeof vi.fn>;
const mockSerializePurchasePreflight =
  serializePurchasePreflight as unknown as ReturnType<typeof vi.fn>;

function makeRequest(query = "") {
  return new NextRequest(`http://localhost/api/skills${query}`);
}

describe("GET /api/skills cache headers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockReturnValue(vi.fn().mockResolvedValue([]));
    mockResolveMultipleAuthorTrust.mockResolvedValue(new Map());
    mockResolveBaseAuthorTrust.mockResolvedValue({
      reputationScore: 0,
      totalVouchesReceived: 0,
      totalStakedFor: 0,
      authorBondUsdcMicros: 0,
      totalStakeAtRisk: 0,
      disputesAgainstAuthor: 0,
      disputesUpheldAgainstAuthor: 0,
      activeDisputesAgainstAuthor: 0,
      registeredAt: 0,
      isRegistered: false,
    });
    mockResolveManyAgentIdentitiesByWallet.mockResolvedValue(new Map());
    mockListOnChainSkillListings.mockResolvedValue([]);
    mockCreatePurchasePreflightContext.mockResolvedValue({
      buyer: null,
      buyerBalanceLamports: null,
      purchaseRentLamports: null,
      systemAccountRentExemptLamports: null,
      authorBalanceLamportsByAddress: new Map(),
    });
    mockAssessPurchasePreflight.mockReturnValue({});
    mockSerializePurchasePreflight.mockReturnValue({
      creatorPriceUsdcMicros: 0,
      estimatedPurchaseRentLamports: 0,
      feeBufferLamports: 0,
      estimatedBuyerTotalLamports: 0,
      purchasePreflightStatus: "ok",
      purchasePreflightMessage: null,
      purchaseBlocked: false,
      purchaseBlockError: null,
      priceDisclosure: null,
      purchaseRiskWarning: null,
    });
  });

  it("returns shared cache headers for public responses", async () => {
    const res = await GET(makeRequest("?sort=newest&page=1"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=60");
  });

  it("keeps shared caching when buyer status is not requested", async () => {
    const res = await GET(
      makeRequest("?sort=newest&page=1&buyer=11111111111111111111111111111111")
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=60");
  });

  it("returns fast-mode card rows without RPC enrichment", async () => {
    mockSql.mockReturnValue(
      vi.fn().mockResolvedValue([
        {
          id: "11111111-1111-4111-8111-111111111111",
          skill_id: "fast-skill",
          author_pubkey: "asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw",
          name: "Fast Skill",
          description: null,
          tags: [],
          current_version: 1,
          ipfs_cid: null,
          on_chain_address: null,
          chain_context: "solana:devnet",
          total_installs: 0,
          cached_author_trust: {
            reputationScore: 42,
            totalVouchesReceived: 1,
            totalStakedFor: 1000,
            authorBondUsdcMicros: 0,
            totalStakeAtRisk: 1000,
            disputesAgainstAuthor: 0,
            disputesUpheldAgainstAuthor: 0,
            activeDisputesAgainstAuthor: 0,
            registeredAt: 1,
            isRegistered: true,
          },
          created_at: "2026-05-11T00:00:00.000Z",
          updated_at: "2026-05-11T00:00:00.000Z",
        },
      ])
    );

    const res = await GET(makeRequest("?sort=trusted&page=1&mode=fast"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("X-AgentVouch-Skills-Mode")).toBe("fast");
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=60");
    expect(body.skills[0].skill_id).toBe("fast-skill");
    expect(body.skills[0].author_trust.reputationScore).toBe(42);
    expect(mockListOnChainSkillListings).not.toHaveBeenCalled();
    expect(mockResolveMultipleAuthorTrust).not.toHaveBeenCalled();
    expect(mockResolveManyAgentIdentitiesByWallet).not.toHaveBeenCalled();
    expect(mockCreatePurchasePreflightContext).not.toHaveBeenCalled();
  });

  it("resolves full-mode author identities without write-side effects", async () => {
    const author = "asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw";
    mockSql.mockReturnValue(
      vi.fn().mockResolvedValue([
        {
          id: "11111111-1111-4111-8111-111111111111",
          skill_id: "identity-skill",
          author_pubkey: author,
          name: "Identity Skill",
          description: null,
          tags: [],
          current_version: 1,
          ipfs_cid: null,
          on_chain_address: null,
          chain_context: "solana:devnet",
          total_installs: 0,
          cached_author_trust: {
            reputationScore: 42,
            totalVouchesReceived: 1,
            totalStakedFor: 1000,
            authorBondUsdcMicros: 0,
            totalStakeAtRisk: 1000,
            disputesAgainstAuthor: 0,
            disputesUpheldAgainstAuthor: 0,
            activeDisputesAgainstAuthor: 0,
            registeredAt: 1,
            isRegistered: true,
          },
          created_at: "2026-05-11T00:00:00.000Z",
          updated_at: "2026-05-11T00:00:00.000Z",
        },
      ])
    );

    const res = await GET(makeRequest("?sort=trusted&page=1"));

    expect(res.status).toBe(200);
    expect(mockResolveManyAgentIdentitiesByWallet).toHaveBeenCalledWith(
      [author],
      {
        hasAgentProfileByWallet: new Map([[author, true]]),
        persistDerived: false,
      }
    );
  });

  it("resolves missing Base author trust through the Base contract reader", async () => {
    const author = "0x1111111111111111111111111111111111111111";
    mockResolveBaseAuthorTrust.mockResolvedValue({
      reputationScore: 0,
      totalVouchesReceived: 2,
      totalStakedFor: 3_000_000,
      authorBondUsdcMicros: 5_000_000,
      totalStakeAtRisk: 8_000_000,
      disputesAgainstAuthor: 1,
      disputesUpheldAgainstAuthor: 1,
      activeDisputesAgainstAuthor: 0,
      registeredAt: 1,
      isRegistered: true,
    });
    mockSql.mockReturnValue(
      vi.fn().mockResolvedValue([
        {
          id: "11111111-1111-4111-8111-111111111111",
          skill_id: "base-skill",
          author_pubkey: author,
          name: "Base Skill",
          description: null,
          tags: [],
          current_version: 1,
          ipfs_cid: null,
          on_chain_address: null,
          chain_context: "eip155:84532",
          total_installs: 0,
          cached_author_trust: null,
          cached_trust_refreshed_at: null,
          created_at: "2026-05-11T00:00:00.000Z",
          updated_at: "2026-05-11T00:00:00.000Z",
        },
      ])
    );

    const res = await GET(makeRequest("?sort=trusted&page=1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockResolveBaseAuthorTrust).toHaveBeenCalledWith(author);
    expect(mockResolveMultipleAuthorTrust).not.toHaveBeenCalled();
    expect(body.skills[0].author_trust.totalStakeAtRisk).toBe(8_000_000);
    expect(body.skills[0].author_trust.disputesUpheldAgainstAuthor).toBe(1);
  });

  it("orders searched skills by search rank before sort tie-breakers", async () => {
    const lowerRankAlphabeticalFirst = {
      id: "11111111-1111-4111-8111-111111111111",
      skill_id: "aaa-lower-rank",
      author_pubkey: "2DGYWtztLvPB6GxgGXT16gjCoEf56jEmwSxjMwK21Pg3",
      name: "AAA Lower Rank",
      description: null,
      tags: [],
      current_version: 1,
      ipfs_cid: null,
      on_chain_address: null,
      chain_context: "solana:devnet",
      total_installs: 0,
      search_rank: 0.1,
      created_at: "2026-05-11T00:00:00.000Z",
      updated_at: "2026-05-11T00:00:00.000Z",
    };
    const higherRankAlphabeticalSecond = {
      id: "22222222-2222-4222-8222-222222222222",
      skill_id: "zzz-higher-rank",
      author_pubkey: "asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw",
      name: "ZZZ Higher Rank",
      description: null,
      tags: [],
      current_version: 1,
      ipfs_cid: null,
      on_chain_address: null,
      chain_context: "solana:devnet",
      total_installs: 0,
      search_rank: 0.9,
      created_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z",
    };
    mockSql.mockReturnValue(
      vi
        .fn()
        .mockResolvedValue([
          lowerRankAlphabeticalFirst,
          higherRankAlphabeticalSecond,
        ])
    );

    const res = await GET(makeRequest("?q=ranked&sort=name&mode=fast"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=60");
    expect(
      body.skills.map((skill: { skill_id: string }) => skill.skill_id)
    ).toEqual(["zzz-higher-rank", "aaa-lower-rank"]);
  });

  it("disables shared caching for buyer-status responses", async () => {
    const res = await GET(
      makeRequest(
        "?sort=newest&page=1&buyer=11111111111111111111111111111111&buyerStatus=1"
      )
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "private, no-store, max-age=0"
    );
  });

  it("uses downloads before recency for trusted sort ties", async () => {
    const authorTrust = {
      reputationScore: 42,
      totalVouchesReceived: 1,
      totalStakedFor: 1000,
      authorBondUsdcMicros: 0,
      totalStakeAtRisk: 1000,
      disputesAgainstAuthor: 0,
      disputesUpheldAgainstAuthor: 0,
      activeDisputesAgainstAuthor: 0,
      registeredAt: 1,
      isRegistered: true,
    };
    const olderDownloadedSkill = {
      id: "11111111-1111-4111-8111-111111111111",
      skill_id: "older-downloaded",
      author_pubkey: "2DGYWtztLvPB6GxgGXT16gjCoEf56jEmwSxjMwK21Pg3",
      name: "Older Downloaded",
      description: null,
      tags: [],
      current_version: 1,
      ipfs_cid: null,
      on_chain_address: null,
      chain_context: "solana:devnet",
      total_installs: 2,
      total_downloads: 8,
      cached_author_trust: authorTrust,
      created_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z",
    };
    const newerUnusedSkill = {
      id: "22222222-2222-4222-8222-222222222222",
      skill_id: "newer-unused",
      author_pubkey: "asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw",
      name: "Newer Unused",
      description: null,
      tags: [],
      current_version: 1,
      ipfs_cid: null,
      on_chain_address: null,
      chain_context: "solana:devnet",
      total_installs: 0,
      total_downloads: 0,
      cached_author_trust: authorTrust,
      created_at: "2026-05-11T00:00:00.000Z",
      updated_at: "2026-05-11T00:00:00.000Z",
    };
    mockSql.mockReturnValue(
      vi.fn().mockResolvedValue([newerUnusedSkill, olderDownloadedSkill])
    );

    const res = await GET(makeRequest("?sort=trusted&page=1&mode=fast"));
    const body = await res.json();

    expect(
      body.skills.map((skill: { skill_id: string }) => skill.skill_id)
    ).toEqual(["older-downloaded", "newer-unused"]);
  });

  it("defaults browse ordering to reputation-weighted trusted sort", async () => {
    const lowTrustSkill = {
      id: "11111111-1111-4111-8111-111111111111",
      skill_id: "low-trust",
      author_pubkey: "2DGYWtztLvPB6GxgGXT16gjCoEf56jEmwSxjMwK21Pg3",
      name: "Low Trust",
      description: null,
      tags: [],
      current_version: 1,
      ipfs_cid: null,
      on_chain_address: null,
      chain_context: "solana:devnet",
      total_installs: 0,
      created_at: "2026-05-11T00:00:00.000Z",
      updated_at: "2026-05-11T00:00:00.000Z",
    };
    const highTrustSkill = {
      id: "22222222-2222-4222-8222-222222222222",
      skill_id: "high-trust",
      author_pubkey: "asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw",
      name: "High Trust",
      description: null,
      tags: [],
      current_version: 1,
      ipfs_cid: null,
      on_chain_address: null,
      chain_context: "solana:devnet",
      total_installs: 0,
      created_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z",
    };
    mockSql.mockReturnValue(
      vi.fn().mockResolvedValue([lowTrustSkill, highTrustSkill])
    );
    mockResolveMultipleAuthorTrust.mockResolvedValue(
      new Map([
        [
          lowTrustSkill.author_pubkey,
          {
            reputationScore: 10,
            totalVouchesReceived: 0,
            totalStakedFor: 0,
            authorBondUsdcMicros: 0,
            totalStakeAtRisk: 0,
            disputesAgainstAuthor: 0,
            disputesUpheldAgainstAuthor: 0,
            activeDisputesAgainstAuthor: 0,
            registeredAt: 1,
            isRegistered: true,
          },
        ],
        [
          highTrustSkill.author_pubkey,
          {
            reputationScore: 100,
            totalVouchesReceived: 1,
            totalStakedFor: 1000,
            authorBondUsdcMicros: 0,
            totalStakeAtRisk: 1000,
            disputesAgainstAuthor: 0,
            disputesUpheldAgainstAuthor: 0,
            activeDisputesAgainstAuthor: 0,
            registeredAt: 1,
            isRegistered: true,
          },
        ],
      ])
    );

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(
      body.skills.map((skill: { skill_id: string }) => skill.skill_id)
    ).toEqual(["high-trust", "low-trust"]);
  });
});
