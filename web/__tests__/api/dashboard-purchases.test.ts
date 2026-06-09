import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  mockSend,
  mockDecodePurchase,
  mockFetchAllMaybeSkillListing,
  mockIsAddress,
} = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockDecodePurchase: vi.fn(),
  mockFetchAllMaybeSkillListing: vi.fn(),
  mockIsAddress: vi.fn((value: unknown) => value === "Buyer111111111111111111111111111111111111111"),
}));

vi.mock("@solana/kit", () => ({
  address: vi.fn((value: string) => value),
  createSolanaRpc: vi.fn(() => ({
    getProgramAccounts: vi.fn(() => ({ send: mockSend })),
  })),
  isAddress: mockIsAddress,
}));

vi.mock("@/generated/agentvouch/src/generated/programs", () => ({
  AGENTVOUCH_PROGRAM_ADDRESS: "Program1111111111111111111111111111111111111",
}));

vi.mock("@/generated/agentvouch/src/generated", () => ({
  PURCHASE_DISCRIMINATOR: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
  getPurchaseDecoder: vi.fn(() => ({ decode: mockDecodePurchase })),
  fetchAllMaybeSkillListing: mockFetchAllMaybeSkillListing,
}));

import { GET } from "@/app/api/dashboard/purchases/route";

function makeRequest(buyer: string) {
  return new NextRequest(
    `http://localhost/api/dashboard/purchases?buyer=${encodeURIComponent(
      buyer
    )}`
  );
}

describe("GET /api/dashboard/purchases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAddress.mockImplementation(
      (value: unknown) =>
        value === "Buyer111111111111111111111111111111111111111" ||
        value === "Listing1111111111111111111111111111111111111"
    );
    mockSend.mockResolvedValue([
      {
        pubkey: "Purchase111111111111111111111111111111111111",
        account: { data: ["AA=="] },
      },
    ]);
    mockDecodePurchase.mockReturnValue({
      buyer: "Buyer111111111111111111111111111111111111111",
      skillListing: "Listing1111111111111111111111111111111111111",
      purchasedAt: 123n,
      listingRevision: 1n,
      listingSettlement: "Settlement111111111111111111111111111111111",
      pricePaidUsdcMicros: 1_000_000n,
      authorShareUsdcMicros: 600_000n,
      voucherPoolUsdcMicros: 400_000n,
      usdcMint: "Mint111111111111111111111111111111111111111",
      bump: 255,
    });
    mockFetchAllMaybeSkillListing.mockResolvedValue([
      {
        exists: true,
        data: {
          author: "Author1111111111111111111111111111111111111",
          skillUri: "https://example.com/skill.md",
          name: "Purchased Skill",
          description: "A useful skill",
          priceUsdcMicros: 1_000_000n,
          rewardVault: "RewardVault1111111111111111111111111111111",
          rewardVaultRentPayer: "RentPayer11111111111111111111111111111111",
          currentRevision: 1n,
          currentSettlement: "Settlement111111111111111111111111111111111",
          currentAuthorProceedsVault:
            "AuthorVault11111111111111111111111111111111",
          totalDownloads: 2n,
          totalRevenueUsdcMicros: 1_000_000n,
          totalAuthorRevenueUsdcMicros: 600_000n,
          totalVoucherRevenueUsdcMicros: 400_000n,
          activeRewardStakeUsdcMicros: 1_000_000n,
          activeRewardPositionCount: 1,
          rewardIndexUsdcMicrosX1e12: 0n,
          unclaimedVoucherRevenueUsdcMicros: 0n,
          createdAt: 100n,
          updatedAt: 120n,
          status: 0,
          bump: 254,
          rewardVaultBump: 253,
        },
      },
    ]);
  });

  it("rejects an invalid buyer", async () => {
    const res = await GET(makeRequest("bad"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("buyer");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("returns purchases and related listings with private no-store caching", async () => {
    const res = await GET(
      makeRequest("Buyer111111111111111111111111111111111111111")
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "private, no-store, max-age=0"
    );
    expect(body.purchases).toEqual([
      {
        publicKey: "Purchase111111111111111111111111111111111111",
        account: expect.objectContaining({
          skillListing: "Listing1111111111111111111111111111111111111",
          purchasedAt: "123",
          pricePaidUsdcMicros: "1000000",
        }),
      },
    ]);
    expect(body.listings).toEqual([
      {
        publicKey: "Listing1111111111111111111111111111111111111",
        account: expect.objectContaining({
          name: "Purchased Skill",
          skillUri: "https://example.com/skill.md",
        }),
      },
    ]);
    expect(mockFetchAllMaybeSkillListing).toHaveBeenCalledWith(
      expect.anything(),
      ["Listing1111111111111111111111111111111111111"]
    );
  });
});
