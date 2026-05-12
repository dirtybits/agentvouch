import { createSolanaRpc, getAddressDecoder } from "@solana/kit";
import type { Base58EncodedBytes, Base64EncodedBytes } from "@solana/rpc-types";
import { decodeBase64, encodeBase64 } from "@/lib/base64";
import {
  AUTHOR_DISPUTE_DISCRIMINATOR,
  AuthorDisputeLiabilityScope,
  AuthorDisputeReason,
  AuthorDisputeRuling,
  AuthorDisputeStatus,
  getAuthorDisputeDecoder,
  type AuthorDispute,
} from "../generated/agentvouch/src/generated";
import { AGENTVOUCH_PROGRAM_ADDRESS } from "../generated/agentvouch/src/generated/programs";
import { IN_MEMORY_CACHE_TTL_MS } from "./cachePolicy";
import { DEFAULT_SOLANA_RPC_URL } from "./solanaRpc";
import { getOrPopulateMemoryCache } from "./serverCache";

const RPC_URL = DEFAULT_SOLANA_RPC_URL;
const rpc = createSolanaRpc(RPC_URL);
const CACHE_TTL_MS = IN_MEMORY_CACHE_TTL_MS.authorDisputes;
const AUTHOR_DISPUTE_VOUCH_LINK_DISCRIMINATOR = new Uint8Array([
  30, 4, 152, 103, 232, 184, 75, 177,
]);
const AUTHOR_DISPUTE_VOUCH_LINK_SIZE = 81;

const asBase64 = (bytes: Uint8Array) =>
  encodeBase64(bytes) as Base64EncodedBytes;
const asBase58 = (value: string) => value as unknown as Base58EncodedBytes;
const addressDecoder = getAddressDecoder();

type DecodedAuthorDisputeAccount = {
  publicKey: string;
  account: AuthorDispute;
};

export interface AuthorDisputeMetrics {
  disputesAgainstAuthor: number;
  disputesUpheldAgainstAuthor: number;
  activeDisputesAgainstAuthor: number;
}

export interface AuthorDisputeRecord {
  publicKey: string;
  disputeId: string;
  author: string;
  challenger: string;
  reason: AuthorDisputeReason;
  reasonLabel: string;
  evidenceUri: string;
  status: AuthorDisputeStatus;
  statusLabel: string;
  ruling: AuthorDisputeRuling | null;
  rulingLabel: string | null;
  liabilityScope: AuthorDisputeLiabilityScope;
  liabilityScopeLabel: string;
  skillListing: string;
  skillPriceUsdcMicrosSnapshot: number;
  purchase: string | null;
  backingVouchCountSnapshot: number;
  linkedVouchCount: number;
  linkedVouches: string[];
  bondAmount: number;
  createdAt: number;
  resolvedAt: number | null;
}

let allDisputesCache: {
  expires: number;
  data: DecodedAuthorDisputeAccount[];
} | null = null;
const authorDisputesCache = new Map<
  string,
  { value: DecodedAuthorDisputeAccount[]; expiresAt: number }
>();

function unwrapOption<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    const maybeOption = value as Record<string, unknown>;
    if ("value" in maybeOption) {
      return (maybeOption.value as T | null) ?? null;
    }
    if ("__option" in maybeOption) {
      return maybeOption.__option === "Some"
        ? (maybeOption.value as T | null) ?? null
        : null;
    }
  }
  return value as T;
}

export function getAuthorDisputeReasonLabel(
  reason: AuthorDisputeReason | number
): string {
  switch (reason) {
    case AuthorDisputeReason.MaliciousSkill:
      return "Malicious skill";
    case AuthorDisputeReason.FraudulentClaims:
      return "Fraudulent claims";
    case AuthorDisputeReason.FailedDelivery:
      return "Failed delivery";
    case AuthorDisputeReason.Other:
      return "Other";
    default:
      return "Unknown";
  }
}

export function getAuthorDisputeStatusLabel(
  status: AuthorDisputeStatus | number
): string {
  switch (status) {
    case AuthorDisputeStatus.Open:
      return "Open";
    case AuthorDisputeStatus.Resolved:
      return "Resolved";
    default:
      return "Unknown";
  }
}

export function getAuthorDisputeRulingLabel(
  ruling: AuthorDisputeRuling | number | null | undefined
): string | null {
  if (ruling === null || ruling === undefined) return null;
  switch (ruling) {
    case AuthorDisputeRuling.Upheld:
      return "Upheld";
    case AuthorDisputeRuling.Dismissed:
      return "Dismissed";
    default:
      return "Unknown";
  }
}

export function getAuthorDisputeLiabilityScopeLabel(
  liabilityScope: AuthorDisputeLiabilityScope | number
): string {
  switch (liabilityScope) {
    case AuthorDisputeLiabilityScope.AuthorBondOnly:
      return "Author bond only";
    case AuthorDisputeLiabilityScope.AuthorBondThenVouchers:
      return "Author bond then vouchers";
    default:
      return "Unknown";
  }
}

async function getAllAuthorDisputeAccounts(
  useCache = true
): Promise<DecodedAuthorDisputeAccount[]> {
  const now = Date.now();
  if (useCache && allDisputesCache && allDisputesCache.expires > now) {
    return allDisputesCache.data;
  }

  const accounts = await rpc
    .getProgramAccounts(AGENTVOUCH_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [
        {
          memcmp: {
            offset: 0n,
            bytes: asBase64(AUTHOR_DISPUTE_DISCRIMINATOR),
            encoding: "base64",
          },
        },
      ],
    })
    .send();
  const decoder = getAuthorDisputeDecoder();
  const data = accounts.map((account) => ({
    publicKey: account.pubkey,
    account: decoder.decode(decodeBase64(account.account.data[0])),
  }));

  allDisputesCache = { data, expires: now + CACHE_TTL_MS };
  return data;
}

async function loadAuthorDisputeAccountsByAuthor(
  authorPubkey: string
): Promise<DecodedAuthorDisputeAccount[]> {
  const accounts = await rpc
    .getProgramAccounts(AGENTVOUCH_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [
        {
          memcmp: {
            offset: 0n,
            bytes: asBase64(AUTHOR_DISPUTE_DISCRIMINATOR),
            encoding: "base64",
          },
        },
        {
          memcmp: {
            offset: 16n,
            bytes: asBase58(authorPubkey),
            encoding: "base58",
          },
        },
      ],
    })
    .send();
  const decoder = getAuthorDisputeDecoder();
  return accounts.map((account) => ({
    publicKey: account.pubkey,
    account: decoder.decode(decodeBase64(account.account.data[0])),
  }));
}

async function getAuthorDisputeAccountsByAuthor(
  authorPubkey: string,
  useCache = true
): Promise<DecodedAuthorDisputeAccount[]> {
  if (!useCache) {
    return loadAuthorDisputeAccountsByAuthor(authorPubkey);
  }

  return getOrPopulateMemoryCache(
    authorDisputesCache,
    authorPubkey,
    CACHE_TTL_MS,
    () => loadAuthorDisputeAccountsByAuthor(authorPubkey)
  );
}

export async function listAuthorDisputesByAuthor(
  authorPubkey: string,
  options: { includeLinks?: boolean; useCache?: boolean } = {}
): Promise<AuthorDisputeRecord[]> {
  const useCache = options.useCache ?? true;
  const includeLinks = options.includeLinks ?? true;
  const authorDisputes = await getAuthorDisputeAccountsByAuthor(
    authorPubkey,
    useCache
  );
  const linkedVouchesByDispute = includeLinks
    ? new Map<string, string[]>(
        await Promise.all(
          authorDisputes.map(
            async (dispute): Promise<[string, string[]]> => [
              dispute.publicKey,
              await listAuthorDisputeLinks(dispute.publicKey, useCache),
            ]
          )
        )
      )
    : null;

  return authorDisputes
    .map((dispute) => {
      const ruling = unwrapOption<AuthorDisputeRuling>(dispute.account.ruling);
      const skillListing = String(dispute.account.skillListing);
      const purchase = unwrapOption<string>(dispute.account.purchase);
      const resolvedAt = unwrapOption<bigint>(dispute.account.resolvedAt);
      return {
        publicKey: dispute.publicKey,
        disputeId: dispute.account.disputeId.toString(),
        author: String(dispute.account.author),
        challenger: String(dispute.account.challenger),
        reason: dispute.account.reason,
        reasonLabel: getAuthorDisputeReasonLabel(dispute.account.reason),
        evidenceUri: dispute.account.evidenceUri,
        status: dispute.account.status,
        statusLabel: getAuthorDisputeStatusLabel(dispute.account.status),
        ruling,
        rulingLabel: getAuthorDisputeRulingLabel(ruling),
        liabilityScope: dispute.account.liabilityScope,
        liabilityScopeLabel: getAuthorDisputeLiabilityScopeLabel(
          dispute.account.liabilityScope
        ),
        skillListing,
        skillPriceUsdcMicrosSnapshot: Number(
          dispute.account.skillPriceUsdcMicrosSnapshot
        ),
        purchase,
        backingVouchCountSnapshot: dispute.account.backingVouchCountSnapshot,
        linkedVouchCount: dispute.account.linkedVouchCount,
        linkedVouches: linkedVouchesByDispute?.get(dispute.publicKey) ?? [],
        bondAmount: Number(dispute.account.bondAmountUsdcMicros),
        createdAt: Number(dispute.account.createdAt),
        resolvedAt: resolvedAt === null ? null : Number(resolvedAt),
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function resolveAuthorDisputeMetrics(
  authorPubkey: string,
  useCache = true
): Promise<AuthorDisputeMetrics> {
  const disputes = await getAuthorDisputeAccountsByAuthor(
    authorPubkey,
    useCache
  );
  const metrics: AuthorDisputeMetrics = {
    disputesAgainstAuthor: 0,
    disputesUpheldAgainstAuthor: 0,
    activeDisputesAgainstAuthor: 0,
  };

  for (const dispute of disputes) {
    metrics.disputesAgainstAuthor += 1;
    if (dispute.account.status === AuthorDisputeStatus.Open) {
      metrics.activeDisputesAgainstAuthor += 1;
    }
    if (
      unwrapOption<AuthorDisputeRuling>(dispute.account.ruling) ===
      AuthorDisputeRuling.Upheld
    ) {
      metrics.disputesUpheldAgainstAuthor += 1;
    }
  }

  return metrics;
}

export async function resolveMultipleAuthorDisputeMetrics(
  authorPubkeys: string[],
  useCache = true
): Promise<Map<string, AuthorDisputeMetrics>> {
  const unique = [...new Set(authorPubkeys)];
  const metrics = new Map<string, AuthorDisputeMetrics>();
  for (const authorPubkey of unique) {
    metrics.set(authorPubkey, {
      disputesAgainstAuthor: 0,
      disputesUpheldAgainstAuthor: 0,
      activeDisputesAgainstAuthor: 0,
    });
  }

  if (unique.length === 0) {
    return metrics;
  }

  const authorSet = new Set(unique);
  const disputes = await getAllAuthorDisputeAccounts(useCache);
  for (const dispute of disputes) {
    const author = String(dispute.account.author);
    if (!authorSet.has(author)) continue;

    const next = metrics.get(author)!;
    next.disputesAgainstAuthor += 1;
    if (dispute.account.status === AuthorDisputeStatus.Open) {
      next.activeDisputesAgainstAuthor += 1;
    }
    if (
      unwrapOption<AuthorDisputeRuling>(dispute.account.ruling) ===
      AuthorDisputeRuling.Upheld
    ) {
      next.disputesUpheldAgainstAuthor += 1;
    }
  }

  return metrics;
}

export async function getAuthorDisputePublicKeysByAuthor(
  authorPubkey: string,
  useCache = true
): Promise<string[]> {
  const disputes = await getAuthorDisputeAccountsByAuthor(
    authorPubkey,
    useCache
  );
  return disputes.map((dispute) => dispute.publicKey);
}

export async function listAuthorDisputeLinks(
  authorDisputePubkey: string,
  useCache = true
): Promise<string[]> {
  void useCache;
  const accounts = await rpc
    .getProgramAccounts(AGENTVOUCH_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [
        {
          memcmp: {
            offset: 0n,
            bytes: asBase64(AUTHOR_DISPUTE_VOUCH_LINK_DISCRIMINATOR),
            encoding: "base64",
          },
        },
        {
          memcmp: {
            offset: 8n,
            bytes: asBase58(authorDisputePubkey),
            encoding: "base58",
          },
        },
        {
          dataSize: BigInt(AUTHOR_DISPUTE_VOUCH_LINK_SIZE),
        },
      ],
    })
    .send();

  return accounts
    .map((account) => {
      const data = decodeBase64(account.account.data[0]);
      return addressDecoder.decode(data.subarray(40, 72));
    })
    .sort();
}

export async function listAuthorDisputesByAuthorViaFilter(
  authorPubkey: string
): Promise<DecodedAuthorDisputeAccount[]> {
  return loadAuthorDisputeAccountsByAuthor(authorPubkey);
}
