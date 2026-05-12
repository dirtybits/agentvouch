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
import { sql } from "@/lib/db";
import { getOnChainUsdcPrice } from "@/lib/onchain";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockOnChain = getOnChainUsdcPrice as unknown as ReturnType<typeof vi.fn>;

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
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid installed_version", async () => {
    const { req, params } = makeRequest("uuid-1", "?installed_version=0");
    const res = await GET(req, { params });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("installed_version");
  });

  it("returns 404 when the repo skill does not exist", async () => {
    const dbQuery = vi.fn().mockResolvedValueOnce([]);
    mockSql.mockReturnValue(dbQuery);

    const { req, params } = makeRequest("uuid-missing", "?installed_version=1");
    const res = await GET(req, { params });

    expect(res.status).toBe(404);
  });

  it("returns update_available with paid listing state", async () => {
    const dbQuery = vi.fn().mockResolvedValueOnce([
      {
        id: "uuid-paid",
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
      "uuid-paid",
      "?installed_version=2&source=repo&listing=ListingAddr1"
    );
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: "uuid-paid",
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

  it("returns unknown_installed_version when the caller has no local metadata yet", async () => {
    const dbQuery = vi.fn().mockResolvedValueOnce([
      {
        id: "uuid-free",
        skill_id: "calendar-agent",
        current_version: 4,
        updated_at: "2026-04-13T12:00:00.000Z",
        on_chain_address: null,
      },
    ]);
    mockSql.mockReturnValue(dbQuery);

    const { req, params } = makeRequest("uuid-free");
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: "uuid-free",
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
