import { beforeEach, describe, expect, it, vi } from "vitest";

const viemMocks = vi.hoisted(() => ({
  createPublicClient: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: viemMocks.createPublicClient,
  };
});

import { resolveBaseAuthorTrust } from "@/lib/baseAuthorTrust";
import { BASE_SEPOLIA_CHAIN_CONTEXT } from "@/lib/chains";

const AUTHOR = "0x1111111111111111111111111111111111111111";
const CONTRACT_A = "0x2222222222222222222222222222222222222222";
const CONTRACT_B = "0x3333333333333333333333333333333333333333";

function profile(stake: bigint) {
  return {
    registered: true,
    metadataUri: "ipfs://profile",
    reputationScore: 10n,
    totalVouchesReceived: 1n,
    totalVouchesGiven: 0n,
    totalVouchStakeReceivedUsdcMicros: stake,
    authorBondUsdcMicros: 0n,
    activeFreeListingCount: 0n,
    openDisputes: 0n,
    upheldDisputes: 0n,
    dismissedDisputes: 0n,
    rewardIndexUsdcMicrosX1e12: 0n,
    unclaimedVoucherRevenueUsdcMicros: 0n,
    registeredAt: 1n,
  };
}

describe("resolveBaseAuthorTrust", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const readContract = vi.fn(
      async (input: { address: string; functionName: string }) => {
        if (input.functionName === "PROTOCOL_VERSION") return "base-v1-a1";
        return input.address.toLowerCase() === CONTRACT_A.toLowerCase()
          ? profile(1_000_000n)
          : profile(2_000_000n);
      }
    );
    viemMocks.createPublicClient.mockReturnValue({
      getChainId: vi.fn().mockResolvedValue(84532),
      readContract,
    });
  });

  it("isolates reads and cache entries by facade contract address", async () => {
    const first = await resolveBaseAuthorTrust(
      AUTHOR,
      BASE_SEPOLIA_CHAIN_CONTEXT,
      CONTRACT_A
    );
    const second = await resolveBaseAuthorTrust(
      AUTHOR,
      BASE_SEPOLIA_CHAIN_CONTEXT,
      CONTRACT_B
    );

    expect(first.totalStakedFor).toBe(1_000_000);
    expect(second.totalStakedFor).toBe(2_000_000);
    expect(viemMocks.createPublicClient).toHaveBeenCalledTimes(2);
  });

  it("fails closed for an invalid contract identity before creating a client", async () => {
    const trust = await resolveBaseAuthorTrust(
      AUTHOR,
      BASE_SEPOLIA_CHAIN_CONTEXT,
      "not-an-address"
    );

    expect(trust.isRegistered).toBe(false);
    expect(viemMocks.createPublicClient).not.toHaveBeenCalled();
  });
});
