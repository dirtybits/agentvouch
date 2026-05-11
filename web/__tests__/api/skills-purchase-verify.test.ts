import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
  sql: vi.fn(),
}));

const mockVerifyAndRecord = vi.fn();
const mockVerifyDirectPurchase = vi.fn();
vi.mock("@/lib/directPurchaseVerification", () => ({
  verifyDirectPurchase: (...args: unknown[]) =>
    mockVerifyDirectPurchase(...args),
  verifyAndRecordDirectPurchase: (...args: unknown[]) =>
    mockVerifyAndRecord(...args),
}));

vi.mock("@/lib/onchain", () => ({
  fetchOnChainSkillListing: vi.fn(),
}));

vi.mock("@/lib/x402", () => ({
  getConfiguredUsdcMint: vi.fn(() => "Mint"),
}));

vi.mock("@/lib/protocolMetadata", () => ({
  AGENTVOUCH_PROTOCOL_VERSION: "v0.2.0",
  getAgentVouchChainContext: vi.fn(
    () => "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
  ),
  getAgentVouchProgramId: vi.fn(() => "Program"),
}));

import { POST } from "@/app/api/skills/[id]/purchase/verify/route";
import { sql } from "@/lib/db";
import { fetchOnChainSkillListing } from "@/lib/onchain";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockFetchOnChainSkillListing =
  fetchOnChainSkillListing as unknown as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown) {
  const req = new NextRequest(
    "http://localhost/api/skills/00000000-0000-0000-0000-000000000001/purchase/verify",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
  return {
    req,
    params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }),
  };
}

describe("POST /api/skills/[id]/purchase/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records direct purchase entitlements through the shared helper", async () => {
    const skill = {
      id: "00000000-0000-0000-0000-000000000001",
      on_chain_address: "Listing",
      author_pubkey: "Author",
      price_usdc_micros: "1000000",
      currency_mint: "Mint",
      chain_context: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      on_chain_protocol_version: "v0.2.0",
      on_chain_program_id: "Program",
    };
    mockSql.mockReturnValue(vi.fn().mockResolvedValue([skill]));
    mockVerifyAndRecord.mockResolvedValue({
      buyerPubkey: "Buyer",
      listingAddress: "Listing",
      purchasePda: "PurchasePDA",
      signature: "txsig",
      amountMicros: "1000000",
      currencyMint: "Mint",
      paymentFlow: "direct-purchase-skill",
      protocolVersion: "v0.2.0",
      onChainProgramId: "Program",
      chainContext: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    });

    const { req, params } = makeRequest({
      signature: "txsig",
      buyer: "Buyer",
      listingAddress: "Listing",
    });
    const res = await POST(req, { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.entitlement.payment_flow).toBe("direct-purchase-skill");
    expect(mockVerifyAndRecord).toHaveBeenCalledWith({
      skill,
      signature: "txsig",
      buyerPubkey: "Buyer",
      listingAddress: "Listing",
    });
    expect(mockVerifyDirectPurchase).not.toHaveBeenCalled();
  });

  it("verifies chain-only purchases without requiring a database skill row", async () => {
    mockFetchOnChainSkillListing.mockResolvedValue({
      publicKey: "4wPBTQtYbE46fLRyRBf43AnQHkmYxzEhGPfeiwbJoGZF",
      data: {
        author: "Author",
        priceUsdcMicros: 1000000n,
      },
    });
    mockVerifyDirectPurchase.mockResolvedValue({
      buyerPubkey: "Buyer",
      listingAddress: "4wPBTQtYbE46fLRyRBf43AnQHkmYxzEhGPfeiwbJoGZF",
      purchasePda: "PurchasePDA",
      signature: "txsig",
      amountMicros: "1000000",
      currencyMint: "Mint",
      paymentFlow: "direct-purchase-skill",
      protocolVersion: "v0.2.0",
      onChainProgramId: "Program",
      chainContext: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    });

    const req = new NextRequest(
      "http://localhost/api/skills/chain-4wPBTQtYbE46fLRyRBf43AnQHkmYxzEhGPfeiwbJoGZF/purchase/verify",
      {
        method: "POST",
        body: JSON.stringify({
          signature: "txsig",
          buyer: "Buyer",
          listingAddress: "4wPBTQtYbE46fLRyRBf43AnQHkmYxzEhGPfeiwbJoGZF",
        }),
        headers: { "Content-Type": "application/json" },
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({
        id: "chain-4wPBTQtYbE46fLRyRBf43AnQHkmYxzEhGPfeiwbJoGZF",
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.entitlement.skill_id).toBe(
      "chain-4wPBTQtYbE46fLRyRBf43AnQHkmYxzEhGPfeiwbJoGZF"
    );
    expect(mockSql).not.toHaveBeenCalled();
    expect(mockVerifyAndRecord).not.toHaveBeenCalled();
    expect(mockVerifyDirectPurchase).toHaveBeenCalledWith({
      skill: {
        id: "chain-4wPBTQtYbE46fLRyRBf43AnQHkmYxzEhGPfeiwbJoGZF",
        on_chain_address: "4wPBTQtYbE46fLRyRBf43AnQHkmYxzEhGPfeiwbJoGZF",
        author_pubkey: "Author",
        price_usdc_micros: "1000000",
        currency_mint: "Mint",
        chain_context: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
        on_chain_protocol_version: "v0.2.0",
        on_chain_program_id: "Program",
      },
      signature: "txsig",
      buyerPubkey: "Buyer",
      listingAddress: "4wPBTQtYbE46fLRyRBf43AnQHkmYxzEhGPfeiwbJoGZF",
    });
  });

  it("returns 400 when signature is missing", async () => {
    const { req, params } = makeRequest({});
    const res = await POST(req, { params });

    expect(res.status).toBe(400);
    expect(mockVerifyAndRecord).not.toHaveBeenCalled();
  });
});
