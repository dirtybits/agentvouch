import { createSolanaRpc, isAddress, type Address } from "@solana/kit";
import type { Base64EncodedBytes } from "@solana/rpc-types";
import {
  fetchMaybeSkillListing,
  getSkillListingDecoder,
  SKILL_LISTING_DISCRIMINATOR,
  type SkillListing,
} from "../generated/agentvouch/src/generated";
import { AGENTVOUCH_PROGRAM_ADDRESS } from "../generated/agentvouch/src/generated/programs";
import { IN_MEMORY_CACHE_TTL_MS } from "./cachePolicy";
import { DEFAULT_SOLANA_RPC_URL } from "./solanaRpc";
import { getOrPopulateMemoryCache } from "./serverCache";

const rpc = createSolanaRpc(DEFAULT_SOLANA_RPC_URL);
const asBase64 = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("base64") as Base64EncodedBytes;
const ALL_LISTINGS_CACHE_KEY = "all-skill-listings";
export const SKILL_LISTING_ACCOUNT_SIZE = 859;
const listingCache = new Map<
  string,
  { value: OnChainSkillListingRecord | null; expiresAt: number }
>();
const allListingsCache = new Map<
  string,
  { value: OnChainSkillListingRecord[]; expiresAt: number }
>();

export type OnChainSkillListingRecord = {
  publicKey: string;
  data: SkillListing;
};

export function isCurrentSkillListingAccountData(data: Uint8Array): boolean {
  return data.length === SKILL_LISTING_ACCOUNT_SIZE;
}

async function loadAllOnChainSkillListings(): Promise<
  OnChainSkillListingRecord[]
> {
  const accounts = await rpc
    .getProgramAccounts(AGENTVOUCH_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [
        {
          memcmp: {
            offset: 0n,
            bytes: asBase64(SKILL_LISTING_DISCRIMINATOR),
            encoding: "base64",
          },
        },
      ],
    })
    .send();

  const decoder = getSkillListingDecoder();
  const listings = accounts.flatMap((account) => {
    const data = new Uint8Array(Buffer.from(account.account.data[0], "base64"));
    if (!isCurrentSkillListingAccountData(data)) {
      return [];
    }

    return [
      {
        publicKey: account.pubkey,
        data: decoder.decode(data),
      },
    ];
  });

  const expiresAt = Date.now() + IN_MEMORY_CACHE_TTL_MS.onChainListings;
  for (const listing of listings) {
    listingCache.set(listing.publicKey, { value: listing, expiresAt });
  }

  return listings;
}

async function loadOnChainSkillListing(
  onChainAddress: string
): Promise<OnChainSkillListingRecord | null> {
  const cachedAll = allListingsCache.get(ALL_LISTINGS_CACHE_KEY);
  if (cachedAll && cachedAll.expiresAt > Date.now()) {
    return (
      cachedAll.value.find((listing) => listing.publicKey === onChainAddress) ??
      null
    );
  }

  if (!isAddress(onChainAddress)) {
    return null;
  }

  const account = await fetchMaybeSkillListing(rpc, onChainAddress as Address);
  if (!account.exists) {
    return null;
  }

  return {
    publicKey: onChainAddress,
    data: account.data,
  };
}

export async function listOnChainSkillListings(options?: {
  useCache?: boolean;
}): Promise<OnChainSkillListingRecord[]> {
  const useCache = options?.useCache ?? true;
  if (!useCache) {
    return loadAllOnChainSkillListings();
  }

  return getOrPopulateMemoryCache(
    allListingsCache,
    ALL_LISTINGS_CACHE_KEY,
    IN_MEMORY_CACHE_TTL_MS.onChainListings,
    loadAllOnChainSkillListings
  );
}

export async function fetchOnChainSkillListing(
  onChainAddress: string,
  options?: { useCache?: boolean }
): Promise<OnChainSkillListingRecord | null> {
  const useCache = options?.useCache ?? true;
  if (!useCache) {
    return loadOnChainSkillListing(onChainAddress);
  }

  return getOrPopulateMemoryCache(
    listingCache,
    onChainAddress,
    IN_MEMORY_CACHE_TTL_MS.onChainListings,
    () => loadOnChainSkillListing(onChainAddress)
  );
}

export async function getOnChainUsdcPrice(
  onChainAddress: string,
  options?: { useCache?: boolean }
): Promise<{ priceUsdcMicros: string; author: string } | null> {
  try {
    const listing = await fetchOnChainSkillListing(onChainAddress, options);
    if (!listing) return null;

    return {
      priceUsdcMicros: String(listing.data.priceUsdcMicros),
      author: listing.data.author as string,
    };
  } catch {
    /* best effort */
  }
  return null;
}
