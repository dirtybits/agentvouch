// Chain-aware address + explorer helpers (Phase 7).
//
// One home for cross-chain address handling at UI/API boundaries, so mixed-chain surfaces stop
// assuming every wallet/listing/tx is Solana-shaped. Server-safe and client-safe: only pure
// helpers from viem / @solana/kit and the adapter registry's formatting methods are used.
//
// Normalization invariant (Phase 6): STORAGE and lookup boundaries use
// `normalizeChainAddressForStorage` — `eip155:*` addresses are lowercased (the chain-qualified
// unique indexes and entitlement lookups depend on this), Solana base58 is case-preserved.
// DISPLAY boundaries may checksum EVM addresses via `formatChainAddressForDisplay`. Never write
// a display-formatted address to the database.

import { isAddress as isSolanaAddress } from "@solana/kit";
import {
  getAddress as checksumEvmAddress,
  isAddress as isEvmAddress,
} from "viem";
import { normalizeInputChainContext } from "@/lib/chains";
import { getAdapter } from "@/lib/adapters";
import type { ChainAdapter } from "@/lib/adapters/types";

export type ChainAddressRef = {
  chainContext: string | null | undefined;
  value: string | null | undefined;
};

type ChainFamily = "solana" | "evm" | null;

function familyOf(chainContext: string | null | undefined): ChainFamily {
  const normalized = normalizeInputChainContext(chainContext ?? null);
  if (!normalized) return null;
  if (normalized.startsWith("solana:")) return "solana";
  if (normalized.startsWith("eip155:")) return "evm";
  return null;
}

// Display helpers must degrade to null/fallback for chains the adapter registry does not
// support yet (e.g. Base mainnet before Phase 10), so adapter resolution never throws here.
function adapterFor(
  chainContext: string | null | undefined
): ChainAdapter | null {
  if (!chainContext) return null;
  try {
    return getAdapter(chainContext);
  } catch {
    return null;
  }
}

/**
 * Temporary namespace heuristic carried over from Phase 6 (trust snapshots, actor rendering):
 * a `0x`-prefixed value is treated as EVM-shaped, anything else as potentially Solana base58.
 * This is sound only while every supported non-Solana chain is an EVM chain with `0x`
 * addresses; a future non-EVM chain (or an EVM-like namespace that reuses `0x`) requires
 * chain-context discrimination instead of string shape. Prefer this named helper over
 * scattered `startsWith("0x")` checks so the caveat travels with the code.
 */
export function isEvmShapedAddress(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("0x");
}

export function isValidChainAddress(ref: ChainAddressRef): boolean {
  const value = ref.value?.trim();
  if (!value) return false;
  switch (familyOf(ref.chainContext)) {
    case "solana":
      return isSolanaAddress(value);
    case "evm":
      return isEvmAddress(value);
    default:
      return false;
  }
}

/**
 * Storage/lookup normalization (Phase 6 invariant): EVM lowercased, Solana case-preserved.
 * Returns null for invalid values or unknown chain contexts — write paths should treat null
 * as a validation failure.
 */
export function normalizeChainAddressForStorage(
  ref: ChainAddressRef
): string | null {
  const value = ref.value?.trim();
  if (!value) return null;
  switch (familyOf(ref.chainContext)) {
    case "solana":
      return isSolanaAddress(value) ? value : null;
    case "evm":
      return isEvmAddress(value) ? value.toLowerCase() : null;
    default:
      return null;
  }
}

/**
 * Display formatting: EVM addresses are checksummed, Solana addresses pass through.
 * Never persist this value — storage boundaries use normalizeChainAddressForStorage.
 */
export function formatChainAddressForDisplay(
  ref: ChainAddressRef
): string | null {
  const value = ref.value?.trim();
  if (!value) return null;
  switch (familyOf(ref.chainContext)) {
    case "solana":
      return isSolanaAddress(value) ? value : null;
    case "evm":
      return isEvmAddress(value) ? checksumEvmAddress(value) : null;
    default:
      return null;
  }
}

/**
 * Dominant UI short form (6-prefix + "..." + 4-suffix), delegated to the chain adapter when
 * one exists so per-chain conventions stay in one place. Unknown chains fall back to the same
 * generic 6/4 truncation; missing values return `opts.fallback` (default "").
 * Intentionally bespoke truncations (4/4 wallet pill, 12/6 identity panel, tx-signature and
 * CID/hash slicing) are NOT address abstractions and should stay local per the Phase 7 plan.
 */
export function shortenChainAddress(
  ref: ChainAddressRef,
  opts?: { fallback?: string }
): string {
  const value = ref.value?.trim();
  if (!value) return opts?.fallback ?? "";
  const adapter = adapterFor(ref.chainContext ?? null);
  if (adapter) return adapter.shortenAddress(value);
  if (value.length <= 13) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function chainExplorerAddressUrl(ref: ChainAddressRef): string | null {
  const value = ref.value?.trim();
  if (!value || !isValidChainAddress(ref)) return null;
  const adapter = adapterFor(ref.chainContext ?? null);
  return adapter ? adapter.explorerAddressUrl(value) : null;
}

export function chainExplorerTxUrl(input: {
  chainContext: string | null | undefined;
  tx: string | null | undefined;
}): string | null {
  const tx = input.tx?.trim();
  if (!tx) return null;
  const adapter = adapterFor(input.chainContext ?? null);
  return adapter ? adapter.explorerTxUrl(tx) : null;
}
