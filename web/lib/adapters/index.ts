// getAdapter(chainContext) -> the ChainAdapter for that chain.
//
// getAdapter returns a ChainAdapter (server-safe reads + formatting). Wallet-bound WRITES are a
// separate client-only ChainWallet from the chain-aware wallet hook (Phase 2b) — not here.
// Phase 2a: solana:* -> SolanaAdapter (reads live); eip155:* is a not-implemented stub until
// BaseAdapter (Phases 3/5). No UI callers yet. See .agents/plans/base-port-chain-adapter.plan.md.

import { normalizeInputChainContext } from "@/lib/chains";
import { SolanaAdapter } from "./solana";
import type { ChainAdapter, ChainContext } from "./types";

export type {
  ChainAdapter,
  ChainContext,
  ChainWallet,
  CreateSkillListingInput,
  SkillListingView,
  TxResult,
  X402Payment,
} from "./types";

type ChainFamily = "solana" | "evm";

function chainFamily(ctx: ChainContext): ChainFamily {
  const normalized = normalizeInputChainContext(ctx) ?? ctx;
  if (normalized.startsWith("eip155:")) return "evm";
  if (normalized.startsWith("solana:")) return "solana";
  throw new Error(`Unsupported chain context: ${ctx}`);
}

// A ChainAdapter whose every operation throws — replaced per family in later phases.
function notImplementedAdapter(
  chainContext: ChainContext,
  label: string
): ChainAdapter {
  const todo = (): never => {
    throw new Error(
      `${label} chain adapter is not implemented yet (chain ${chainContext}). ` +
        `See .agents/plans/base-port-chain-adapter.plan.md.`
    );
  };
  return {
    chainContext,
    isValidAddress: () => todo(),
    shortenAddress: () => todo(),
    explorerTxUrl: () => todo(),
    explorerAddressUrl: () => todo(),
    listSkillListings: () => todo(),
    fetchSkillListing: () => todo(),
  };
}

export function getAdapter(ctx: ChainContext): ChainAdapter {
  switch (chainFamily(ctx)) {
    case "evm":
      // Phase 3/5: return new BaseAdapter(ctx)
      return notImplementedAdapter(ctx, "Base");
    case "solana":
      return new SolanaAdapter(ctx);
  }
}
