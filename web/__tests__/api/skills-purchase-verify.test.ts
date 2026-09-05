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

const mockVerifyAndRecordBaseDirectPurchase = vi.fn();
const mockVerifyAndRecordBaseExistingPurchase = vi.fn();
vi.mock("@/lib/basePurchaseVerification", () => ({
  verifyAndRecordBaseDirectPurchase: (...args: unknown[]) =>
    mockVerifyAndRecordBaseDirectPurchase(...args),
  verifyAndRecordBaseExistingPurchase: (...args: unknown[]) =>
    mockVerifyAndRecordBaseExistingPurchase(...args),
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
import { initializeDatabase, sql } from "@/lib/db";
import { fetchOnChainSkillListing } from "@/lib/onchain";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockInitializeDatabase = initializeDatabase as unknown as ReturnType<
  typeof vi.fn
>;
const mockFetchOnChainSkillListing =
  fetchOnChainSkillListing as unknown as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown) {
  const req = new NextRequest(
    "http://localhost/api/skills/00000000-0000-4000-8000-000000000001/purchase/verify",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
  return {
    req,
    params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }),
  };
}

describe("POST /api/skills/[id]/purchase/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects malformed repo skill ids before parsing or database work", async () => {
    const req = new NextRequest(
      "http://localhost/api/skills/not-a-uuid/purchase/verify",
      {
        method: "POST",
        body: JSON.stringify({ signature: "txsig" }),
        headers: { "Content-Type": "application/json" },
      }
    );

    const res = await POST(req, {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Skill not found" });
    expect(mockInitializeDatabase).not.toHaveBeenCalled();
    expect(mockSql).not.toHaveBeenCalled();
    expect(mockVerifyAndRecord).not.toHaveBeenCalled();
    expect(mockVerifyDirectPurchase).not.toHaveBeenCalled();
    expect(mockVerifyAndRecordBaseDirectPurchase).not.toHaveBeenCalled();
    expect(mockVerifyAndRecordBaseExistingPurchase).not.toHaveBeenCalled();
  });

  it("records direct purchase entitlements through the shared helper", async () => {
    const skill = {
      id: "00000000-0000-4000-8000-000000000001",
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

  it("rejects listing-only input before database initialization", async () => {
    const { req, params } = makeRequest({ listingId: `0x${"1".repeat(64)}` });

    const res = await POST(req, { params });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Missing transaction signature",
    });
    expect(mockInitializeDatabase).not.toHaveBeenCalled();
    expect(mockSql).not.toHaveBeenCalled();
    expect(mockVerifyAndRecordBaseExistingPurchase).not.toHaveBeenCalled();
  });

  it("preserves Base existing-purchase verification without a transaction reference", async () => {
    const listingId = `0x${"1".repeat(64)}`;
    const buyer = "0x1111111111111111111111111111111111111111";
    const skill = {
      id: "00000000-0000-4000-8000-000000000001",
      on_chain_address: null,
      author_pubkey: "0x2222222222222222222222222222222222222222",
      price_usdc_micros: "1000000",
      currency_mint: null,
      chain_context: "eip155:84532",
      on_chain_protocol_version: "base-v1-candidate",
      on_chain_program_id: "0x3333333333333333333333333333333333333333",
      evm_listing_id: listingId,
      evm_contract_address: "0x3333333333333333333333333333333333333333",
      evm_tx_hash: null,
    };
    mockSql.mockReturnValue(vi.fn().mockResolvedValue([skill]));
    mockVerifyAndRecordBaseExistingPurchase.mockResolvedValue({
      buyerAddress: buyer,
      chainContext: "eip155:84532",
      txHash: `0x${"2".repeat(64)}`,
      listingId,
      purchaseId: `0x${"3".repeat(64)}`,
      amountMicros: "1000000",
      currencyMint: "0x4200000000000000000000000000000000000006",
      paymentFlow: "direct-purchase-skill",
      protocolVersion: "base-v1-candidate",
      onChainProgramId: skill.evm_contract_address,
      listingRevision: "1",
    });

    const { req, params } = makeRequest({ buyer });
    const res = await POST(req, { params });

    expect(res.status).toBe(200);
    expect(mockVerifyAndRecordBaseExistingPurchase).toHaveBeenCalledWith({
      skill: {
        id: skill.id,
        price_usdc_micros: skill.price_usdc_micros,
        currency_mint: skill.currency_mint,
        chain_context: skill.chain_context,
        on_chain_protocol_version: skill.on_chain_protocol_version,
        on_chain_program_id: skill.on_chain_program_id,
        evm_listing_id: skill.evm_listing_id,
        evm_contract_address: skill.evm_contract_address,
      },
      buyerAddress: buyer,
      listingId: null,
      expectedPriceUsdcMicros: null,
    });
  });

  it("rejects a literal null body before database initialization", async () => {
    const { req, params } = makeRequest(null);

    const res = await POST(req, { params });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "Missing transaction signature" });
    expect(mockInitializeDatabase).not.toHaveBeenCalled();
    expect(mockSql).not.toHaveBeenCalled();
    expect(mockVerifyAndRecord).not.toHaveBeenCalled();
    expect(mockVerifyDirectPurchase).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before database initialization", async () => {
    const req = new NextRequest(
      "http://localhost/api/skills/00000000-0000-4000-8000-000000000001/purchase/verify",
      {
        method: "POST",
        body: "{",
        headers: { "Content-Type": "application/json" },
      }
    );

    const res = await POST(req, {
      params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "Request body must be valid JSON" });
    expect(mockInitializeDatabase).not.toHaveBeenCalled();
    expect(mockSql).not.toHaveBeenCalled();
    expect(mockVerifyAndRecord).not.toHaveBeenCalled();
    expect(mockVerifyDirectPurchase).not.toHaveBeenCalled();
  });
});
