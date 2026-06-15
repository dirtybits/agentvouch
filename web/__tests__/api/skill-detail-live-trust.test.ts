import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@solana/kit", () => ({
  address: vi.fn((value: string) => value),
  createSolanaRpc: vi.fn(() => ({})),
  isAddress: vi.fn(() => true),
}));

vi.mock("@/lib/db", () => ({
  initializeDatabase: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@/lib/trust", () => ({
  resolveAuthorTrust: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  verifyWalletSignature: vi.fn(),
}));

vi.mock("@/lib/agentIdentity", () => ({
  buildLocalCanonicalAgentId: vi.fn((wallet: string) => `local:${wallet}`),
  resolveAgentIdentityByWallet: vi.fn(),
}));

vi.mock("@/lib/x402", () => ({
  getConfiguredUsdcMint: vi.fn(() => "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
  hasOnChainPurchase: vi.fn(),
}));

vi.mock("@/lib/usdcPurchases", () => ({
  getUsdcPurchaseEntitlementSummary: vi.fn(),
  hasUsdcPurchaseEntitlement: vi.fn(),
}));

vi.mock("@/lib/onchain", () => ({
  fetchOnChainSkillListing: vi.fn(),
  getOnChainUsdcPrice: vi.fn(),
}));

vi.mock("@/lib/purchasePreflight", () => ({
  assessPurchasePreflight: vi.fn(() => ({})),
  createPurchasePreflightContext: vi.fn(),
  serializePurchasePreflight: vi.fn(() => ({})),
}));

vi.mock("@/lib/solanaRpc", () => ({
  DEFAULT_SOLANA_RPC_URL: "http://localhost:8899",
}));

vi.mock("@/lib/protocolMetadata", () => ({
  AGENTVOUCH_PROTOCOL_VERSION: "0.2.0",
  getAgentVouchProgramId: vi.fn(() => "Program1111111111111111111111111111111111"),
}));

vi.mock("@/lib/skillRouteResolver", () => ({
  resolveSkillRouteParam: vi.fn(),
}));

vi.mock("@/lib/skillDetailSnapshot", () => ({
  loadSkillDetailSnapshot: vi.fn(),
}));

vi.mock("@/lib/trustSnapshots", () => ({
  upsertResolvedAuthorTrustSnapshot: vi.fn(),
}));

import { GET } from "@/app/api/skills/[id]/route";
import { resolveAgentIdentityByWallet } from "@/lib/agentIdentity";
import { initializeDatabase } from "@/lib/db";
import { createPurchasePreflightContext } from "@/lib/purchasePreflight";
import { resolveSkillRouteParam } from "@/lib/skillRouteResolver";
import { loadSkillDetailSnapshot } from "@/lib/skillDetailSnapshot";
import { resolveAuthorTrust } from "@/lib/trust";
import { upsertResolvedAuthorTrustSnapshot } from "@/lib/trustSnapshots";

const mockInitializeDatabase = initializeDatabase as unknown as ReturnType<
  typeof vi.fn
>;
const mockResolveSkillRouteParam =
  resolveSkillRouteParam as unknown as ReturnType<typeof vi.fn>;
const mockLoadSkillDetailSnapshot =
  loadSkillDetailSnapshot as unknown as ReturnType<typeof vi.fn>;
const mockResolveAuthorTrust = resolveAuthorTrust as unknown as ReturnType<
  typeof vi.fn
>;
const mockResolveAgentIdentityByWallet =
  resolveAgentIdentityByWallet as unknown as ReturnType<typeof vi.fn>;
const mockUpsertResolvedAuthorTrustSnapshot =
  upsertResolvedAuthorTrustSnapshot as unknown as ReturnType<typeof vi.fn>;
const mockCreatePurchasePreflightContext =
  createPurchasePreflightContext as unknown as ReturnType<typeof vi.fn>;

function request(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

describe("GET /api/skills/[id] live trust", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitializeDatabase.mockResolvedValue(undefined);
    mockResolveSkillRouteParam.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
    });
    mockCreatePurchasePreflightContext.mockResolvedValue({});
    mockResolveAgentIdentityByWallet.mockResolvedValue(null);
    mockUpsertResolvedAuthorTrustSnapshot.mockResolvedValue(undefined);
    mockLoadSkillDetailSnapshot.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      skill_id: "subagent-orchestration",
      author_pubkey: "asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw",
      name: "Sub-agent Orchestration",
      description: null,
      tags: [],
      current_version: 1,
      ipfs_cid: null,
      on_chain_address: null,
      chain_context: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      total_installs: 0,
      price_usdc_micros: null,
      currency_mint: null,
      contact: null,
      created_at: "2026-06-15T00:00:00.000Z",
      updated_at: "2026-06-15T00:00:00.000Z",
      source: "repo",
      payment_flow: "free",
      content: "# Skill",
      files: null,
      tree_hash: "treehash",
      storage_backend: "blob",
      has_executable: false,
      security_scan: {
        verdict: "review",
        risk: "low",
        findings: [],
        truncated: false,
        scanned_at: "2026-06-15T00:00:00.000Z",
        model: "google/gemini-2.5-flash-lite",
        rubric_version: "v1",
        scan_source: "model",
        generated_by_model: true,
        advisory: true,
      },
      signals: [],
      versions: [],
      author_trust: {
        reputationScore: 72,
        totalVouchesReceived: 0,
        totalStakedFor: 0,
        authorBondUsdcMicros: 7250000,
        totalStakeAtRisk: 7250000,
        disputesAgainstAuthor: 0,
        disputesUpheldAgainstAuthor: 0,
        activeDisputesAgainstAuthor: 0,
        registeredAt: 1,
        isRegistered: true,
      },
      author_trust_summary: null,
      author_identity: null,
      buyerHasPurchased: false,
      buyerPurchaseSummary: null,
      content_verification: {
        has_ipfs: false,
        all_versions_pinned: false,
        current_cid_consistent: true,
        status: "unverified",
      },
    });
    mockResolveAuthorTrust.mockResolvedValue({
      reputationScore: 160,
      totalVouchesReceived: 1,
      totalStakedFor: 5000000,
      authorBondUsdcMicros: 7250000,
      totalStakeAtRisk: 12250000,
      disputesAgainstAuthor: 0,
      disputesUpheldAgainstAuthor: 0,
      activeDisputesAgainstAuthor: 0,
      registeredAt: 1,
      isRegistered: true,
    });
  });

  it("returns fresh author trust, recomputed signals, and no-store caching", async () => {
    const res = await GET(request("/api/skills/slug?trust=live"), {
      params: Promise.resolve({ id: "slug" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "private, no-store, max-age=0"
    );
    expect(body.author_trust.totalVouchesReceived).toBe(1);
    expect(body.author_trust.totalStakedFor).toBe(5000000);
    expect(
      body.signals.find((signal: { id: string }) => signal.id === "vouched")
        ?.status
    ).toBe("pass");
    expect(mockUpsertResolvedAuthorTrustSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        walletPubkey: "asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw",
      })
    );
  });
});
