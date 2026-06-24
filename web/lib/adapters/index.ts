// getAdapter(chainContext) -> the ChainAdapter for that chain.
//
// Phase 2a: solana:* resolves to SolanaAdapter (reads + formatting live; wallet/writes are
// Phase 2b). eip155:* is still a not-implemented stub until BaseAdapter (Phases 3/5). There are
// still no UI callers — repointing them is later in Phase 2.
// See .agents/plans/base-port-chain-adapter.plan.md.

import { normalizeInputChainContext } from "@/lib/chains";
import { SolanaAdapter } from "./solana";
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
      return new SolanaAdapter(ctx);
  }
}
