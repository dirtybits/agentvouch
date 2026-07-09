import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  verifyWalletSignature: vi.fn(),
}));

vi.mock("@/lib/trust", () => ({
  resolveAuthorTrust: vi.fn(),
  verifyAuthorTrust: vi.fn(),
}));

vi.mock("@/lib/solanaAgentRegistry", () => ({
  discoverSolanaRegistryCandidatesByWallet: vi.fn(),
}));

vi.mock("@/lib/authorDisputes", () => ({
  listAuthorDisputesByAuthor: vi.fn(),
}));

vi.mock("@/lib/agentIdentity", () => ({
  linkSolanaRegistryIdentity: vi.fn(),
  resolveAgentIdentityByWallet: vi.fn(),
}));

import { GET, POST } from "@/app/api/author/[pubkey]/route";
import { verifyWalletSignature } from "@/lib/auth";
import { resolveAuthorTrust, verifyAuthorTrust } from "@/lib/trust";
import { discoverSolanaRegistryCandidatesByWallet } from "@/lib/solanaAgentRegistry";
import { listAuthorDisputesByAuthor } from "@/lib/authorDisputes";
import {
  linkSolanaRegistryIdentity,
  resolveAgentIdentityByWallet,
} from "@/lib/agentIdentity";

const mockVerify = verifyWalletSignature as unknown as ReturnType<typeof vi.fn>;
const mockVerifyAuthorTrust = verifyAuthorTrust as unknown as ReturnType<
  typeof vi.fn
>;
const mockResolveAuthorTrust = resolveAuthorTrust as unknown as ReturnType<
  typeof vi.fn
>;
const mockDiscover =
  discoverSolanaRegistryCandidatesByWallet as unknown as ReturnType<
    typeof vi.fn
  >;
const mockListAuthorDisputes =
  listAuthorDisputesByAuthor as unknown as ReturnType<typeof vi.fn>;
const mockLink = linkSolanaRegistryIdentity as unknown as ReturnType<
  typeof vi.fn
>;
const mockResolveIdentity =
  resolveAgentIdentityByWallet as unknown as ReturnType<typeof vi.fn>;

function makeRequest(pubkey: string, body: Record<string, unknown> = {}) {
  const req = new NextRequest(`http://localhost/api/author/${pubkey}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  const params = Promise.resolve({ pubkey });
  return { req, params };
}

describe("POST /api/author/[pubkey]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns trust, identity, and author disputes on GET", async () => {
    mockResolveAuthorTrust.mockResolvedValue({
      reputationScore: 10,
      totalVouchesReceived: 2,
      totalStakedFor: 1000,
      disputesAgainstAuthor: 3,
      disputesUpheldAgainstAuthor: 1,
      activeDisputesAgainstAuthor: 1,
      registeredAt: 123,
      isRegistered: true,
    });
    mockResolveIdentity.mockResolvedValue({ canonicalAgentId: "agent-1" });
    mockListAuthorDisputes.mockResolvedValue([{ publicKey: "Dispute111" }]);

    const req = new NextRequest("http://localhost/api/author/Author111");
    const res = await GET(req, {
      params: Promise.resolve({ pubkey: "Author111" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=60");
    expect(body.author_trust.disputesAgainstAuthor).toBe(3);
    expect(body.author_identity.canonicalAgentId).toBe("agent-1");
    expect(body.author_trust_summary.canonical_agent_id).toBe("agent-1");
    expect(body.author_disputes).toEqual([{ publicKey: "Dispute111" }]);
  });

  it("returns 400 when the selected discovered candidate does not belong to the wallet", async () => {
    mockVerify.mockReturnValue({ valid: true, pubkey: "Author111" });
    mockVerifyAuthorTrust.mockResolvedValue({ isRegistered: true });
    mockDiscover.mockResolvedValue([]);

    const { req, params } = makeRequest("Author111", {
      auth: { pubkey: "Author111" },
      selected_registry_asset_pubkey: "Asset111",
    });

    const res = await POST(req, { params });
    expect(res.status).toBe(400);
  });

  it("persists a selected discovered candidate through linkSolanaRegistryIdentity", async () => {
    mockVerify.mockReturnValue({ valid: true, pubkey: "Author111" });
    mockVerifyAuthorTrust.mockResolvedValue({ isRegistered: true });
    mockDiscover.mockResolvedValue([
      {
        chainContext: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
        registryAddress: "8oo4J9tBB3Hna1jRQ3rWvJjojqM5DYTDJo5cejUuJy3C",
        coreAssetPubkey: "Asset111",
        ownerWallet: "Author111",
        operationalWallet: "OpWallet111",
        displayName: "Example Agent",
        rawUpstreamChainLabel: "solana-devnet",
        rawUpstreamChainId: null,
        externalAgentId: "42",
      },
    ]);
    mockLink.mockResolvedValue({ canonicalAgentId: "canonical-id" });

    const { req, params } = makeRequest("Author111", {
      auth: { pubkey: "Author111" },
      selected_registry_asset_pubkey: "Asset111",
    });

    const res = await POST(req, { params });
    expect(res.status).toBe(201);
    expect(mockLink).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerWalletPubkey: "Author111",
        registryAddress: "8oo4J9tBB3Hna1jRQ3rWvJjojqM5DYTDJo5cejUuJy3C",
        coreAssetPubkey: "Asset111",
        operationalWalletPubkey: "OpWallet111",
        displayName: "Example Agent",
      })
    );
  });
});
