import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockListOnChainSkillListings, mockResolveIdentities, mockSql } =
  vi.hoisted(() => ({
    mockListOnChainSkillListings: vi.fn(),
    mockResolveIdentities: vi.fn(),
    mockSql: vi.fn(),
  }));

vi.mock("@solana/kit", () => ({
  createSolanaRpc: () => ({ getProgramAccounts: () => ({ send: vi.fn() }) }),
}));
vi.mock("@solana/rpc-types", () => ({}));
vi.mock("@/generated/agentvouch/src/generated", () => ({
  getAgentProfileDecoder: () => ({ decode: () => ({}) }),
  AGENT_PROFILE_DISCRIMINATOR: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
}));
vi.mock("@/generated/agentvouch/src/generated/programs", () => ({
  AGENTVOUCH_PROGRAM_ADDRESS: "FakeProgramAddr",
}));
vi.mock("@/lib/onchain", () => ({
  listOnChainSkillListings: mockListOnChainSkillListings,
}));
vi.mock("@/lib/agentIdentity", () => ({
  resolveManyAgentIdentitiesByWallet: mockResolveIdentities,
}));
vi.mock("@/lib/db", () => ({
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
  sql: () => mockSql,
}));

import {
  computeLandingPayloadFromChain,
  readPlatformMetricsSnapshot,
  type AgentProfileScan,
} from "@/lib/platformMetrics";

function scan(overrides: Partial<AgentProfileScan> = {}): AgentProfileScan {
  return {
    count: 0,
    totalStakedUsdcMicros: 0,
    byAuthority: new Map(),
    ...overrides,
  };
}

describe("computeLandingPayloadFromChain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveIdentities.mockResolvedValue(new Map());
    mockSql.mockResolvedValue([{ total_installs: 0 }]);
  });

  it("returns zeroed metrics with no listings or agents", async () => {
    mockListOnChainSkillListings.mockResolvedValue([]);
    const { metrics } = await computeLandingPayloadFromChain({
      agentScan: scan(),
    });
    expect(metrics.skills).toBe(0);
    expect(metrics.agents).toBe(0);
    expect(metrics.revenue).toBe(0);
    expect(metrics.downloads).toBe(0);
  });

  it("aggregates listings + an injected agent scan", async () => {
    mockSql.mockResolvedValue([{ total_installs: "4" }]);
    mockListOnChainSkillListings.mockResolvedValue([
      {
        data: {
          author: "Author1",
          totalDownloads: 5n,
          totalRevenueUsdcMicros: 2000000n,
        },
      },
      {
        data: {
          author: "Author1",
          totalDownloads: 3n,
          totalRevenueUsdcMicros: 3000000n,
        },
      },
    ]);

    const { metrics } = await computeLandingPayloadFromChain({
      agentScan: scan({
        count: 2,
        totalStakedUsdcMicros: 500,
        byAuthority: new Map([
          ["Author1", {}],
        ]) as unknown as AgentProfileScan["byAuthority"],
      }),
    });

    expect(metrics.skills).toBe(2);
    expect(metrics.agents).toBe(2);
    expect(metrics.authors).toBe(1);
    expect(metrics.onChainDownloads).toBe(8);
    expect(metrics.downloads).toBe(12); // 8 on-chain + 4 repo installs
    expect(metrics.revenue).toBe(5000000);
    expect(metrics.staked).toBe(500);
  });

  it("clamps impossible u64 values to 0 instead of rendering garbage", async () => {
    mockListOnChainSkillListings.mockResolvedValue([
      {
        data: {
          author: "Author1",
          totalDownloads: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
          totalRevenueUsdcMicros: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        },
      },
    ]);

    const { metrics } = await computeLandingPayloadFromChain({
      agentScan: scan(),
    });
    expect(metrics.onChainDownloads).toBe(0);
    expect(metrics.revenue).toBe(0);
  });
});

describe("readPlatformMetricsSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps a snapshot row (bigint-as-string) into numeric metrics", async () => {
    mockSql.mockResolvedValue([
      {
        agents: "3",
        authors: "2",
        skills: "5",
        revenue_usdc_micros: "1000000",
        staked_usdc_micros: "2000000",
        on_chain_downloads: "7",
        downloads: "9",
        refreshed_at: "2026-06-08T00:00:00.000Z",
      },
    ]);

    const result = await readPlatformMetricsSnapshot("solana:devnet");
    expect(result?.metrics.agents).toBe(3);
    expect(result?.metrics.revenue).toBe(1000000);
    expect(result?.metrics.downloads).toBe(9);
    expect(result?.refreshedAt).toBe("2026-06-08T00:00:00.000Z");
  });

  it("returns null when no snapshot row exists", async () => {
    mockSql.mockResolvedValue([]);
    const result = await readPlatformMetricsSnapshot("solana:devnet");
    expect(result).toBeNull();
  });
});
