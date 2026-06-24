// SolanaAdapter — implements ChainAdapter by delegating to the existing Solana modules.
//
// Phase 2a (this commit): reads + identity/formatting are wired (delegating to lib/onchain.ts
// and lib/chains.ts). NO callers are repointed yet, so the live Solana app is untouched.
//
// Phase 2b (next): wallet + writes are NOT on this adapter. Per the settled signer-injection
// design, they live on a separate client-only ChainWallet from the chain-aware wallet hook
// (useChainWallet / evolved useAgentVouchWallet) — Solana connection stays in
// components/WalletContextProvider.tsx and sponsored purchase in /api/transactions/sponsored/*.
// See .agents/plans/base-port-chain-adapter.plan.md.
//
// `lib/onchain.ts` is imported dynamically inside the read methods (it pulls Buffer + RPC code
// meant for the server) so importing the adapter registry never drags it into a client bundle.

import { isAddress } from "@solana/kit";

import {
  getConfiguredSolanaExplorerAddressUrl,
  getConfiguredSolanaExplorerTxUrl,
} from "@/lib/chains";
import { SkillStatus } from "../../generated/agentvouch/src/generated";
import type { OnChainSkillListingRecord } from "@/lib/onchain";

import type { ChainAdapter, ChainContext, SkillListingView } from "./types";

function recordToView(record: OnChainSkillListingRecord): SkillListingView {
  const d = record.data;
  return {
    listingId: record.publicKey,
    author: String(d.author),
    name: d.name,
    description: d.description,
    uri: d.skillUri,
    priceUsdcMicros: d.priceUsdcMicros,
    revision: Number(d.currentRevision),
    active: d.status === SkillStatus.Active,
  };
}

export class SolanaAdapter implements ChainAdapter {
  readonly chainContext: ChainContext;

  constructor(chainContext: ChainContext) {
    this.chainContext = chainContext;
  }

  // --- identity / formatting ---
  isValidAddress(value: string): boolean {
    return isAddress(value);
  }

  shortenAddress(value: string): string {
    // Dominant UI format: 6-char prefix + literal "..." + 4-char suffix (author page,
    // SkillDetailClient). NOT the "…" ellipsis char — no call site uses it. Bespoke
    // lengths elsewhere (4/4 wallet button, 12/6 identity panel) are reconciled in Phase 2c.
    if (value.length <= 13) return value;
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
  }

  explorerTxUrl(ref: string): string {
    return getConfiguredSolanaExplorerTxUrl(ref);
  }

  explorerAddressUrl(address: string): string {
    return getConfiguredSolanaExplorerAddressUrl(address);
  }

  // --- reads (delegate to the existing onchain module; server-oriented) ---
  async listSkillListings(): Promise<SkillListingView[]> {
    const { listOnChainSkillListings } = await import("@/lib/onchain");
    const records = await listOnChainSkillListings();
    return records.map(recordToView);
  }

  async fetchSkillListing(listingId: string): Promise<SkillListingView | null> {
    const { fetchOnChainSkillListing } = await import("@/lib/onchain");
    const record = await fetchOnChainSkillListing(listingId);
    return record ? recordToView(record) : null;
  }
}
