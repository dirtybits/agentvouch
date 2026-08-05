import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  sql: vi.fn(),
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/onchain", () => ({
  getOnChainUsdcPrice: vi.fn(),
}));

import { GET } from "@/app/api/skills/[id]/update/route";
import { initializeDatabase, sql } from "@/lib/db";
import { getOnChainUsdcPrice } from "@/lib/onchain";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockInitializeDatabase = initializeDatabase as unknown as ReturnType<
  typeof vi.fn
>;
const mockOnChain = getOnChainUsdcPrice as unknown as ReturnType<typeof vi.fn>;

const MISSING_REPO_SKILL_ID = "11111111-1111-4111-8111-111111111111";
const PAID_REPO_SKILL_ID = "22222222-2222-4222-8222-222222222222";
const UNLINKED_PAID_REPO_SKILL_ID = "33333333-3333-4333-8333-333333333333";
const FREE_REPO_SKILL_ID = "44444444-4444-4444-8444-444444444444";

function makeRequest(id: string, query = "") {
  const url = new URL(`http://localhost/api/skills/${id}/update${query}`);
  const req = new NextRequest(url, { method: "GET" });
  const params = Promise.resolve({ id });
  return { req, params };
}

describe("GET /api/skills/[id]/update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for chain-only skills", async () => {
    const { req, params } = makeRequest("chain-ListingAddr1");
    const res = await GET(req, { params });

    expect(res.status).toBe(400);
    expect(mockInitializeDatabase).not.toHaveBeenCalled();
    expect(mockSql).not.toHaveBeenCalled();
  });

  it.each(["0", "1.5", "1e2", "1junk"])(
    "returns 400 for invalid installed_version=%s",
    async (installedVersion) => {
      const { req, params } = makeRequest(
        "uuid-1",
        `?installed_version=${installedVersion}`
      );
      const res = await GET(req, { params });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("installed_version");
      expect(mockInitializeDatabase).not.toHaveBeenCalled();
      expect(mockSql).not.toHaveBeenCalled();
    }
  );

  it("rejects malformed repo skill ids before database initialization", async () => {
    const { req, params } = makeRequest("not-a-uuid");
    const res = await GET(req, { params });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Skill not found" });
    expect(mockInitializeDatabase).not.toHaveBeenCalled();
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("returns 404 when the repo skill does not exist", async () => {
    const dbQuery = vi.fn().mockResolvedValueOnce([]);
    mockSql.mockReturnValue(dbQuery);

    const { req, params } = makeRequest(
      MISSING_REPO_SKILL_ID,
      "?installed_version=1"
    );
    const res = await GET(req, { params });

    expect(res.status).toBe(404);
  });

  it("returns update_available with paid listing state", async () => {
    const dbQuery = vi.fn().mockResolvedValueOnce([
      {
        id: PAID_REPO_SKILL_ID,
        skill_id: "calendar-agent",
        current_version: 3,
        updated_at: "2026-04-13T12:00:00.000Z",
        on_chain_address: "ListingAddr2",
      },
    ]);
    mockSql.mockReturnValue(dbQuery);
    mockOnChain.mockResolvedValue({
      priceUsdcMicros: "1000000",
      author: "Author1",
    });

    const { req, params } = makeRequest(
      PAID_REPO_SKILL_ID,
      "?installed_version=2&source=repo&listing=ListingAddr1"
    );
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: PAID_REPO_SKILL_ID,
      skill_slug: "calendar-agent",
      status: "update_available",
      installed_version: 2,
      latest_version: 3,
      on_chain_address: "ListingAddr2",
      price_lamports: 0,
      price_usdc_micros: "1000000",
      payment_flow: "direct-purchase-skill",
      requires_purchase: true,
      listing_changed: true,
    });
  });

  it("returns listing-required for paid repo skills without an on-chain listing", async () => {
    const dbQuery = vi.fn().mockResolvedValueOnce([
      {
        id: UNLINKED_PAID_REPO_SKILL_ID,
        skill_id: "calendar-agent",
        current_version: 3,
        updated_at: "2026-04-13T12:00:00.000Z",
        on_chain_address: null,
        price_usdc_micros: "1000000",
      },
    ]);
    mockSql.mockReturnValue(dbQuery);

    const { req, params } = makeRequest(
      UNLINKED_PAID_REPO_SKILL_ID,
      "?installed_version=2&source=repo"
    );
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: UNLINKED_PAID_REPO_SKILL_ID,
      price_usdc_micros: "1000000",
      payment_flow: "listing-required",
      requires_purchase: true,
    });
  });

  it("returns unknown_installed_version when the caller has no local metadata yet", async () => {
    const dbQuery = vi.fn().mockResolvedValueOnce([
      {
        id: FREE_REPO_SKILL_ID,
        skill_id: "calendar-agent",
        current_version: 4,
        updated_at: "2026-04-13T12:00:00.000Z",
        on_chain_address: null,
      },
    ]);
    mockSql.mockReturnValue(dbQuery);

    const { req, params } = makeRequest(FREE_REPO_SKILL_ID);
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: FREE_REPO_SKILL_ID,
      skill_slug: "calendar-agent",
      status: "unknown_installed_version",
      installed_version: null,
      latest_version: 4,
      price_lamports: 0,
      price_usdc_micros: null,
      payment_flow: "free",
      requires_purchase: false,
      listing_changed: false,
    });
  });
});
