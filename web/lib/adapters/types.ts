// Chain-agnostic seam between the agentvouch.xyz UI and a specific chain.
//
// Two interfaces, split along the Next.js server/client boundary (signer-injection decision,
// Phase 2b — see .agents/plans/base-port-chain-adapter.plan.md):
//
//   ChainAdapter — SERVER-SAFE reads + pure helpers. From getAdapter(ctx). No wallet, no
//     "use client": Server Components and route handlers can import and call these.
//   ChainWallet  — CLIENT-ONLY, wallet-bound writes. From the chain-aware wallet hook
//     (useChainWallet / evolved useAgentVouchWallet). Wallet CONNECTION stays in each chain's
//     React provider (Solana ConnectorKit/Phantom; Base wagmi/passkey); the hook returns the
//     active chain's connected wallet with its writes already bound to the signer, so the UI
//     never threads a signer and calls writes uniformly regardless of chain.

export type ChainContext = string; // e.g. "solana:5eykt4…" | "eip155:8453" | "eip155:84532"

export interface SkillListingView {
  listingId: string; // chain-native id (Solana PDA address | EVM bytes32) as a string
  author: string; // chain-native address
  name: string;
  description: string;
  uri: string;
  priceUsdcMicros: bigint;
  revision: number;
  active: boolean;
}

export interface TxResult {
  ref: string; // tx signature | tx hash | userOp hash
  explorerUrl: string;
  paidGas: boolean; // false when sponsored (4337 / x402)
}

export interface CreateSkillListingInput {
  skillId: string;
  uri: string;
  name: string;
  description: string;
  priceUsdcMicros: bigint;
}

export interface PurchaseSkillInput {
  listingId: string;
  expectedPriceUsdcMicros: bigint;
}

export interface X402Payment {
  header: string;
  payload: unknown;
}

// Server-safe: reads + pure helpers. Obtained from getAdapter(ctx).
export interface ChainAdapter {
  readonly chainContext: ChainContext;

  // identity / formatting (pure)
  isValidAddress(value: string): boolean;
  shortenAddress(value: string): string;
  explorerTxUrl(ref: string): string;
  explorerAddressUrl(address: string): string;

  // reads (prefer calling from Server Components / route handlers)
  listSkillListings(): Promise<SkillListingView[]>;
  fetchSkillListing(listingId: string): Promise<SkillListingView | null>;
}

// Client-only: a connected, wallet-bound session from the chain-aware wallet hook (Phase 2b).
// Writes are already bound to the connected signer — the UI threads no signer and is
// chain-agnostic at the call site. Connection itself stays in each chain's React provider.
export interface ChainWallet {
  readonly chainContext: ChainContext;
  readonly address: string;

  disconnect(): Promise<void>;

  registerAgent(metadataUri: string): Promise<TxResult>;
  createSkillListing(input: CreateSkillListingInput): Promise<TxResult>;
  purchaseSkill(input: PurchaseSkillInput): Promise<TxResult>;

  // agent x402 (server-verifiable payment authorization)
  buildX402Payment(listingId: string): Promise<X402Payment>;
}
