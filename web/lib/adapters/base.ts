// BaseAdapter — implements the read half of ChainAdapter for AgentVouchEvm on Base (EVM).
//
// Phase 3a (this commit): reads (getListing) + identity/formatting, verified against the live Base
// Sepolia contract. Writes are NOT here — they are the client-only ChainWallet (Phase 4/5). NO UI
// callers are repointed yet: getAdapter("eip155:84532") now returns this, but nothing renders Base
// listings until the /skills hydration is wired (Phase 3b). See
// .agents/plans/base-port-chain-adapter.plan.md.
//
// viem is imported DYNAMICALLY inside the async read methods so importing the adapter registry
// never drags viem into a client bundle (mirrors SolanaAdapter's dynamic import of lib/onchain).
// The sync identity/format helpers are pure (no viem) for the same reason.

import {
  AGENTVOUCH_EVM_READ_ABI,
  LISTING_STATUS_ACTIVE,
} from "./agentVouchEvmAbi";
import {
  BASE_AGENTVOUCH_EVENT_SCAN_ENABLED,
  BASE_AGENTVOUCH_CONTRACT_ADDRESS,
  BASE_AGENTVOUCH_FROM_BLOCK,
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_RPC_URL,
} from "./baseConfig";
import type { ChainAdapter, ChainContext, SkillListingView } from "./types";

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;

const CONTRACT = BASE_AGENTVOUCH_CONTRACT_ADDRESS as `0x${string}`;

// The shape viem decodes the getListing tuple into (named components → object keys).
type RawListing = {
  author: `0x${string}`;
  skillIdHash: `0x${string}`;
  uri: string;
  name: string;
  description: string;
  priceUsdcMicros: bigint;
  currentRevision: bigint;
  totalDownloads: bigint;
  totalRevenueUsdcMicros: bigint;
  status: number;
  lockedByDispute: boolean;
  exists: boolean;
};

function chainIdFromContext(chainContext: ChainContext): number {
  return Number(chainContext.split(":")[1]);
}

function assertBaseSepoliaContext(chainContext: ChainContext): void {
  if (chainIdFromContext(chainContext) !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(
      `BaseAdapter reads only support eip155:${BASE_SEPOLIA_CHAIN_ID} until Base mainnet RPC/contract config exists. ` +
        `Received ${chainContext}.`
    );
  }
}

function listingToView(listingId: string, l: RawListing): SkillListingView {
  return {
    listingId,
    author: l.author,
    name: l.name,
    description: l.description,
    uri: l.uri,
    priceUsdcMicros: l.priceUsdcMicros,
    revision: Number(l.currentRevision),
    active: l.status === LISTING_STATUS_ACTIVE,
  };
}

export class BaseAdapter implements ChainAdapter {
  readonly chainContext: ChainContext;

  constructor(chainContext: ChainContext) {
    assertBaseSepoliaContext(chainContext);
    this.chainContext = chainContext;
  }

  // --- identity / formatting (pure — no viem, safe on server or client) ---
  isValidAddress(value: string): boolean {
    return EVM_ADDRESS_RE.test(value);
  }

  shortenAddress(value: string): string {
    // Match the dominant UI format: 6-char prefix ("0x" + 4) + "..." + 4-char suffix.
    if (value.length <= 13) return value;
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
  }

  explorerTxUrl(ref: string): string {
    return `${this.explorerBase()}/tx/${ref}`;
  }

  explorerAddressUrl(address: string): string {
    return `${this.explorerBase()}/address/${address}`;
  }

  private explorerBase(): string {
    return "https://sepolia.basescan.org";
  }

  private async publicClient() {
    const { createPublicClient, http } = await import("viem");
    return createPublicClient({ transport: http(BASE_SEPOLIA_RPC_URL) });
  }

  // --- reads (viem imported dynamically; server-oriented) ---
  async fetchSkillListing(listingId: string): Promise<SkillListingView | null> {
    if (!BYTES32_RE.test(listingId)) return null;
    const { parseAbi } = await import("viem");
    const client = await this.publicClient();
    // getListing returns the zero-struct (exists=false) for an unknown id — it does not revert.
    const result = (await client.readContract({
      address: CONTRACT,
      abi: parseAbi([...AGENTVOUCH_EVM_READ_ABI]),
      functionName: "getListing",
      args: [listingId as `0x${string}`],
    })) as unknown as RawListing;
    if (!result?.exists) return null;
    return listingToView(listingId, result);
  }

  // Chain-native enumeration via events (Solana's getProgramAccounts has no EVM equivalent). The
  // marketplace's preferred path is DB-driven (Phase 3b). Event-log fallback is opt-in because it
  // needs a deploy block and archive-capable RPC.
  async listSkillListings(): Promise<SkillListingView[]> {
    if (
      !BASE_AGENTVOUCH_EVENT_SCAN_ENABLED ||
      BASE_AGENTVOUCH_FROM_BLOCK <= 0n
    ) {
      throw new Error(
        "BaseAdapter.listSkillListings event scan is disabled by default. " +
          "Use DB-driven enumeration for marketplace reads, or set " +
          "BASE_AGENTVOUCH_EVENT_SCAN_ENABLED=1 and BASE_AGENTVOUCH_FROM_BLOCK to the deploy block " +
          "with an archive-capable BASE_SEPOLIA_RPC_URL."
      );
    }

    const { parseAbi } = await import("viem");
    const abi = parseAbi([...AGENTVOUCH_EVM_READ_ABI]);
    const client = await this.publicClient();
    const range = {
      fromBlock: BASE_AGENTVOUCH_FROM_BLOCK,
      toBlock: "latest" as const,
    };
    const fetchEvents = (
      eventName: "SkillListingCreated" | "SkillListingRemoved"
    ) =>
      client.getContractEvents({ address: CONTRACT, abi, eventName, ...range });
    // Historical eth_getLogs needs an archive-capable RPC; public base-sepolia free tiers
    // (publicnode, sepolia.base.org) reject it. The marketplace's production enumeration is
    // DB-driven (Phase 3b), which avoids getLogs entirely; this event scan is the fallback.
    const [created, removed] = await Promise.all([
      fetchEvents("SkillListingCreated"),
      fetchEvents("SkillListingRemoved"),
    ]).catch((error: unknown) => {
      throw new Error(
        "BaseAdapter.listSkillListings event scan failed — set BASE_SEPOLIA_RPC_URL to an " +
          "archive-capable RPC, or use DB-driven enumeration (Phase 3b). Cause: " +
          (error instanceof Error ? error.message : String(error))
      );
    });

    const idOf = (e: { args: unknown }) =>
      (e.args as { listingId?: `0x${string}` }).listingId;
    const removedIds = new Set(removed.map(idOf).filter(Boolean));
    const liveIds = [
      ...new Set(
        created.map(idOf).filter((id): id is `0x${string}` => Boolean(id))
      ),
    ].filter((id) => !removedIds.has(id));

    const views = await Promise.all(
      liveIds.map((id) => this.fetchSkillListing(id))
    );
    return views.filter((v): v is SkillListingView => v !== null);
  }
}
