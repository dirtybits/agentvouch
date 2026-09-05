import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  sql: vi.fn(),
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/auth", () => ({
  verifyWalletSignature: vi.fn(),
}));

vi.mock("@/lib/onchain", () => ({
  getOnChainUsdcPrice: vi.fn(),
}));

vi.mock("@/lib/x402", () => ({
  hasOnChainPurchase: vi.fn(),
}));

vi.mock("@/lib/usdcPurchases", () => ({
  hasUsdcPurchaseEntitlement: vi.fn(),
}));

vi.mock("@/lib/buyerAuthConfig", () => ({
  isBuyerCardAccessServerEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/buyerSession", () => ({
  getBuyerSession: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/buyerAccessGrants", () => ({
  hasActiveMarketplaceAccessGrant: vi.fn().mockResolvedValue(false),
}));

import { POST } from "@/app/api/skills/[id]/install/route";
import { initializeDatabase, sql } from "@/lib/db";
import { verifyWalletSignature } from "@/lib/auth";
import { getOnChainUsdcPrice } from "@/lib/onchain";
import { hasOnChainPurchase } from "@/lib/x402";
import { hasUsdcPurchaseEntitlement } from "@/lib/usdcPurchases";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockInitializeDatabase = initializeDatabase as unknown as ReturnType<
  typeof vi.fn
>;
const mockVerify = verifyWalletSignature as unknown as ReturnType<typeof vi.fn>;
const mockOnChain = getOnChainUsdcPrice as unknown as ReturnType<typeof vi.fn>;
const mockHasOnChainPurchase = hasOnChainPurchase as unknown as ReturnType<
  typeof vi.fn
>;
const mockHasUsdcEntitlement =
  hasUsdcPurchaseEntitlement as unknown as ReturnType<typeof vi.fn>;

const FREE_REPO_SKILL_ID = "11111111-1111-4111-8111-111111111111";
const PAID_REPO_SKILL_ID = "22222222-2222-4222-8222-222222222222";
const UNLINKED_PAID_REPO_SKILL_ID = "33333333-3333-4333-8333-333333333333";
const MISSING_REPO_SKILL_ID = "44444444-4444-4444-8444-444444444444";

function makeRequest(id: string, body: Record<string, unknown> = {}) {
  const req = new NextRequest(`http://localhost/api/skills/${id}/install`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  const params = Promise.resolve({ id });
  return { req, params };
}

describe("POST /api/skills/[id]/install", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasOnChainPurchase.mockResolvedValue(false);
    mockHasUsdcEntitlement.mockResolvedValue(false);
  });

  it("returns 400 when auth payload is missing", async () => {
    const { req, params } = makeRequest("some-id", {});
    const res = await POST(req, { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("auth");
    expect(mockInitializeDatabase).not.toHaveBeenCalled();
  });

  it.each([
    ["literal null", "null"],
    ["malformed", "{"],
  ])("returns 400 for a %s JSON body", async (_kind, body) => {
    const req = new NextRequest("http://localhost/api/skills/some-id/install", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req, {
      params: Promise.resolve({ id: "some-id" }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Missing auth payload",
    });
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockInitializeDatabase).not.toHaveBeenCalled();
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("returns 400 when request.json throws synchronously", async () => {
    const req = {
      json() {
        throw new Error("invalid body");
      },
    } as unknown as NextRequest;
    const res = await POST(req, {
      params: Promise.resolve({ id: "some-id" }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Missing auth payload",
    });
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockInitializeDatabase).not.toHaveBeenCalled();
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("returns 401 when signature is invalid", async () => {
    mockVerify.mockReturnValue({
      valid: false,
      pubkey: null,
      error: "Invalid signature",
    });
    const { req, params } = makeRequest("some-id", {
      auth: {
        pubkey: "x",
        signature: "y",
        message: "z",
        timestamp: Date.now(),
      },
    });
    const res = await POST(req, { params });
    expect(res.status).toBe(401);
    expect(mockInitializeDatabase).not.toHaveBeenCalled();
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("rejects malformed repo skill ids before database initialization", async () => {
    mockVerify.mockReturnValue({ valid: true, pubkey: "Wallet1" });

    const { req, params } = makeRequest("not-a-uuid", {
      auth: { pubkey: "Wallet1" },
    });
    const res = await POST(req, { params });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Skill not found" });
    expect(mockInitializeDatabase).not.toHaveBeenCalled();
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("returns 200 for free chain-prefixed skill", async () => {
    mockVerify.mockReturnValue({ valid: true, pubkey: "Wallet1" });
    mockOnChain.mockResolvedValue({ priceUsdcMicros: "0", author: "Author1" });
    const { req, params } = makeRequest("chain-ABC123", {
      auth: { pubkey: "Wallet1" },
    });
    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.installed_by).toBe("Wallet1");
    expect(mockInitializeDatabase).not.toHaveBeenCalled();
  });

  it("returns 402 for paid chain-prefixed skill", async () => {
    mockVerify.mockReturnValue({ valid: true, pubkey: "Wallet1" });
    mockOnChain.mockResolvedValue({
      priceUsdcMicros: "1000000",
      author: "Author1",
    });
    const { req, params } = makeRequest("chain-DEF456", {
      auth: { pubkey: "Wallet1" },
    });
    const res = await POST(req, { params });
    expect(res.status).toBe(402);
  });

  it("returns 200 for paid chain-prefixed skill when the wallet already purchased it", async () => {
    mockVerify.mockReturnValue({ valid: true, pubkey: "Wallet1" });
    mockOnChain.mockResolvedValue({
      priceUsdcMicros: "1000000",
      author: "Author1",
    });
    mockHasOnChainPurchase.mockResolvedValue(true);

    const { req, params } = makeRequest("chain-DEF456", {
      auth: { pubkey: "Wallet1" },
    });
    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("returns 404 for missing chain-prefixed skill", async () => {
    mockVerify.mockReturnValue({ valid: true, pubkey: "Wallet1" });
    mockOnChain.mockResolvedValue(null);
    const { req, params } = makeRequest("chain-NOPE", {
      auth: { pubkey: "Wallet1" },
    });
    const res = await POST(req, { params });
    expect(res.status).toBe(404);
  });

  it("returns 200 for free repo skill with no on_chain_address", async () => {
    mockVerify.mockReturnValue({ valid: true, pubkey: "Wallet1" });

    const dbQuery = vi.fn();
    dbQuery
      .mockResolvedValueOnce([
        { id: FREE_REPO_SKILL_ID, on_chain_address: null },
      ])
      .mockResolvedValueOnce([{ id: FREE_REPO_SKILL_ID, total_installs: 5 }]);
    mockSql.mockReturnValue(dbQuery);

    const { req, params } = makeRequest(FREE_REPO_SKILL_ID, {
      auth: { pubkey: "Wallet1" },
    });
    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_installs).toBe(5);
  });

  it("returns 402 for repo skill with paid on-chain listing", async () => {
    mockVerify.mockReturnValue({ valid: true, pubkey: "Wallet1" });
    mockOnChain.mockResolvedValue({
      priceUsdcMicros: "50000000",
      author: "Author2",
    });

    const dbQuery = vi.fn().mockResolvedValueOnce([
      {
        id: PAID_REPO_SKILL_ID,
        on_chain_address: "ChainAddr",
      },
    ]);
    mockSql.mockReturnValue(dbQuery);

    const { req, params } = makeRequest(PAID_REPO_SKILL_ID, {
      auth: { pubkey: "Wallet1" },
    });
    const res = await POST(req, { params });
    expect(res.status).toBe(402);
  });

  it("returns listing-required for unlinked paid repo skills without an entitlement", async () => {
    mockVerify.mockReturnValue({ valid: true, pubkey: "Wallet1" });

    const dbQuery = vi.fn().mockResolvedValueOnce([
      {
        id: UNLINKED_PAID_REPO_SKILL_ID,
        on_chain_address: null,
        price_usdc_micros: "1000000",
      },
    ]);
    mockSql.mockReturnValue(dbQuery);

    const { req, params } = makeRequest(UNLINKED_PAID_REPO_SKILL_ID, {
      auth: { pubkey: "Wallet1" },
    });
    const res = await POST(req, { params });

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.payment_flow).toBe("listing-required");
    expect(body.amount_micros).toBe("1000000");
  });

  it("allows unlinked paid repo installs when a historical entitlement exists", async () => {
    mockVerify.mockReturnValue({ valid: true, pubkey: "Wallet1" });
    mockHasUsdcEntitlement.mockResolvedValue(true);

    const dbQuery = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: UNLINKED_PAID_REPO_SKILL_ID,
          on_chain_address: null,
          price_usdc_micros: "1000000",
        },
      ])
      .mockResolvedValueOnce([
        { id: UNLINKED_PAID_REPO_SKILL_ID, total_installs: 7 },
      ]);
    mockSql.mockReturnValue(dbQuery);

    const { req, params } = makeRequest(UNLINKED_PAID_REPO_SKILL_ID, {
      auth: { pubkey: "Wallet1" },
    });
    const res = await POST(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_installs).toBe(7);
  });

  it("returns 200 for repo skill with paid on-chain listing when the wallet already purchased it", async () => {
    mockVerify.mockReturnValue({ valid: true, pubkey: "Wallet1" });
    mockOnChain.mockResolvedValue({
      priceUsdcMicros: "50000000",
      author: "Author2",
    });
    mockHasOnChainPurchase.mockResolvedValue(true);

    const dbQuery = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: PAID_REPO_SKILL_ID,
          on_chain_address: "ChainAddr",
        },
      ])
      .mockResolvedValueOnce([{ id: PAID_REPO_SKILL_ID, total_installs: 9 }]);
    mockSql.mockReturnValue(dbQuery);

    const { req, params } = makeRequest(PAID_REPO_SKILL_ID, {
      auth: { pubkey: "Wallet1" },
    });
    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_installs).toBe(9);
  });

  it("allows linked paid repo installs with a Stripe entitlement", async () => {
    mockVerify.mockReturnValue({ valid: true, pubkey: "Wallet1" });
    mockHasUsdcEntitlement.mockResolvedValue(true);

    const dbQuery = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: PAID_REPO_SKILL_ID,
          on_chain_address: "ChainAddr",
          price_usdc_micros: "50000000",
        },
      ])
      .mockResolvedValueOnce([{ id: PAID_REPO_SKILL_ID, total_installs: 10 }]);
    mockSql.mockReturnValue(dbQuery);

    const { req, params } = makeRequest(PAID_REPO_SKILL_ID, {
      auth: { pubkey: "Wallet1" },
    });
    const res = await POST(req, { params });

    expect(res.status).toBe(200);
    expect(mockHasUsdcEntitlement).toHaveBeenCalledWith(
      PAID_REPO_SKILL_ID,
      "Wallet1"
    );
  });

  it("returns 404 when repo skill not found", async () => {
    mockVerify.mockReturnValue({ valid: true, pubkey: "Wallet1" });

    const dbQuery = vi.fn().mockResolvedValueOnce([]);
    mockSql.mockReturnValue(dbQuery);

    const { req, params } = makeRequest(MISSING_REPO_SKILL_ID, {
      auth: { pubkey: "Wallet1" },
    });
    const res = await POST(req, { params });
    expect(res.status).toBe(404);
  });
});
