// getAdapter(chainContext) -> the ChainAdapter for that chain.
//
// getAdapter returns a ChainAdapter (server-safe reads + formatting). Wallet-bound WRITES are a
// separate client-only ChainWallet from the chain-aware wallet hook (Phase 2b) — not here.
// Reads are live for both families: solana:* -> SolanaAdapter, eip155:* -> BaseAdapter (Phase 3a).
// No UI callers repoint yet. See .agents/plans/base-port-chain-adapter.plan.md.

import { normalizeInputChainContext } from "@/lib/chains";
import { BaseAdapter } from "./base";
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

export function getAdapter(ctx: ChainContext): ChainAdapter {
  switch (chainFamily(ctx)) {
    case "evm":
      return new BaseAdapter(ctx);
    case "solana":
      return new SolanaAdapter(ctx);
  }
}
