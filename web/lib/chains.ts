export const SOLANA_MAINNET_CHAIN_CONTEXT =
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const SOLANA_DEVNET_CHAIN_CONTEXT =
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const SOLANA_TESTNET_CHAIN_CONTEXT =
  "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z";
export const ETHEREUM_MAINNET_CHAIN_CONTEXT = "eip155:1";
export const BASE_CHAIN_CONTEXT = "eip155:8453";
export const BASE_SEPOLIA_CHAIN_CONTEXT = "eip155:84532";
export const POLYGON_CHAIN_CONTEXT = "eip155:137";

export const CHAIN_ALIASES: Record<string, string> = {
  [SOLANA_MAINNET_CHAIN_CONTEXT]: "Solana",
  [SOLANA_DEVNET_CHAIN_CONTEXT]: "Solana Devnet",
  [SOLANA_TESTNET_CHAIN_CONTEXT]: "Solana Testnet",
  [ETHEREUM_MAINNET_CHAIN_CONTEXT]: "Ethereum",
  [BASE_CHAIN_CONTEXT]: "Base",
  [BASE_SEPOLIA_CHAIN_CONTEXT]: "Base Sepolia",
  [POLYGON_CHAIN_CONTEXT]: "Polygon",
};

const LEGACY_CHAIN_CONTEXTS: Record<string, string> = {
  "solana-mainnet": SOLANA_MAINNET_CHAIN_CONTEXT,
  "solana:mainnet": SOLANA_MAINNET_CHAIN_CONTEXT,
  "solana:mainnet-beta": SOLANA_MAINNET_CHAIN_CONTEXT,
  "solana-devnet": SOLANA_DEVNET_CHAIN_CONTEXT,
  "solana:devnet": SOLANA_DEVNET_CHAIN_CONTEXT,
  "solana-testnet": SOLANA_TESTNET_CHAIN_CONTEXT,
  "solana:testnet": SOLANA_TESTNET_CHAIN_CONTEXT,
  ethereum: ETHEREUM_MAINNET_CHAIN_CONTEXT,
  base: BASE_CHAIN_CONTEXT,
  "base-sepolia": BASE_SEPOLIA_CHAIN_CONTEXT,
  "base:sepolia": BASE_SEPOLIA_CHAIN_CONTEXT,
  polygon: POLYGON_CHAIN_CONTEXT,
};

type SolanaClusterName = "mainnet" | "devnet" | "testnet";

function inferSolanaChainContextFromRpcUrl(
  rpcUrl?: string | null
): string | null {
  if (!rpcUrl) return null;

  const lower = rpcUrl.toLowerCase();

  if (lower.includes("devnet")) return SOLANA_DEVNET_CHAIN_CONTEXT;
  if (lower.includes("testnet")) return SOLANA_TESTNET_CHAIN_CONTEXT;
  if (lower.includes("mainnet")) return SOLANA_MAINNET_CHAIN_CONTEXT;

  return null;
}

function getSolanaClusterName(
  chainContext: string | null | undefined
): SolanaClusterName | null {
  const normalized = normalizeInputChainContext(chainContext);
  if (normalized === SOLANA_MAINNET_CHAIN_CONTEXT) return "mainnet";
  if (normalized === SOLANA_DEVNET_CHAIN_CONTEXT) return "devnet";
  if (normalized === SOLANA_TESTNET_CHAIN_CONTEXT) return "testnet";
  return null;
}

export function getConfiguredSolanaChainContext(): string {
  const rpcUrl =
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    null;
  const inferred =
    inferSolanaChainContextFromRpcUrl(rpcUrl) ?? SOLANA_DEVNET_CHAIN_CONTEXT;
  const configured =
    process.env.SOLANA_CHAIN_CONTEXT ||
    process.env.NEXT_PUBLIC_SOLANA_CHAIN_CONTEXT;

  if (!configured) return inferred;

  const normalized = normalizeChainContext(configured, {
    defaultLegacySolanaChainContext: inferred,
  });

  return normalized ?? inferred;
}

export function normalizeChainContext(
  value: string | null | undefined,
  options?: { defaultLegacySolanaChainContext?: string }
): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (CHAIN_ALIASES[trimmed]) return trimmed;

  const lower = trimmed.toLowerCase();
  if (lower === "solana") {
    return options?.defaultLegacySolanaChainContext ?? null;
  }

  return LEGACY_CHAIN_CONTEXTS[lower] ?? null;
}

export function normalizePersistedChainContext(
  value: string | null | undefined
): string {
  if (!value || !value.trim()) {
    return getConfiguredSolanaChainContext();
  }

  const normalized = normalizeChainContext(value, {
    defaultLegacySolanaChainContext: getConfiguredSolanaChainContext(),
  });

  return normalized ?? value;
}

export function normalizeInputChainContext(
  value: string | null | undefined
): string | null {
  return normalizeChainContext(value, {
    defaultLegacySolanaChainContext: getConfiguredSolanaChainContext(),
  });
}

export function getChainDisplayLabel(value: string | null | undefined): string {
  const normalized = normalizeInputChainContext(value);
  return (
    (normalized && CHAIN_ALIASES[normalized]) || value || "Unknown network"
  );
}

export function getConfiguredSolanaChainDisplayLabel(): string {
  return getChainDisplayLabel(getConfiguredSolanaChainContext());
}

export function getConfiguredSolanaRpcTargetLabel(): string {
  const rpcUrl =
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    null;
  const inferred = inferSolanaChainContextFromRpcUrl(rpcUrl);
  if (inferred === SOLANA_DEVNET_CHAIN_CONTEXT) return "devnet";
  if (inferred === SOLANA_TESTNET_CHAIN_CONTEXT) return "testnet";
  if (inferred === SOLANA_MAINNET_CHAIN_CONTEXT) return "mainnet";
  return rpcUrl || "unknown";
}

export function getConfiguredSolanaFmCluster(): string {
  const cluster = getSolanaClusterName(getConfiguredSolanaChainContext());
  if (cluster === "devnet") return "devnet-solana";
  if (cluster === "testnet") return "testnet-solana";
  return "mainnet-solana";
}

export function getConfiguredSolanaExplorerClusterParam(): string | null {
  const cluster = getSolanaClusterName(getConfiguredSolanaChainContext());
  if (cluster === "devnet") return "devnet";
  if (cluster === "testnet") return "testnet";
  return null;
}

export function getConfiguredSolanaFmTxUrl(tx: string): string {
  return `https://solana.fm/tx/${tx}?cluster=${getConfiguredSolanaFmCluster()}`;
}

export function getConfiguredSolanaExplorerTxUrl(tx: string): string {
  const url = new URL(`https://explorer.solana.com/tx/${tx}`);
  const cluster = getConfiguredSolanaExplorerClusterParam();
  if (cluster) url.searchParams.set("cluster", cluster);
  return url.toString();
}

export function getConfiguredSolanaExplorerAddressUrl(address: string): string {
  const url = new URL(`https://explorer.solana.com/address/${address}`);
  const cluster = getConfiguredSolanaExplorerClusterParam();
  if (cluster) url.searchParams.set("cluster", cluster);
  return url.toString();
}
