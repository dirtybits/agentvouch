import { describe, expect, it } from "vitest";
import {
  formatAgentTrust,
  formatAuthorSummary,
  formatRegisterAgentResult,
  formatSkillSummary,
} from "../src/lib/format.js";
import type {
  AgentTrustResponse,
  AuthorRecord,
  SkillRecord,
} from "../src/lib/http.js";

function buildSkill(overrides: Partial<SkillRecord> = {}): SkillRecord {
  return {
    id: "595f5534-07ae-4839-a45a-b6858ab731fe",
    skill_id: "calendar-agent",
    author_pubkey: "asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw",
    name: "Calendar Agent",
    description: "Books meetings",
    on_chain_address: "Eq35iaSKECtZAGMkPVSk18tqFDFe6L3hgEhJsUzkByFd",
    price_usdc_micros: "1000000",
    currency_mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    total_installs: 4,
    source: "repo",
    ...overrides,
  };
}

function buildAuthor(overrides: Partial<AuthorRecord> = {}): AuthorRecord {
  return {
    pubkey: "asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw",
    canonical_agent_id:
      "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw",
    chain_context: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    recommended_action: "allow",
    skill_count: 2,
    author_trust_summary: {
      wallet_pubkey: "asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw",
      canonical_agent_id:
        "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw",
      chain_context: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      schema_version: "2026-04-03",
      trust_updated_at: "2026-04-09T00:00:00.000Z",
      recommended_action: "allow",
      reputationScore: 123,
      totalVouchesReceived: 2,
      totalStakedFor: 1000,
      disputesAgainstAuthor: 1,
      disputesUpheldAgainstAuthor: 0,
      activeDisputesAgainstAuthor: 0,
      registeredAt: 123,
      isRegistered: true,
    },
    ...overrides,
  };
}

function buildAgentTrust(
  overrides: Partial<AgentTrustResponse> = {}
): AgentTrustResponse {
  return {
    pubkey: "asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw",
    trust: {
      wallet_pubkey: "asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw",
      canonical_agent_id:
        "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw",
      chain_context: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      schema_version: "2026-04-03",
      trust_updated_at: "2026-04-09T00:00:00.000Z",
      recommended_action: "allow",
      reputationScore: 321,
      totalVouchesReceived: 4,
      totalStakedFor: 1000000,
      disputesAgainstAuthor: 2,
      disputesUpheldAgainstAuthor: 1,
      activeDisputesAgainstAuthor: 1,
      registeredAt: 123,
      isRegistered: true,
    },
    author_trust: {
      authorBondLamports: 500000,
      totalStakeAtRisk: 1500000,
    },
    author_identity: {
      displayName: "Calendar Agent",
    },
    author_disputes: [{ id: "d1" }, { id: "d2" }],
    ...overrides,
  };
}

describe("formatSkillSummary", () => {
  it("prefers the normalized trust summary when present", () => {
    const lines = formatSkillSummary(
      buildSkill({
        author_trust: {
          isRegistered: true,
          activeDisputesAgainstAuthor: 9,
          disputesUpheldAgainstAuthor: 9,
        },
        author_trust_summary: {
          wallet_pubkey: "asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw",
          canonical_agent_id: "solana:devnet/asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw",
          chain_context: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
          schema_version: "2026-04-03",
          trust_updated_at: "2026-04-09T00:00:00.000Z",
          recommended_action: "review",
          reputationScore: 10,
          totalVouchesReceived: 2,
          totalStakedFor: 1000,
          disputesAgainstAuthor: 1,
          disputesUpheldAgainstAuthor: 1,
          activeDisputesAgainstAuthor: 2,
          registeredAt: 123,
          isRegistered: true,
        },
      })
    );

    expect(lines).toContain("author_reputation: 10");
    expect(lines).toContain("registered: yes");
    expect(lines).toContain("recommended_action: review");
    expect(lines).toContain("active_author_disputes: 2");
    expect(lines).toContain("upheld_author_disputes: 1");
  });

  it("falls back to raw author trust when the normalized summary is absent", () => {
    const lines = formatSkillSummary(
      buildSkill({
        author_trust: {
          isRegistered: false,
          activeDisputesAgainstAuthor: 3,
          disputesUpheldAgainstAuthor: 4,
        },
        author_trust_summary: null,
      })
    );

    expect(lines).toContain("author_reputation: 0");
    expect(lines).toContain("registered: no");
    expect(lines).not.toContain("recommended_action: review");
    expect(lines).toContain("active_author_disputes: 3");
    expect(lines).toContain("upheld_author_disputes: 4");
  });

  it("falls back to raw trust reputation when the normalized summary is absent", () => {
    const lines = formatSkillSummary(
      buildSkill({
        author_trust: {
          isRegistered: true,
          reputationScore: 42,
          activeDisputesAgainstAuthor: 0,
          disputesUpheldAgainstAuthor: 0,
        },
        author_trust_summary: null,
      })
    );

    expect(lines).toContain("author_reputation: 42");
  });
});

describe("formatAuthorSummary", () => {
  it("shows a quick author trust summary", () => {
    const lines = formatAuthorSummary(buildAuthor());

    expect(lines).toContain(
      "author: asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw"
    );
    expect(lines).toContain("author_reputation: 123");
    expect(lines).toContain("recommended_action: allow");
    expect(lines).toContain("skill_count: 2");
  });

  it("falls back cleanly when trust data is missing", () => {
    const lines = formatAuthorSummary(
      buildAuthor({
        canonical_agent_id: null,
        chain_context: null,
        recommended_action: null,
        author_trust_summary: null,
        skill_count: 0,
      })
    );

    expect(lines).toContain("author_reputation: 0");
    expect(lines).toContain("recommended_action: unknown");
    expect(lines).toContain("skill_count: 0");
  });
});

describe("formatAgentTrust", () => {
  it("shows a compact agent trust summary", () => {
    const lines = formatAgentTrust(buildAgentTrust());

    expect(lines).toContain("Calendar Agent");
    expect(lines).toContain(
      "agent: asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw"
    );
    expect(lines).toContain("agent_reputation: 321");
    expect(lines).toContain("recommended_action: allow");
    expect(lines).toContain("registered: yes");
    expect(lines).toContain("author_bond_usdc_micros: 500000");
    expect(lines).toContain("total_stake_at_risk: 1500000");
    expect(lines).toContain("author_dispute_count: 2");
  });

  it("falls back cleanly when author_trust and identity are missing", () => {
    const lines = formatAgentTrust(
      buildAgentTrust({
        author_trust: null,
        author_identity: null,
        author_disputes: undefined,
      })
    );

    expect(lines[0]).not.toBe("Calendar Agent");
    expect(lines).toContain("author_bond_usdc_micros: 0");
    expect(lines).toContain("total_stake_at_risk: 0");
    expect(lines).toContain("author_dispute_count: 0");
  });
});

describe("formatRegisterAgentResult", () => {
  it("emits agent: label (not author:)", () => {
    const lines = formatRegisterAgentResult({
      agentProfile: "PDA111",
      alreadyRegistered: false,
      tx: "tx111",
    });

    expect(lines).toContain("agent: PDA111");
    expect(lines).not.toContain("author: PDA111");
    expect(lines).toContain("already_registered: no");
    expect(lines).toContain("tx: tx111");
  });

  it("omits tx when none is returned", () => {
    const lines = formatRegisterAgentResult({
      agentProfile: "PDA111",
      alreadyRegistered: true,
    });

    expect(lines).toContain("already_registered: yes");
    expect(lines.some((l) => l.startsWith("tx:"))).toBe(false);
  });

  it("omits tx when it is null", () => {
    const lines = formatRegisterAgentResult({
      agentProfile: "PDA111",
      alreadyRegistered: true,
      tx: null,
    });

    expect(lines.some((l) => l.startsWith("tx:"))).toBe(false);
  });
});
