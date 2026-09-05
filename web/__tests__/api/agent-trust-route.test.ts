import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/trust", () => ({
  resolveAuthorTrust: vi.fn(),
}));

vi.mock("@/lib/agentIdentity", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agentIdentity")>(
    "@/lib/agentIdentity"
  );

  return {
    ...actual,
    resolveAgentIdentityByWallet: vi.fn(),
  };
});

vi.mock("@/lib/authorDisputes", () => ({
  listAuthorDisputesByAuthor: vi.fn(),
}));

import { GET } from "@/app/api/agents/[pubkey]/trust/route";
import { resolveAuthorTrust } from "@/lib/trust";
import { resolveAgentIdentityByWallet } from "@/lib/agentIdentity";
import { listAuthorDisputesByAuthor } from "@/lib/authorDisputes";

const mockResolveAuthorTrust = resolveAuthorTrust as unknown as ReturnType<
  typeof vi.fn
>;
const mockResolveIdentity =
  resolveAgentIdentityByWallet as unknown as ReturnType<typeof vi.fn>;
const mockListDisputes = listAuthorDisputesByAuthor as unknown as ReturnType<
  typeof vi.fn
>;
const SOLANA_PUBKEY = "AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg";

describe("GET /api/agents/[pubkey]/trust", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a normalized trust summary", async () => {
    mockResolveAuthorTrust.mockResolvedValue({
      reputationScore: 10,
      totalVouchesReceived: 2,
      totalStakedFor: 1000,
      authorBondUsdcMicros: 500,
      totalStakeAtRisk: 1500,
      disputesAgainstAuthor: 1,
      disputesUpheldAgainstAuthor: 0,
      activeDisputesAgainstAuthor: 0,
      registeredAt: 123,
      isRegistered: true,
    });
    mockResolveIdentity.mockResolvedValue({
      canonicalAgentId: "agent-1",
      homeChainContext: "solana:test",
    });
    mockListDisputes.mockResolvedValue([{ publicKey: "Dispute111" }]);

    const request = new NextRequest(
      `http://localhost/api/agents/${SOLANA_PUBKEY}/trust`
    );
    const response = await GET(request, {
      params: Promise.resolve({ pubkey: SOLANA_PUBKEY }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pubkey).toBe(SOLANA_PUBKEY);
    expect(body.trust.canonical_agent_id).toBe("agent-1");
    expect(body.trust.recommended_action).toBe("allow");
    expect(body.trust.isRegistered).toBe(true);
    expect(body.trust.totalStakedFor).toBe(1000);
    expect(body.trust.authorBondUsdcMicros).toBeUndefined();
    expect(body.author_trust.authorBondUsdcMicros).toBe(500);
    expect(body.author_trust.totalStakeAtRisk).toBe(1500);
    expect(body.author_disputes).toEqual([{ publicKey: "Dispute111" }]);
  });

  it("returns avoid for an unregistered author", async () => {
    mockResolveAuthorTrust.mockResolvedValue({
      reputationScore: 0,
      totalVouchesReceived: 0,
      totalStakedFor: 0,
      authorBondUsdcMicros: 0,
      totalStakeAtRisk: 0,
      disputesAgainstAuthor: 0,
      disputesUpheldAgainstAuthor: 0,
      activeDisputesAgainstAuthor: 0,
      registeredAt: 0,
      isRegistered: false,
    });
    mockResolveIdentity.mockResolvedValue(null);
    mockListDisputes.mockResolvedValue([]);

    const request = new NextRequest(
      `http://localhost/api/agents/${SOLANA_PUBKEY}/trust`
    );
    const response = await GET(request, {
      params: Promise.resolve({ pubkey: SOLANA_PUBKEY }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.trust.recommended_action).toBe("avoid");
    expect(body.trust.isRegistered).toBe(false);
  });

  it("rejects malformed public keys before trust, identity, or dispute lookups", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/agents/not-a-solana-address/trust"),
      { params: Promise.resolve({ pubkey: "not-a-solana-address" }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Agent routes require a valid Solana address",
    });
    expect(mockResolveAuthorTrust).not.toHaveBeenCalled();
    expect(mockResolveIdentity).not.toHaveBeenCalled();
    expect(mockListDisputes).not.toHaveBeenCalled();
  });
});
