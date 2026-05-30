import { describe, expect, it } from "vitest";
import {
  buildAgentTrustSummary,
  getRecommendedAction,
} from "@/lib/agentDiscovery";

describe("agentDiscovery", () => {
  it("recommends avoid for unregistered authors", () => {
    expect(
      getRecommendedAction({
        isRegistered: false,
        activeDisputesAgainstAuthor: 0,
        disputesUpheldAgainstAuthor: 0,
        totalStakedFor: 0,
      })
    ).toBe("avoid");
  });

  it("recommends review when an author has active disputes", () => {
    expect(
      getRecommendedAction({
        isRegistered: true,
        activeDisputesAgainstAuthor: 1,
        disputesUpheldAgainstAuthor: 0,
        totalStakedFor: 10,
      })
    ).toBe("review");
  });

  it("builds a normalized trust summary", () => {
    const summary = buildAgentTrustSummary({
      walletPubkey: "Author111",
      trust: {
        reputationScore: 42,
        totalVouchesReceived: 2,
        totalStakedFor: 1000,
        authorBondUsdcMicros: 0,
        totalStakeAtRisk: 1000,
        disputesAgainstAuthor: 1,
        disputesUpheldAgainstAuthor: 0,
        activeDisputesAgainstAuthor: 0,
        registeredAt: 123,
        isRegistered: true,
      },
      identity: {
        id: "agent-1",
        canonicalAgentId: "solana:test:registry#1",
        identitySource: "local",
        homeChainContext: "solana:test",
        status: "active",
        displayName: "Agent One",
        bindings: [],
        ownerWallet: "Author111",
        operationalWallet: null,
        agentProfilePda: null,
        registryAsset: null,
      },
      trustUpdatedAt: "2026-04-03T00:00:00.000Z",
    });

    expect(summary.canonical_agent_id).toBe("solana:test:registry#1");
    expect(summary.chain_context).toBe("solana:test");
    expect(summary.recommended_action).toBe("allow");
    expect(summary.trust_updated_at).toBe("2026-04-03T00:00:00.000Z");
  });
});
