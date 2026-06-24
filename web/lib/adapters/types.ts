// Chain-agnostic seam between the agentvouch.xyz UI and a specific chain's
// wallet / reads / writes.
//
// SERVER-SAFE: this module is pure types — no "use client", no browser or wallet-SDK
// imports — so Server Components and route handlers can import it and call the read
// methods. Implementations live in sibling files: ./solana.ts (Phase 2) and ./base.ts
// (Phases 3/5). See .agents/plans/base-port-chain-adapter.plan.md.

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

export interface ConnectedWallet {
  address: string;
  chainContext: ChainContext;
  // the adapter holds the signer internally; the UI never touches raw keys
}

export interface CreateSkillListingInput {
  skillId: string;
  uri: string;
  name: string;
  description: string;
  priceUsdcMicros: bigint;
}

export interface X402Payment {
  header: string;
  payload: unknown;
}

export interface ChainAdapter {
  readonly chainContext: ChainContext;

  // --- identity / formatting (pure — safe on server) ---
  isValidAddress(value: string): boolean;
  shortenAddress(value: string): string;
  explorerTxUrl(ref: string): string;
  explorerAddressUrl(address: string): string;

  // --- reads (safe on server; prefer calling from Server Components / route handlers) ---
  listSkillListings(): Promise<SkillListingView[]>;
  fetchSkillListing(listingId: string): Promise<SkillListingView | null>;

  // --- wallet + writes (CLIENT-ONLY — only invoke from "use client" code) ---
  connect(): Promise<ConnectedWallet>;
  disconnect(): Promise<void>;
  registerAgent(metadataUri: string): Promise<TxResult>;
  createSkillListing(input: CreateSkillListingInput): Promise<TxResult>;
  purchaseSkill(listingId: string): Promise<TxResult>;

  // --- agent x402 (server-verifiable payment authorization) ---
  buildX402Payment(listingId: string): Promise<X402Payment>;
}
