import { afterEach, describe, expect, it, vi } from "vitest";
import { CliError } from "../src/lib/errors.js";
import { AgentVouchApiClient } from "../src/lib/http.js";

describe("AgentVouchApiClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists skills with API-aligned query params", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          skills: [
            {
              id: "595f5534-07ae-4839-a45a-b6858ab731fe",
              skill_id: "calendar-agent",
              author_pubkey: "asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw",
              name: "Calendar Agent",
              description: "Books meetings",
              tags: ["calendar", "ops"],
              on_chain_address: null,
              price_lamports: 0,
              total_installs: 4,
              source: "repo",
              author_trust: {
                isRegistered: true,
                disputesAgainstAuthor: 1,
                disputesUpheldAgainstAuthor: 0,
                activeDisputesAgainstAuthor: 0,
                totalStakedFor: 1000000,
                authorBondUsdcMicros: 500000,
                totalStakeAtRisk: 1500000,
              },
              author_trust_summary: {
                wallet_pubkey: "asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw",
                canonical_agent_id:
                  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw",
                chain_context: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
                schema_version: "2026-04-03",
                trust_updated_at: "2026-04-09T00:00:00.000Z",
                recommended_action: "allow",
                reputationScore: 10,
                totalVouchesReceived: 2,
                totalStakedFor: 1000000,
                disputesAgainstAuthor: 1,
                disputesUpheldAgainstAuthor: 0,
                activeDisputesAgainstAuthor: 0,
                registeredAt: 123,
                isRegistered: true,
              },
            },
          ],
          pagination: {
            page: 2,
            pageSize: 20,
            total: 25,
            totalPages: 2,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
    const client = new AgentVouchApiClient("https://agentvouch.xyz");

    const result = await client.listSkills({
      q: "calendar",
      sort: "trusted",
      author: "asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw",
      tags: "calendar,ops",
      page: 2,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://agentvouch.xyz/api/skills?q=calendar&sort=trusted&author=asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw&tags=calendar%2Cops&page=2"
    );
    expect(result.pagination.totalPages).toBe(2);
    expect(result.skills[0]?.skill_id).toBe("calendar-agent");
    expect(result.skills[0]?.author_trust?.authorBondUsdcMicros).toBe(500000);
    expect(result.skills[0]?.author_trust_summary?.recommended_action).toBe(
      "allow"
    );
  });

  it("surfaces list errors as CliError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "upstream failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    );
    const client = new AgentVouchApiClient("https://agentvouch.xyz");

    try {
      await client.listSkills();
      throw new Error("Expected listSkills to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect(error).toHaveProperty(
        "message",
        "Failed to list skills: upstream failed"
      );
    }
  });

  it("lists authors from the discovery index", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          schema_version: "2026-04-03",
          generated_at: "2026-04-09T00:00:00.000Z",
          total: 1,
          authors: [
            {
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
                totalStakedFor: 1000000,
                disputesAgainstAuthor: 1,
                disputesUpheldAgainstAuthor: 0,
                activeDisputesAgainstAuthor: 0,
                registeredAt: 123,
                isRegistered: true,
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
    const client = new AgentVouchApiClient("https://agentvouch.xyz");

    const result = await client.listAuthors();

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://agentvouch.xyz/api/index/authors"
    );
    expect(result.total).toBe(1);
    expect(result.authors[0]?.author_trust_summary?.reputationScore).toBe(123);
  });

  it("lists trusted authors from the trusted discovery index", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          schema_version: "2026-04-03",
          generated_at: "2026-04-09T00:00:00.000Z",
          total: 0,
          authors: [],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
    const client = new AgentVouchApiClient("https://agentvouch.xyz");

    const result = await client.listAuthors({ trusted: true });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://agentvouch.xyz/api/index/trusted-authors"
    );
    expect(result.total).toBe(0);
  });

  it("fetches agent trust from the direct trust endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          pubkey: "asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw",
          trust: {
            wallet_pubkey: "asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw",
            canonical_agent_id:
              "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw",
            chain_context: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
            schema_version: "2026-04-03",
            trust_updated_at: "2026-04-09T00:00:00.000Z",
            recommended_action: "allow",
            reputationScore: 123,
            totalVouchesReceived: 2,
            totalStakedFor: 1000000,
            disputesAgainstAuthor: 1,
            disputesUpheldAgainstAuthor: 0,
            activeDisputesAgainstAuthor: 0,
            registeredAt: 123,
            isRegistered: true,
          },
          author_trust: {
            authorBondUsdcMicros: 500000,
            totalStakeAtRisk: 1500000,
          },
          author_identity: {
            displayName: "Calendar Agent",
          },
          author_disputes: [{ id: "d1" }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
    const client = new AgentVouchApiClient("https://agentvouch.xyz");

    const result = await client.getAgentTrust(
      "asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw"
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://agentvouch.xyz/api/agents/asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw/trust"
    );
    expect(result.trust.reputationScore).toBe(123);
    expect(result.author_trust?.authorBondUsdcMicros).toBe(500000);
  });
});
