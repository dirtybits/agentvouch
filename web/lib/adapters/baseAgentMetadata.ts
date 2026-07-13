import { BASE_SEPOLIA_CHAIN_CONTEXT } from "@/lib/chains";

const DEFAULT_AGENTVOUCH_ORIGIN = "https://agentvouch.xyz";

function getAgentVouchOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ||
    DEFAULT_AGENTVOUCH_ORIGIN
  );
}

export function buildBaseAgentMetadataUri(authorAddress: string): string {
  const normalizedAddress = authorAddress.trim();
  if (!normalizedAddress) {
    throw new Error("Base agent metadata URI requires an author address.");
  }

  const params = new URLSearchParams({
    chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
  });
  return `${getAgentVouchOrigin()}/api/author/${encodeURIComponent(
    normalizedAddress
  )}?${params.toString()}`;
}
