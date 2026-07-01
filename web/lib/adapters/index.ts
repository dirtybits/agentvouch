// getAdapter(chainContext) -> the ChainAdapter for that chain.
//
// getAdapter returns a ChainAdapter (server-safe reads + formatting). Wallet-bound WRITES are a
// separate client-only ChainWallet from the chain-aware wallet hook (Phase 2b) — not here.
// Reads are live for Solana's configured context and Base Sepolia. Base mainnet remains blocked
// until the mainnet RPC/contract config exists. No UI callers repoint yet.
// See .agents/plans/base-port-chain-adapter.plan.md.

import {
  BASE_SEPOLIA_CHAIN_CONTEXT,
  normalizeInputChainContext,
} from "@/lib/chains";
import { BaseAdapter } from "./base";
import { SolanaAdapter } from "./solana";
import type { ChainAdapter, ChainContext } from "./types";

export type {
  ChainAdapter,
  ChainContext,
  ChainWallet,
  CreateSkillListingInput,
  PurchaseSkillInput,
  SkillListingView,
  TxResult,
  X402Payment,
} from "./types";

type ChainFamily = "base-sepolia" | "solana";

function canonicalChainContext(ctx: ChainContext): ChainContext {
  const normalized = normalizeInputChainContext(ctx) ?? ctx;
  if (!normalized) throw new Error(`Unsupported chain context: ${ctx}`);
  return normalized;
}

function chainFamily(
  ctx: ChainContext,
  originalCtx: ChainContext
): ChainFamily {
  if (ctx === BASE_SEPOLIA_CHAIN_CONTEXT) return "base-sepolia";
  if (ctx.startsWith("eip155:")) {
    throw new Error(
      `Unsupported EVM chain context: ${originalCtx} (normalized ${ctx}). ` +
        `BaseAdapter reads only support ${BASE_SEPOLIA_CHAIN_CONTEXT} until Base mainnet config exists.`
    );
  }
  if (ctx.startsWith("solana:")) return "solana";
  throw new Error(
    `Unsupported chain context: ${originalCtx} (normalized ${ctx})`
  );
}

export function getAdapter(ctx: ChainContext): ChainAdapter {
  const normalized = canonicalChainContext(ctx);
  const family = chainFamily(normalized, ctx);
  switch (family) {
    case "base-sepolia":
      return new BaseAdapter(normalized);
    case "solana":
      return new SolanaAdapter(normalized);
    default: {
      const exhaustive: never = family;
      return exhaustive;
    }
  }
}
