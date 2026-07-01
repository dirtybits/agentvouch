import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  parseAbi,
  type Address,
} from "viem";
import { BASE_SEPOLIA_CHAIN_CONTEXT } from "@/lib/chains";
import { AGENTVOUCH_EVM_READ_ABI } from "@/lib/adapters/agentVouchEvmAbi";
import {
  BASE_AGENTVOUCH_CONTRACT_ADDRESS,
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_RPC_URL,
} from "@/lib/adapters/baseConfig";
import type { AuthorTrust } from "@/lib/trust";

type BaseAgentProfile = {
  registered: boolean;
  metadataUri: string;
  reputationScore: bigint;
  totalVouchesReceived: bigint;
  totalVouchesGiven: bigint;
  totalVouchStakeReceivedUsdcMicros: bigint;
  authorBondUsdcMicros: bigint;
  activeFreeListingCount: bigint;
  openDisputes: bigint;
  upheldDisputes: bigint;
  dismissedDisputes: bigint;
  rewardIndexUsdcMicrosX1e12: bigint;
  unclaimedVoucherRevenueUsdcMicros: bigint;
  registeredAt: bigint;
};

const cache = new Map<string, { data: AuthorTrust; expires: number }>();
const CACHE_TTL_MS = 30_000;

function defaultTrust(): AuthorTrust {
  return {
    reputationScore: 0,
    totalVouchesReceived: 0,
    totalStakedFor: 0,
    authorBondUsdcMicros: 0,
    totalStakeAtRisk: 0,
    disputesAgainstAuthor: 0,
    disputesUpheldAgainstAuthor: 0,
    activeDisputesAgainstAuthor: 0,
    registeredAt: 0,
    isRegistered: false,
  };
}

function toSafeNumber(value: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  return Number(value > max ? max : value);
}

function profileToTrust(profile: BaseAgentProfile): AuthorTrust {
  if (!profile.registered) return defaultTrust();

  const totalStakedFor = toSafeNumber(
    profile.totalVouchStakeReceivedUsdcMicros
  );
  const authorBondUsdcMicros = toSafeNumber(profile.authorBondUsdcMicros);
  const activeDisputesAgainstAuthor = toSafeNumber(profile.openDisputes);
  const disputesUpheldAgainstAuthor = toSafeNumber(profile.upheldDisputes);
  const dismissedDisputes = toSafeNumber(profile.dismissedDisputes);

  return {
    reputationScore: toSafeNumber(profile.reputationScore),
    totalVouchesReceived: toSafeNumber(profile.totalVouchesReceived),
    totalStakedFor,
    authorBondUsdcMicros,
    totalStakeAtRisk: totalStakedFor + authorBondUsdcMicros,
    disputesAgainstAuthor:
      activeDisputesAgainstAuthor +
      disputesUpheldAgainstAuthor +
      dismissedDisputes,
    disputesUpheldAgainstAuthor,
    activeDisputesAgainstAuthor,
    registeredAt: toSafeNumber(profile.registeredAt),
    isRegistered: true,
  };
}

async function fetchBaseAgentProfile(
  authorAddress: Address
): Promise<BaseAgentProfile> {
  const publicClient = createPublicClient({
    transport: http(BASE_SEPOLIA_RPC_URL),
  });
  const chainId = await publicClient.getChainId();
  if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(
      `Base author profile reads require chain id ${BASE_SEPOLIA_CHAIN_ID}; RPC returned ${chainId}`
    );
  }

  return (await publicClient.readContract({
    address: getAddress(BASE_AGENTVOUCH_CONTRACT_ADDRESS),
    abi: parseAbi([...AGENTVOUCH_EVM_READ_ABI]),
    functionName: "getProfile",
    args: [authorAddress],
  })) as unknown as BaseAgentProfile;
}

export async function resolveBaseAuthorTrust(
  authorAddress: string,
  chainContext = BASE_SEPOLIA_CHAIN_CONTEXT
): Promise<AuthorTrust> {
  if (
    chainContext !== BASE_SEPOLIA_CHAIN_CONTEXT ||
    !isAddress(authorAddress)
  ) {
    return defaultTrust();
  }

  const normalizedAddress = getAddress(authorAddress);
  const cacheKey = `${chainContext}:${normalizedAddress}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > now) {
    return cached.data;
  }

  try {
    const trust = profileToTrust(
      await fetchBaseAgentProfile(normalizedAddress)
    );
    cache.set(cacheKey, { data: trust, expires: now + CACHE_TTL_MS });
    return trust;
  } catch {
    const fallback = defaultTrust();
    cache.set(cacheKey, { data: fallback, expires: now + CACHE_TTL_MS });
    return fallback;
  }
}
