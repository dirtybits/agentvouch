// getAdapter(chainContext) -> the ChainAdapter for that chain.
//
// Phase 1 (define-chainadapter): returns not-implemented stubs so the seam exists with no
// behavior change and no callers yet. SolanaAdapter lands in Phase 2 (./solana.ts) and
// BaseAdapter in Phases 3/5 (./base.ts); swap the stubs for `new SolanaAdapter(ctx)` /
// `new BaseAdapter(ctx)` then. See .agents/plans/base-port-chain-adapter.plan.md.

import { normalizeInputChainContext } from "@/lib/chains";
import type { ChainAdapter, ChainContext } from "./types";

export type {
  ChainAdapter,
  ChainContext,
  ConnectedWallet,
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
    connect: () => todo(),
    disconnect: () => todo(),
    registerAgent: () => todo(),
    createSkillListing: () => todo(),
    purchaseSkill: () => todo(),
    buildX402Payment: () => todo(),
  };
}

export function getAdapter(ctx: ChainContext): ChainAdapter {
  switch (chainFamily(ctx)) {
    case "evm":
      // Phase 3/5: return new BaseAdapter(ctx)
      return notImplementedAdapter(ctx, "Base");
    case "solana":
      // Phase 2: return new SolanaAdapter(ctx)
      return notImplementedAdapter(ctx, "Solana");
  }
}
