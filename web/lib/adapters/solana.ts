// SolanaAdapter — implements ChainAdapter by delegating to the existing Solana modules.
//
// Phase 2a (this commit): reads + identity/formatting are wired (delegating to lib/onchain.ts
// and lib/chains.ts). NO callers are repointed yet, so the live Solana app is untouched.
//
// Phase 2b (next): wallet + write methods. Solana signing currently lives in the React wallet
// context (useAgentVouchWallet in components/WalletContextProvider.tsx), and sponsored
// purchase runs in the /api/transactions/sponsored/* route handlers. Wiring those through a
// plain adapter object needs the signer-injection design called out in the plan — until then
// the wallet/write methods throw. See .agents/plans/base-port-chain-adapter.plan.md.
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

import type {
  ChainAdapter,
  ChainContext,
  ConnectedWallet,
  CreateSkillListingInput,
  SkillListingView,
  TxResult,
  X402Payment,
} from "./types";

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
    return value.length <= 12
      ? value
      : `${value.slice(0, 4)}…${value.slice(-4)}`;
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

  // --- wallet + writes — Phase 2b (see plan) ---
  connect(): Promise<ConnectedWallet> {
    return this.phase2b("connect");
  }

  disconnect(): Promise<void> {
    return this.phase2b("disconnect");
  }

  registerAgent(_metadataUri: string): Promise<TxResult> {
    return this.phase2b("registerAgent");
  }

  createSkillListing(_input: CreateSkillListingInput): Promise<TxResult> {
    return this.phase2b("createSkillListing");
  }

  purchaseSkill(_listingId: string): Promise<TxResult> {
    return this.phase2b("purchaseSkill");
  }

  buildX402Payment(_listingId: string): Promise<X402Payment> {
    return this.phase2b("buildX402Payment");
  }

  private phase2b(method: string): never {
    throw new Error(
      `SolanaAdapter.${method} is Phase 2b — Solana wallet/writes still flow through ` +
        `useAgentVouchWallet and the existing API routes until the adapter signer design ` +
        `lands. See .agents/plans/base-port-chain-adapter.plan.md.`
    );
  }
}
