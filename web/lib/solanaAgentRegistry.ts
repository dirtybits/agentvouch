import {
  SOLANA_DEVNET_CHAIN_CONTEXT,
  SOLANA_MAINNET_CHAIN_CONTEXT,
  getConfiguredSolanaChainContext,
  normalizePersistedChainContext,
} from "@/lib/chains";
import { fetchPublicUrl } from "@/lib/publicUrlFetch.server";

export interface SolanaRegistryCandidate {
  chainContext: string;
  registryAddress: string;
  coreAssetPubkey: string;
  ownerWallet: string;
  operationalWallet: string | null;
  displayName: string | null;
  description: string | null;
  image: string | null;
  metadataUri: string | null;
  registrations: unknown[];
  rawUpstreamChainLabel: string | null;
  rawUpstreamChainId: string | null;
  externalAgentId: string | null;
  matchType: "owner" | "operational" | "both";
}

type GraphqlAgent = {
  id: string;
  agentId: string | null;
  owner: string;
  agentWallet: string | null;
  agentURI: string | null;
  registrationFile?: {
    name?: string | null;
    description?: string | null;
    image?: string | null;
    active?: boolean | null;
    mcpEndpoint?: string | null;
    a2aEndpoint?: string | null;
  } | null;
  metadata?: Array<{ key: string; value: unknown }>;
  solana?: {
    assetPubkey?: string | null;
    verificationStatus?: string | null;
  } | null;
};

type DiscoveryConfig = {
  chainContext: string;
  endpoints: string[];
  registryAddress: string;
  rawUpstreamChainLabel: string | null;
};

const DEVNET_AGENT_REGISTRY_PROGRAM_ID =
  "8oo4J9tBB3Hna1jRQ3rWvJjojqM5DYTDJo5cejUuJy3C";
const MAINNET_AGENT_REGISTRY_PROGRAM_ID =
  "8oo4dC4JvBLwy5tGgiH3WwK4B9PWxL9Z4XjA2jzkQMbQ";
const CACHE_TTL_MS = 60_000;
const DEFAULT_FIRST = 25;

const queryCache = new Map<
  string,
  { expiresAt: number; value: SolanaRegistryCandidate[] }
>();

const DISCOVERY_QUERY = `
  query DiscoverAgentsByWallet($wallet: String!, $first: Int!) {
    byOwner: agents(first: $first, where: { owner: $wallet }, orderBy: updatedAt, orderDirection: desc) {
      id
      agentId
      owner
      agentWallet
      agentURI
      registrationFile {
        name
        description
        image
        active
        mcpEndpoint
        a2aEndpoint
      }
      metadata {
        key
        value
      }
      solana {
        assetPubkey
        verificationStatus
      }
    }
    byWallet: agents(first: $first, where: { agentWallet: $wallet }, orderBy: updatedAt, orderDirection: desc) {
      id
      agentId
      owner
      agentWallet
      agentURI
      registrationFile {
        name
        description
        image
        active
        mcpEndpoint
        a2aEndpoint
      }
      metadata {
        key
        value
      }
      solana {
        assetPubkey
        verificationStatus
      }
    }
  }
`;

function getDiscoveryConfig(
  chainContext?: string | null
): DiscoveryConfig | null {
  const normalizedChainContext = normalizePersistedChainContext(
    chainContext ?? getConfiguredSolanaChainContext()
  );
  const overrideEndpoint =
    process.env.SOLANA_AGENT_REGISTRY_INDEXER_URL?.trim() || null;
  const overrideFallback =
    process.env.SOLANA_AGENT_REGISTRY_INDEXER_FALLBACK_URL?.trim() || null;
  const overrideProgramId =
    process.env.SOLANA_AGENT_REGISTRY_PROGRAM_ID?.trim() || null;

  if (normalizedChainContext === SOLANA_MAINNET_CHAIN_CONTEXT) {
    return {
      chainContext: normalizedChainContext,
      endpoints: [
        overrideEndpoint || "https://8004-indexer-main.qnt.sh/v2/graphql",
        overrideFallback || "https://8004-indexer-main2.qnt.sh/v2/graphql",
      ].filter(Boolean),
      registryAddress: overrideProgramId || MAINNET_AGENT_REGISTRY_PROGRAM_ID,
      rawUpstreamChainLabel: "solana-mainnet",
    };
  }

  if (normalizedChainContext === SOLANA_DEVNET_CHAIN_CONTEXT) {
    return {
      chainContext: normalizedChainContext,
      endpoints: [
        overrideEndpoint || "https://8004-indexer-dev.qnt.sh/v2/graphql",
        overrideFallback || "https://8004-indexer-dev2.qnt.sh/v2/graphql",
      ].filter(Boolean),
      registryAddress: overrideProgramId || DEVNET_AGENT_REGISTRY_PROGRAM_ID,
      rawUpstreamChainLabel: "solana-devnet",
    };
  }

  return null;
}

async function fetchGraphql<T>(
  endpoints: string[],
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  let lastError: Error | null = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });

      if (!response.ok) {
        throw new Error(`Registry indexer request failed: ${response.status}`);
      }

      const payload = await response.json();
      if (payload.errors?.length) {
        throw new Error(
          payload.errors[0]?.message || "Registry indexer query failed"
        );
      }

      return payload.data as T;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError || new Error("Registry indexer request failed");
}

function toHttpUrl(uri: string): string | null {
  if (!uri) return null;
  if (/^https?:\/\//i.test(uri)) return uri;
  if (uri.startsWith("ipfs://")) {
    const cidPath = uri.slice("ipfs://".length).replace(/^ipfs\//, "");
    return `https://ipfs.io/ipfs/${cidPath}`;
  }
  return null;
}

async function readRegistrations(
  agentUri: string | null | undefined
): Promise<unknown[]> {
  let target = agentUri ? toHttpUrl(agentUri) : null;
  if (!target) {
    return [];
  }

  try {
    for (let redirects = 0; ; redirects += 1) {
      if (redirects > 5) {
        return [];
      }
      const response = await fetchPublicUrl(target);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) {
          return [];
        }
        target = new URL(location, target).href;
        continue;
      }
      if (!response.ok) {
        return [];
      }

      const payload = await response.json();
      return Array.isArray(payload?.registrations) ? payload.registrations : [];
    }
  } catch {
    return [];
  }
}

function readMetadataValue(
  metadata: GraphqlAgent["metadata"],
  key: string
): string | null {
  const entry = metadata?.find((item) => item.key === key);
  return typeof entry?.value === "string" ? entry.value : null;
}

async function normalizeCandidate(
  agent: GraphqlAgent,
  config: DiscoveryConfig,
  matchType: "owner" | "operational" | "both"
): Promise<SolanaRegistryCandidate | null> {
  const coreAssetPubkey = agent.solana?.assetPubkey || agent.id;
  if (!coreAssetPubkey || !agent.owner) {
    return null;
  }

  const metadataUri = agent.agentURI || null;
  const registrations = await readRegistrations(metadataUri);
  const operationalWallet =
    agent.agentWallet && agent.agentWallet !== agent.owner
      ? agent.agentWallet
      : null;

  return {
    chainContext: config.chainContext,
    registryAddress: config.registryAddress,
    coreAssetPubkey,
    ownerWallet: agent.owner,
    operationalWallet,
    displayName:
      agent.registrationFile?.name ||
      readMetadataValue(agent.metadata, "name") ||
      readMetadataValue(agent.metadata, "displayName") ||
      null,
    description:
      agent.registrationFile?.description ||
      readMetadataValue(agent.metadata, "description") ||
      null,
    image:
      agent.registrationFile?.image ||
      readMetadataValue(agent.metadata, "image") ||
      null,
    metadataUri,
    registrations,
    rawUpstreamChainLabel: config.rawUpstreamChainLabel,
    rawUpstreamChainId: null,
    externalAgentId: agent.agentId,
    matchType,
  };
}

export async function discoverSolanaRegistryCandidatesByWallet(
  walletPubkey: string,
  options?: { chainContext?: string | null; first?: number; useCache?: boolean }
): Promise<SolanaRegistryCandidate[]> {
  const config = getDiscoveryConfig(options?.chainContext ?? null);
  if (!config) {
    return [];
  }

  const cacheKey = `${config.chainContext}:${walletPubkey}`;
  const now = Date.now();
  const cached = queryCache.get(cacheKey);
  if (options?.useCache !== false && cached && cached.expiresAt > now) {
    return cached.value;
  }

  const data = await fetchGraphql<{
    byOwner?: GraphqlAgent[];
    byWallet?: GraphqlAgent[];
  }>(config.endpoints, DISCOVERY_QUERY, {
    wallet: walletPubkey,
    first: options?.first ?? DEFAULT_FIRST,
  });

  const byAsset = new Map<
    string,
    { agent: GraphqlAgent; ownerMatch: boolean; walletMatch: boolean }
  >();

  for (const agent of data.byOwner ?? []) {
    const asset = agent.solana?.assetPubkey || agent.id;
    if (!asset) continue;
    const current = byAsset.get(asset);
    byAsset.set(asset, {
      agent,
      ownerMatch: true,
      walletMatch: current?.walletMatch ?? false,
    });
  }

  for (const agent of data.byWallet ?? []) {
    const asset = agent.solana?.assetPubkey || agent.id;
    if (!asset) continue;
    const current = byAsset.get(asset);
    byAsset.set(asset, {
      agent,
      ownerMatch: current?.ownerMatch ?? false,
      walletMatch: true,
    });
  }

  const candidates = (
    await Promise.all(
      [...byAsset.values()].map(async ({ agent, ownerMatch, walletMatch }) =>
        normalizeCandidate(
          agent,
          config,
          ownerMatch && walletMatch
            ? "both"
            : ownerMatch
            ? "owner"
            : "operational"
        )
      )
    )
  )
    .filter((candidate): candidate is SolanaRegistryCandidate =>
      Boolean(candidate)
    )
    .sort((a, b) => {
      const aMatchScore = a.matchType === "both" ? 2 : 1;
      const bMatchScore = b.matchType === "both" ? 2 : 1;
      if (bMatchScore !== aMatchScore) return bMatchScore - aMatchScore;
      return (a.displayName || a.coreAssetPubkey).localeCompare(
        b.displayName || b.coreAssetPubkey
      );
    });

  queryCache.set(cacheKey, {
    expiresAt: now + CACHE_TTL_MS,
    value: candidates,
  });

  return candidates;
}
