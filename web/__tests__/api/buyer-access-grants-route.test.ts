import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isBuyerCardAccessServerEnabled: vi.fn(),
  getBuyerSession: vi.fn(),
  hasActiveMarketplaceAccessGrant: vi.fn(),
}));

vi.mock("@/lib/buyerAuthConfig", () => ({
  isBuyerCardAccessServerEnabled: mocks.isBuyerCardAccessServerEnabled,
}));

vi.mock("@/lib/buyerSession", () => ({
  getBuyerSession: mocks.getBuyerSession,
}));

vi.mock("@/lib/buyerAccessGrants", () => ({
  hasActiveMarketplaceAccessGrant: mocks.hasActiveMarketplaceAccessGrant,
}));

import { GET } from "@/app/api/account/access-grants/[skillId]/route";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";

describe("GET /api/account/access-grants/[skillId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isBuyerCardAccessServerEnabled.mockReturnValue(true);
    mocks.getBuyerSession.mockResolvedValue({ accountId: ACCOUNT_ID });
    mocks.hasActiveMarketplaceAccessGrant.mockResolvedValue(false);
  });

  it("rejects a malformed skill ID before the access-grant lookup", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/account/access-grants/not-a-uuid"),
      { params: Promise.resolve({ skillId: "not-a-uuid" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      enabled: true,
      authenticated: true,
      hasAccess: false,
    });
    expect(mocks.hasActiveMarketplaceAccessGrant).not.toHaveBeenCalled();
  });
});
