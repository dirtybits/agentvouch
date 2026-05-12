import {
  createSolanaRpc,
  getAddressEncoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
  type Address,
} from "@solana/kit";
import { fetchMaybeAgentProfile } from "../generated/agentvouch/src/generated";
import { AGENTVOUCH_PROGRAM_ADDRESS } from "../generated/agentvouch/src/generated/programs";
import {
  resolveAuthorDisputeMetrics,
  resolveMultipleAuthorDisputeMetrics,
  type AuthorDisputeMetrics,
} from "./authorDisputes";
import { IN_MEMORY_CACHE_TTL_MS } from "./cachePolicy";
import { getErrorMessage } from "./errors";
import { normalizeRegisteredAt } from "./registeredAt";
import { DEFAULT_SOLANA_RPC_URL } from "./solanaRpc";

const RPC_URL = DEFAULT_SOLANA_RPC_URL;
const rpc = createSolanaRpc(RPC_URL);

export interface AuthorTrust {
  reputationScore: number;
  totalVouchesReceived: number;
  totalStakedFor: number;
  authorBondLamports: number;
  totalStakeAtRisk: number;
  disputesAgainstAuthor: number;
  disputesUpheldAgainstAuthor: number;
  activeDisputesAgainstAuthor: number;
  registeredAt: number;
  isRegistered: boolean;
}

export class AuthorTrustVerificationError extends Error {
  constructor(message = "Unable to verify author trust") {
    super(message);
    this.name = "AuthorTrustVerificationError";
  }
}

const cache = new Map<string, { data: AuthorTrust; expires: number }>();
const CACHE_TTL_MS = IN_MEMORY_CACHE_TTL_MS.authorTrust;

const textEncoder = getUtf8Encoder();
const addressEncoder = getAddressEncoder();
type AgentProfileAccount = Awaited<ReturnType<typeof fetchMaybeAgentProfile>>;
type AgentProfileData = Extract<AgentProfileAccount, { exists: true }>["data"];

async function getAgentPDA(agentKey: Address): Promise<Address> {
  const [derived] = await getProgramDerivedAddress({
    programAddress: AGENTVOUCH_PROGRAM_ADDRESS,
    seeds: [textEncoder.encode("agent"), addressEncoder.encode(agentKey)],
  });
  return derived;
}

function getDefaultTrust(): AuthorTrust {
  return {
    reputationScore: 0,
    totalVouchesReceived: 0,
    totalStakedFor: 0,
    authorBondLamports: 0,
    totalStakeAtRisk: 0,
    disputesAgainstAuthor: 0,
    disputesUpheldAgainstAuthor: 0,
    activeDisputesAgainstAuthor: 0,
    registeredAt: 0,
    isRegistered: false,
  };
}

function mapAgentProfileTrust(profile: AgentProfileData): AuthorTrust {
  const totalStakedFor = Number(profile.totalVouchStakeUsdcMicros);
  const authorBondLamports = Number(profile.authorBondUsdcMicros);
  return {
    reputationScore: Number(profile.reputationScore),
    totalVouchesReceived: profile.totalVouchesReceived,
    totalStakedFor,
    authorBondLamports,
    totalStakeAtRisk: totalStakedFor + authorBondLamports,
    registeredAt: normalizeRegisteredAt(profile.registeredAt),
    isRegistered: true,
    disputesAgainstAuthor: 0,
    disputesUpheldAgainstAuthor: 0,
    activeDisputesAgainstAuthor: 0,
  };
}

function mergeAuthorTrust(
  base: AuthorTrust,
  disputeMetrics: AuthorDisputeMetrics
): AuthorTrust {
  return {
    ...base,
    disputesAgainstAuthor: disputeMetrics.disputesAgainstAuthor,
    disputesUpheldAgainstAuthor: disputeMetrics.disputesUpheldAgainstAuthor,
    activeDisputesAgainstAuthor: disputeMetrics.activeDisputesAgainstAuthor,
  };
}

export async function resolveAuthorTrust(pubkey: string): Promise<AuthorTrust> {
  const now = Date.now();
  const cached = cache.get(pubkey);
  if (cached && cached.expires > now) {
    return cached.data;
  }

  const defaultTrust = getDefaultTrust();

  try {
    const disputeMetrics = await resolveAuthorDisputeMetrics(pubkey);
    const agentPDA = await getAgentPDA(pubkey as Address);
    const account = await fetchMaybeAgentProfile(rpc, agentPDA);

    if (!account.exists) {
      const next = mergeAuthorTrust(defaultTrust, disputeMetrics);
      cache.set(pubkey, { data: next, expires: now + CACHE_TTL_MS });
      return next;
    }

    const d = account.data;
    const trust = mergeAuthorTrust(mapAgentProfileTrust(d), disputeMetrics);

    cache.set(pubkey, { data: trust, expires: now + CACHE_TTL_MS });
    return trust;
  } catch {
    cache.set(pubkey, { data: defaultTrust, expires: now + CACHE_TTL_MS });
    return defaultTrust;
  }
}

export async function verifyAuthorTrust(pubkey: string): Promise<AuthorTrust> {
  const defaultTrust = getDefaultTrust();

  try {
    const disputeMetrics = await resolveAuthorDisputeMetrics(pubkey, false);
    const agentPDA = await getAgentPDA(pubkey as Address);
    const account = await fetchMaybeAgentProfile(rpc, agentPDA);

    if (!account.exists) {
      return mergeAuthorTrust(defaultTrust, disputeMetrics);
    }

    const d = account.data;
    return mergeAuthorTrust(mapAgentProfileTrust(d), disputeMetrics);
  } catch (error: unknown) {
    throw new AuthorTrustVerificationError(
      getErrorMessage(error, "Unable to verify on-chain author profile")
    );
  }
}

export async function resolveMultipleAuthorTrust(
  pubkeys: string[]
): Promise<Map<string, AuthorTrust>> {
  const unique = [...new Set(pubkeys)];
  const disputeMetricsByAuthor = await resolveMultipleAuthorDisputeMetrics(
    unique
  );
  const results = await Promise.all(
    unique.map(async (pubkey) => {
      const disputeMetrics: AuthorDisputeMetrics = disputeMetricsByAuthor.get(
        pubkey
      ) ?? {
        disputesAgainstAuthor: 0,
        disputesUpheldAgainstAuthor: 0,
        activeDisputesAgainstAuthor: 0,
      };

      const now = Date.now();
      const cached = cache.get(pubkey);
      if (cached && cached.expires > now) {
        return mergeAuthorTrust(cached.data, disputeMetrics);
      }

      const agentPDA = await getAgentPDA(pubkey as Address);
      const account = await fetchMaybeAgentProfile(rpc, agentPDA);
      const trust = !account.exists
        ? mergeAuthorTrust(getDefaultTrust(), disputeMetrics)
        : mergeAuthorTrust(mapAgentProfileTrust(account.data), disputeMetrics);

      cache.set(pubkey, { data: trust, expires: now + CACHE_TTL_MS });
      return trust;
    })
  );
  const map = new Map<string, AuthorTrust>();
  unique.forEach((pk, i) => map.set(pk, results[i]));
  return map;
}
