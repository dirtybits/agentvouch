import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SOLANA_DEVNET_CHAIN_CONTEXT } from "@/lib/chains";

const publicUrlFetch = vi.hoisted(() => ({ fetchPublicUrl: vi.fn() }));

vi.mock("@/lib/publicUrlFetch.server", () => publicUrlFetch);

import { discoverSolanaRegistryCandidatesByWallet } from "@/lib/solanaAgentRegistry";

const ORIGINAL_ENV = { ...process.env };

describe("solanaAgentRegistry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    publicUrlFetch.fetchPublicUrl.mockReset();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SOLANA_AGENT_REGISTRY_INDEXER_URL;
    delete process.env.SOLANA_AGENT_REGISTRY_INDEXER_FALLBACK_URL;
    delete process.env.SOLANA_AGENT_REGISTRY_PROGRAM_ID;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("dedupes owner and operational wallet matches into one candidate", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            byOwner: [
              {
                id: "Asset111",
                agentId: "42",
                owner: "Wallet111",
                agentWallet: "OpWallet111",
                agentURI: "https://example.com/agent.json",
                registrationFile: {
                  name: "Example Agent",
                  description: "Test agent",
                  image: "ipfs://image",
                },
                metadata: [],
                solana: {
                  assetPubkey: "Asset111",
                  verificationStatus: "FINALIZED",
                },
              },
            ],
            byWallet: [
              {
                id: "Asset111",
                agentId: "42",
                owner: "Wallet111",
                agentWallet: "OpWallet111",
                agentURI: "https://example.com/agent.json",
                registrationFile: {
                  name: "Example Agent",
                  description: "Test agent",
                  image: "ipfs://image",
                },
                metadata: [],
                solana: {
                  assetPubkey: "Asset111",
                  verificationStatus: "FINALIZED",
                },
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    publicUrlFetch.fetchPublicUrl.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          registrations: [{ agentRegistry: "registry", agentId: "42" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    const candidates = await discoverSolanaRegistryCandidatesByWallet(
      "Wallet111",
      {
        chainContext: SOLANA_DEVNET_CHAIN_CONTEXT,
        useCache: false,
      }
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      coreAssetPubkey: "Asset111",
      ownerWallet: "Wallet111",
      operationalWallet: "OpWallet111",
      displayName: "Example Agent",
      externalAgentId: "42",
      matchType: "both",
      rawUpstreamChainLabel: "solana-devnet",
    });
    expect(candidates[0].registrations).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(publicUrlFetch.fetchPublicUrl).toHaveBeenCalledWith(
      "https://example.com/agent.json"
    );
  });

  it("uses the protected transport for every registry metadata redirect", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            byOwner: [
              {
                id: "Asset111",
                agentId: "42",
                owner: "Wallet111",
                agentWallet: null,
                agentURI: "https://agents.example/metadata.json",
                metadata: [],
              },
            ],
            byWallet: [],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    publicUrlFetch.fetchPublicUrl
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/metadata-v2.json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ registrations: [{ agentId: "42" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await discoverSolanaRegistryCandidatesByWallet(
      "Wallet111",
      { chainContext: SOLANA_DEVNET_CHAIN_CONTEXT, useCache: false }
    );

    expect(candidates[0]?.registrations).toEqual([{ agentId: "42" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(publicUrlFetch.fetchPublicUrl).toHaveBeenNthCalledWith(
      1,
      "https://agents.example/metadata.json"
    );
    expect(publicUrlFetch.fetchPublicUrl).toHaveBeenNthCalledWith(
      2,
      "https://agents.example/metadata-v2.json"
    );
  });

  it("contains rejected registry metadata reads without a global-fetch fallback", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            byOwner: [
              {
                id: "Asset111",
                agentId: "42",
                owner: "Wallet111",
                agentWallet: null,
                agentURI: "http://127.0.0.1/metadata.json",
                metadata: [],
              },
            ],
            byWallet: [],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    publicUrlFetch.fetchPublicUrl.mockRejectedValueOnce(
      new Error("DNS returned a non-public address")
    );
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await discoverSolanaRegistryCandidatesByWallet(
      "Wallet111",
      { chainContext: SOLANA_DEVNET_CHAIN_CONTEXT, useCache: false }
    );

    expect(candidates[0]?.registrations).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(publicUrlFetch.fetchPublicUrl).toHaveBeenCalledWith(
      "http://127.0.0.1/metadata.json"
    );
  });

  it("returns an empty list when the indexer finds no candidates", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { byOwner: [], byWallet: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await discoverSolanaRegistryCandidatesByWallet(
      "Wallet111",
      {
        chainContext: SOLANA_DEVNET_CHAIN_CONTEXT,
        useCache: false,
      }
    );

    expect(candidates).toEqual([]);
  });

  it("returns an empty list for unsupported chain contexts", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await discoverSolanaRegistryCandidatesByWallet(
      "Wallet111",
      {
        chainContext: "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z",
        useCache: false,
      }
    );

    expect(candidates).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
