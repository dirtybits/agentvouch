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

vi.mock("@/lib/auth", () => ({
  verifyWalletSignature: vi.fn(),
}));

vi.mock("@/lib/ipfs", () => ({
  pinSkillContent: vi.fn(),
}));

vi.mock("@/lib/agentIdentity", () => ({
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
import { sql } from "@/lib/db";
import { listOnChainSkillListings } from "@/lib/onchain";
import { createPurchasePreflightContext } from "@/lib/purchasePreflight";
import { resolveMultipleAuthorTrust } from "@/lib/trust";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockResolveMultipleAuthorTrust =
  resolveMultipleAuthorTrust as unknown as ReturnType<typeof vi.fn>;
const mockResolveManyAgentIdentitiesByWallet =
  resolveManyAgentIdentitiesByWallet as unknown as ReturnType<typeof vi.fn>;
const mockListOnChainSkillListings =
  listOnChainSkillListings as unknown as ReturnType<typeof vi.fn>;
const mockCreatePurchasePreflightContext =
  createPurchasePreflightContext as unknown as ReturnType<typeof vi.fn>;

function makeRequest(query = "") {
  return new NextRequest(`http://localhost/api/skills${query}`);
}

describe("GET /api/skills cache headers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockReturnValue(vi.fn().mockResolvedValue([]));
    mockResolveMultipleAuthorTrust.mockResolvedValue(new Map());
    mockResolveManyAgentIdentitiesByWallet.mockResolvedValue(new Map());
    mockListOnChainSkillListings.mockResolvedValue([]);
    mockCreatePurchasePreflightContext.mockResolvedValue({
      buyer: null,
      buyerBalanceLamports: null,
      purchaseRentLamports: null,
      systemAccountRentExemptLamports: null,
      authorBalanceLamportsByAddress: new Map(),
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
});
