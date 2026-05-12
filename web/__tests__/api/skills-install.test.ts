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

import { POST } from "@/app/api/skills/[id]/install/route";
import { sql } from "@/lib/db";
import { verifyWalletSignature } from "@/lib/auth";
import { getOnChainUsdcPrice } from "@/lib/onchain";
import { hasOnChainPurchase } from "@/lib/x402";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockVerify = verifyWalletSignature as unknown as ReturnType<typeof vi.fn>;
const mockOnChain = getOnChainUsdcPrice as unknown as ReturnType<typeof vi.fn>;
const mockHasOnChainPurchase = hasOnChainPurchase as unknown as ReturnType<
  typeof vi.fn
>;

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
  });

  it("returns 400 when auth payload is missing", async () => {
    const { req, params } = makeRequest("some-id", {});
    const res = await POST(req, { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("auth");
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
      .mockResolvedValueOnce([{ id: "uuid-1", on_chain_address: null }])
      .mockResolvedValueOnce([{ id: "uuid-1", total_installs: 5 }]);
    mockSql.mockReturnValue(dbQuery);

    const { req, params } = makeRequest("uuid-1", {
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

    const dbQuery = vi
      .fn()
      .mockResolvedValueOnce([{ id: "uuid-2", on_chain_address: "ChainAddr" }]);
    mockSql.mockReturnValue(dbQuery);

    const { req, params } = makeRequest("uuid-2", {
      auth: { pubkey: "Wallet1" },
    });
    const res = await POST(req, { params });
    expect(res.status).toBe(402);
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
      .mockResolvedValueOnce([{ id: "uuid-2", on_chain_address: "ChainAddr" }])
      .mockResolvedValueOnce([{ id: "uuid-2", total_installs: 9 }]);
    mockSql.mockReturnValue(dbQuery);

    const { req, params } = makeRequest("uuid-2", {
      auth: { pubkey: "Wallet1" },
    });
    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_installs).toBe(9);
  });

  it("returns 404 when repo skill not found", async () => {
    mockVerify.mockReturnValue({ valid: true, pubkey: "Wallet1" });

    const dbQuery = vi.fn().mockResolvedValueOnce([]);
    mockSql.mockReturnValue(dbQuery);

    const { req, params } = makeRequest("uuid-missing", {
      auth: { pubkey: "Wallet1" },
    });
    const res = await POST(req, { params });
    expect(res.status).toBe(404);
  });
});
