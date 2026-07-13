import {
  BASE_CHAIN_CONTEXT,
  BASE_SEPOLIA_CHAIN_CONTEXT,
  getChainDisplayLabel,
  normalizeInputChainContext,
} from "@/lib/chains";

export type ChainBadgeTone = "solana" | "base" | "default";

export interface ChainBadge {
  chainContext: string;
  label: string;
  tone: ChainBadgeTone;
}

export function getChainBadge(input: {
  chainContext: string | null | undefined;
  onChainAddress: string | null | undefined;
  evmListingId: string | null | undefined;
}): ChainBadge | null {
  // A skill's chain context describes its publisher/trust identity too. Only
  // advertise a network listing when there is an actual Solana or EVM listing.
  if (!input.onChainAddress && !input.evmListingId) return null;

  const chainContext = normalizeInputChainContext(input.chainContext);
  if (!chainContext) return null;

  return {
    chainContext,
    label: getChainDisplayLabel(chainContext),
    tone: chainContext.startsWith("solana:")
      ? "solana"
      : chainContext === BASE_CHAIN_CONTEXT ||
        chainContext === BASE_SEPOLIA_CHAIN_CONTEXT
      ? "base"
      : "default",
  };
}
