import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  initializeDatabase: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@/lib/trust", () => ({
  resolveMultipleAuthorTrust: vi.fn(),
}));

vi.mock("@/lib/agentIdentity", () => ({
  buildLocalCanonicalAgentId: vi.fn((wallet: string) => `local:${wallet}`),
  resolveManyAgentIdentitiesByWallet: vi.fn(),
}));

vi.mock("@/lib/purchasePreflight", () => ({
  createPurchasePreflightContext: vi.fn(),
  assessPurchasePreflight: vi.fn(),
  serializePurchasePreflight: vi.fn(),
}));

vi.mock("@/lib/usdcPurchases", () => ({
  hasChainUsdcPurchaseEntitlement: vi.fn(),
  hasUsdcPurchaseEntitlement: vi.fn(),
}));

vi.mock("@/lib/x402", () => ({
  getConfiguredUsdcMint: vi.fn(
    () => "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
  ),
  hasOnChainPurchase: vi.fn(),
}));

import { POST } from "@/app/api/skills/hydrate/route";
import { resolveManyAgentIdentitiesByWallet } from "@/lib/agentIdentity";
import { sql } from "@/lib/db";
import {
  assessPurchasePreflight,
  createPurchasePreflightContext,
  serializePurchasePreflight,
} from "@/lib/purchasePreflight";
import { resolveMultipleAuthorTrust } from "@/lib/trust";
import { hasUsdcPurchaseEntitlement } from "@/lib/usdcPurchases";
import { hasOnChainPurchase } from "@/lib/x402";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockResolveMultipleAuthorTrust =
  resolveMultipleAuthorTrust as unknown as ReturnType<typeof vi.fn>;
const mockResolveManyAgentIdentitiesByWallet =
  resolveManyAgentIdentitiesByWallet as unknown as ReturnType<typeof vi.fn>;
const mockCreatePurchasePreflightContext =
  createPurchasePreflightContext as unknown as ReturnType<typeof vi.fn>;
const mockAssessPurchasePreflight =
  assessPurchasePreflight as unknown as ReturnType<typeof vi.fn>;
const mockSerializePurchasePreflight =
  serializePurchasePreflight as unknown as ReturnType<typeof vi.fn>;
const mockHasUsdcPurchaseEntitlement =
  hasUsdcPurchaseEntitlement as unknown as ReturnType<typeof vi.fn>;
const mockHasOnChainPurchase = hasOnChainPurchase as unknown as ReturnType<
  typeof vi.fn
>;

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/skills/hydrate", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/skills/hydrate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockReturnValue(vi.fn().mockResolvedValue([]));
    mockResolveMultipleAuthorTrust.mockResolvedValue(new Map());
    mockResolveManyAgentIdentitiesByWallet.mockResolvedValue(new Map());
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
      priceDisclosure: null,
      purchaseRiskWarning: null,
    });
    mockHasUsdcPurchaseEntitlement.mockResolvedValue(false);
    mockHasOnChainPurchase.mockResolvedValue(false);
  });

  it("returns an empty hydration map when no valid skill ids are provided", async () => {
    const res = await POST(makeRequest({ skillIds: ["chain-not-a-uuid"] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.skills).toEqual({});
    expect(mockResolveMultipleAuthorTrust).not.toHaveBeenCalled();
  });

  it("hydrates visible repo skills with trust, preflight, and buyer status", async () => {
    const skillId = "11111111-1111-4111-8111-111111111111";
    const author = "asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw";
    const buyer = "2DGYWtztLvPB6GxgGXT16gjCoEf56jEmwSxjMwK21Pg3";
    mockSql.mockReturnValue(
      vi.fn().mockResolvedValue([
        {
          id: skillId,
          skill_id: "paid-repo-skill",
          author_pubkey: author,
          name: "Paid Repo Skill",
          description: null,
          tags: [],
          current_version: 1,
          ipfs_cid: null,
          on_chain_address: null,
          chain_context: "solana:devnet",
          total_installs: 0,
          price_usdc_micros: "10000",
          created_at: "2026-05-11T00:00:00.000Z",
          updated_at: "2026-05-11T00:00:00.000Z",
        },
      ])
    );
    mockResolveMultipleAuthorTrust.mockResolvedValue(
      new Map([
        [
          author,
          {
            reputationScore: 88,
            totalVouchesReceived: 2,
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
    mockHasUsdcPurchaseEntitlement.mockResolvedValue(true);

    const res = await POST(
      makeRequest({ skillIds: [skillId], buyer, includeBuyerStatus: true })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "private, no-store, max-age=0"
    );
    expect(body.skills[skillId].author_trust.reputationScore).toBe(88);
    expect(body.skills[skillId].purchasePreflightStatus).toBe("ok");
    expect(body.skills[skillId].buyerHasPurchased).toBe(true);
    expect(mockResolveManyAgentIdentitiesByWallet).toHaveBeenCalledWith(
      [author],
      {
        hasAgentProfileByWallet: new Map([[author, true]]),
        persistDerived: false,
      }
    );
    expect(mockCreatePurchasePreflightContext).toHaveBeenCalledOnce();
    expect(mockHasUsdcPurchaseEntitlement).toHaveBeenCalledWith(skillId, buyer);
  });

  it("reports a linked paid repo skill purchased via Stripe", async () => {
    const skillId = "22222222-2222-4222-8222-222222222222";
    const buyer = "2DGYWtztLvPB6GxgGXT16gjCoEf56jEmwSxjMwK21Pg3";
    mockSql.mockReturnValue(
      vi.fn().mockResolvedValue([
        {
          id: skillId,
          skill_id: "linked-paid-repo-skill",
          author_pubkey: "asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw",
          name: "Linked Paid Repo Skill",
          description: null,
          tags: [],
          current_version: 1,
          ipfs_cid: null,
          on_chain_address: "ChainAddr1111111111111111111111111111111111",
          chain_context: "solana:devnet",
          total_installs: 0,
          price_usdc_micros: "1000000",
          created_at: "2026-05-11T00:00:00.000Z",
          updated_at: "2026-05-11T00:00:00.000Z",
        },
      ])
    );
    mockHasUsdcPurchaseEntitlement.mockResolvedValue(true);

    const res = await POST(
      makeRequest({ skillIds: [skillId], buyer, includeBuyerStatus: true })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.skills[skillId].buyerHasPurchased).toBe(true);
    expect(mockHasUsdcPurchaseEntitlement).toHaveBeenCalledWith(skillId, buyer);
  });
});
