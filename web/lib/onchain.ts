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

export const STALE_SKILL_LISTING_RELINK_MESSAGE =
  "This on-chain skill listing uses a stale AgentVouch layout. The author must relink or republish the listing before sponsored checkout.";

export type SkillListingAccountDataValidation =
  | { ok: true }
  | { ok: false; reason: string };

const SKILL_LISTING_MAX_URI_LEN = 256;
const SKILL_LISTING_MAX_NAME_LEN = 64;
const SKILL_LISTING_MAX_DESCRIPTION_LEN = 256;

function hasRemaining(data: Uint8Array, offset: number, bytes: number) {
  return offset >= 0 && bytes >= 0 && offset + bytes <= data.length;
}

function readStringLength(
  data: Uint8Array,
  offset: number,
  maxLength: number,
  field: string
): { ok: true; nextOffset: number } | { ok: false; reason: string } {
  if (!hasRemaining(data, offset, 4)) {
    return { ok: false, reason: `${field} length is truncated` };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const length = view.getUint32(offset, true);
  if (length > maxLength) {
    return { ok: false, reason: `${field} length exceeds current layout` };
  }
  const nextOffset = offset + 4 + length;
  if (!hasRemaining(data, offset + 4, length)) {
    return { ok: false, reason: `${field} bytes are truncated` };
  }
  return { ok: true, nextOffset };
}

export function validateSkillListingAccountData(
  data: Uint8Array
): SkillListingAccountDataValidation {
  if (data.length !== SKILL_LISTING_ACCOUNT_SIZE) {
    return {
      ok: false,
      reason: `expected ${SKILL_LISTING_ACCOUNT_SIZE} bytes, found ${data.length}`,
    };
  }

  for (let index = 0; index < SKILL_LISTING_DISCRIMINATOR.length; index += 1) {
    if (data[index] !== SKILL_LISTING_DISCRIMINATOR[index]) {
      return { ok: false, reason: "SkillListing discriminator mismatch" };
    }
  }

  let offset = 8 + 32; // discriminator + author.
  for (const [field, maxLength] of [
    ["skill_uri", SKILL_LISTING_MAX_URI_LEN],
    ["name", SKILL_LISTING_MAX_NAME_LEN],
    ["description", SKILL_LISTING_MAX_DESCRIPTION_LEN],
  ] as const) {
    const result = readStringLength(data, offset, maxLength, field);
    if (!result.ok) return result;
    offset = result.nextOffset;
  }

  // Fixed fields from price_usdc_micros through updated_at.
  const fixedBytesBeforeStatus =
    8 + // price_usdc_micros
    32 + // reward_vault
    32 + // reward_vault_rent_payer
    8 + // current_revision
    32 + // current_settlement
    32 + // current_author_proceeds_vault
    8 + // total_downloads
    8 + // total_revenue_usdc_micros
    8 + // total_author_revenue_usdc_micros
    8 + // total_voucher_revenue_usdc_micros
    8 + // active_reward_stake_usdc_micros
    4 + // active_reward_position_count
    16 + // reward_index_usdc_micros_x1e12
    8 + // unclaimed_voucher_revenue_usdc_micros
    8 + // created_at
    8; // updated_at
  if (!hasRemaining(data, offset, fixedBytesBeforeStatus + 1)) {
    return { ok: false, reason: "SkillListing fixed fields are truncated" };
  }
  offset += fixedBytesBeforeStatus;

  const status = data[offset];
  offset += 1;
  if (status > 2) {
    return { ok: false, reason: "SkillListing status is invalid" };
  }

  if (!hasRemaining(data, offset, 1)) {
    return { ok: false, reason: "locked_by_dispute option tag is missing" };
  }
  const lockedByDisputeOption = data[offset];
  offset += 1;
  if (lockedByDisputeOption !== 0 && lockedByDisputeOption !== 1) {
    return {
      ok: false,
      reason: "locked_by_dispute option tag is invalid",
    };
  }
  if (lockedByDisputeOption === 1) {
    if (!hasRemaining(data, offset, 32)) {
      return {
        ok: false,
        reason: "locked_by_dispute pubkey is truncated",
      };
    }
    offset += 32;
  }

  if (!hasRemaining(data, offset, 2)) {
    return { ok: false, reason: "SkillListing bump fields are truncated" };
  }

  return { ok: true };
}

export function isCurrentSkillListingAccountData(data: Uint8Array): boolean {
  return validateSkillListingAccountData(data).ok;
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
