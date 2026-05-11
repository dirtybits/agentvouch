import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSend, mockListOnChainSkillListings } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockListOnChainSkillListings: vi.fn(),
}));

vi.mock("@solana/kit", () => {
  return {
    createSolanaRpc: () => ({
      getProgramAccounts: () => ({
        send: mockSend,
      }),
    }),
  };
});

vi.mock("@solana/rpc-types", () => ({}));

vi.mock(
  "@/generated/agentvouch/src/generated",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("@/generated/agentvouch/src/generated")
    >();

    return {
      ...actual,
      getAgentProfileDecoder: () => ({
        decode: () => ({
          authority: "Agent1",
          totalVouchStakeUsdcMicros: 500000n,
        }),
      }),
      AGENT_PROFILE_DISCRIMINATOR: new Uint8Array([
        9, 10, 11, 12, 13, 14, 15, 16,
      ]),
    };
  }
);

vi.mock("@/generated/agentvouch/src/generated/programs", () => ({
  AGENTVOUCH_PROGRAM_ADDRESS: "FakeProgramAddr",
}));

vi.mock("@/lib/onchain", () => ({
  listOnChainSkillListings: mockListOnChainSkillListings,
}));

import { GET } from "@/app/api/landing/route";

describe("GET /api/landing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListOnChainSkillListings.mockResolvedValue([]);
  });

  it("returns metrics and featuredSkills on success (empty)", async () => {
    mockSend.mockResolvedValueOnce([]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics).toBeDefined();
    expect(body.metrics.agents).toBe(0);
    expect(body.metrics.skills).toBe(0);
    expect(body.metrics.revenue).toBe(0);
    expect(body.featuredSkills).toEqual([]);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=60");
  });

  it("returns populated metrics with accounts", async () => {
    const fakeAccountData = Buffer.from(new Uint8Array(256)).toString("base64");

    mockListOnChainSkillListings.mockResolvedValueOnce([
      {
        publicKey: "Skill1",
        data: {
          author: "Author1",
          name: "Test Skill",
          description: "A skill",
          priceUsdcMicros: 1000000n,
          totalDownloads: 5n,
          totalRevenueUsdcMicros: 2000000n,
          status: 0,
        },
      },
      {
        publicKey: "Skill2",
        data: {
          author: "Author1",
          name: "Another Skill",
          description: "Another skill",
          priceUsdcMicros: 2000000n,
          totalDownloads: 3n,
          totalRevenueUsdcMicros: 3000000n,
          status: 0,
        },
      },
    ]);
    mockSend.mockResolvedValueOnce([
      { pubkey: "Agent1", account: { data: [fakeAccountData, "base64"] } },
    ]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics.skills).toBe(2);
    expect(body.metrics.agents).toBe(1);
    expect(body.metrics.onChainDownloads).toBe(8);
    expect(body.metrics.revenue).toBe(5000000);
    expect(body.featuredSkills.length).toBeGreaterThan(0);
  });

  it("drops impossible on-chain metric values instead of rendering decoded garbage", async () => {
    mockListOnChainSkillListings.mockResolvedValueOnce([
      {
        publicKey: "Skill1",
        data: {
          author: "Author1",
          name: "Bad Decode",
          description: "Legacy account decoded with the wrong layout",
          priceUsdcMicros: 1000000n,
          totalDownloads: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
          totalRevenueUsdcMicros: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
          status: 0,
        },
      },
    ]);
    mockSend.mockResolvedValueOnce([]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics.onChainDownloads).toBe(0);
    expect(body.metrics.revenue).toBe(0);
    expect(body.featuredSkills[0].account.totalDownloads).toBe(0);
    expect(body.featuredSkills[0].account.totalRevenueUsdcMicros).toBe(0);
  });

  it("returns 500 when RPC fails", async () => {
    mockListOnChainSkillListings.mockRejectedValue(new Error("RPC timeout"));

    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("RPC timeout");
  });
});
