import { createSolanaRpc } from "@solana/kit";
import type { Base64EncodedBytes } from "@solana/rpc-types";
import {
  getAgentProfileDecoder,
  AGENT_PROFILE_DISCRIMINATOR,
} from "../generated/agentvouch/src/generated";
import { AGENTVOUCH_PROGRAM_ADDRESS } from "../generated/agentvouch/src/generated/programs";
import { resolveManyAgentIdentitiesByWallet } from "@/lib/agentIdentity";
import { getConfiguredSolanaChainContext } from "@/lib/chains";
import { initializeDatabase, sql } from "@/lib/db";
import { listOnChainSkillListings } from "@/lib/onchain";
import { DEFAULT_SOLANA_RPC_URL } from "@/lib/solanaRpc";
import type { AgentProfileData } from "@/lib/trust";

const rpc = createSolanaRpc(DEFAULT_SOLANA_RPC_URL);
const asBase64 = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("base64") as Base64EncodedBytes;

export type LandingMetrics = {
  agents: number;
  authors: number;
  skills: number;
  revenue: number;
  staked: number;
  onChainDownloads: number;
  downloads: number;
};

export type LandingPayload = {
  metrics: LandingMetrics;
};

/**
 * A single `getProgramAccounts` scan of all AgentProfile accounts, shared
 * between the metrics aggregation and the per-author trust refresh so the cron
 * does not scan the same accounts twice.
 */
export type AgentProfileScan = {
  /** Number of AgentProfile accounts (one per registered agent). */
  count: number;
  /** Total vouch stake across all agents, in USDC micros (overflow-clamped). */
  totalStakedUsdcMicros: number;
  /** Decoded profile keyed by the agent's authority wallet. */
  byAuthority: Map<string, AgentProfileData>;
};

function toSafeMetricNumber(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return 0;
  }
  return Number(value);
}

export function toSafeMetricNumberFromUnknown(value: unknown): number {
  if (typeof value === "bigint") {
    return toSafeMetricNumber(value);
  }
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return toSafeMetricNumber(BigInt(value));
  }
  return 0;
}

async function getRepoInstallCount(): Promise<number> {
  try {
    await initializeDatabase();
    const rows = await sql()<{
      total_installs: string | number | bigint | null;
    }>`
      SELECT COALESCE(SUM(total_installs), 0)::bigint AS total_installs
      FROM skills
    `;
    return toSafeMetricNumberFromUnknown(rows[0]?.total_installs ?? 0);
  } catch (error) {
    console.error(
      "Failed to load repo install count for platform metrics:",
      error
    );
    return 0;
  }
}

/**
 * Scan every AgentProfile account once. The decoded profiles are reused by both
 * the metrics aggregation and the trust-snapshot refresh.
 */
export async function scanAgentProfiles(): Promise<AgentProfileScan> {
  const accounts = await rpc
    .getProgramAccounts(AGENTVOUCH_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [
        {
          memcmp: {
            offset: 0n,
            bytes: asBase64(AGENT_PROFILE_DISCRIMINATOR),
            encoding: "base64",
          },
        },
      ],
    })
    .send();

  const decoder = getAgentProfileDecoder();
  const byAuthority = new Map<string, AgentProfileData>();
  let totalStakedUsdcMicros = 0;

  for (const account of accounts) {
    const data = decoder.decode(
      new Uint8Array(Buffer.from(account.account.data[0], "base64"))
    ) as AgentProfileData;
    byAuthority.set(String(data.authority), data);
    totalStakedUsdcMicros += toSafeMetricNumber(
      BigInt(data.totalVouchStakeUsdcMicros)
    );
  }

  return {
    count: accounts.length,
    totalStakedUsdcMicros,
    byAuthority,
  };
}

/**
 * Compute the homepage platform metrics directly from on-chain program
 * accounts. This is the slow path (two getProgramAccounts scans plus identity
 * resolution) and is intended to run in the background refresh job, not on the
 * request hot path. An already-fetched {@link AgentProfileScan} may be injected
 * to share the agent scan with the trust refresh.
 */
export async function computeLandingPayloadFromChain(opts?: {
  agentScan?: AgentProfileScan;
}): Promise<LandingPayload> {
  const [skillAccounts, agentScan, repoInstalls] = await Promise.all([
    listOnChainSkillListings(),
    opts?.agentScan ? Promise.resolve(opts.agentScan) : scanAgentProfiles(),
    getRepoInstallCount(),
  ]);

  const skills = skillAccounts.map(({ data }) => ({
    author: data.author,
    totalDownloads: toSafeMetricNumber(data.totalDownloads),
    totalRevenueUsdcMicros: toSafeMetricNumber(data.totalRevenueUsdcMicros),
  }));

  const authorPubkeys = [...new Set(skills.map((s) => s.author))];
  const registeredWallets = agentScan.byAuthority;
  let identityMap = new Map();
  try {
    identityMap = await resolveManyAgentIdentitiesByWallet(authorPubkeys, {
      hasAgentProfileByWallet: new Map(
        authorPubkeys.map((authorPubkey) => [
          authorPubkey,
          registeredWallets.has(authorPubkey),
        ])
      ),
    });
  } catch (error) {
    console.error(
      "Failed to resolve author identities for platform metrics:",
      error
    );
  }

  const authorSet = new Set(
    authorPubkeys.map(
      (authorPubkey) =>
        identityMap.get(authorPubkey)?.canonicalAgentId ?? authorPubkey
    )
  );
  const totalRevenue = skills.reduce(
    (sum, s) => sum + s.totalRevenueUsdcMicros,
    0
  );
  const onChainDownloads = skills.reduce((sum, s) => sum + s.totalDownloads, 0);

  return {
    metrics: {
      agents: agentScan.count,
      authors: authorSet.size,
      skills: skills.length,
      revenue: totalRevenue,
      staked: agentScan.totalStakedUsdcMicros,
      onChainDownloads,
      downloads: onChainDownloads + repoInstalls,
    },
  };
}

export async function readPlatformMetricsSnapshot(
  chainContext = getConfiguredSolanaChainContext()
): Promise<{ metrics: LandingMetrics; refreshedAt: string } | null> {
  await initializeDatabase();
  const rows = await sql()<{
    agents: string | number | bigint | null;
    authors: string | number | bigint | null;
    skills: string | number | bigint | null;
    revenue_usdc_micros: string | number | bigint | null;
    staked_usdc_micros: string | number | bigint | null;
    on_chain_downloads: string | number | bigint | null;
    downloads: string | number | bigint | null;
    refreshed_at: string;
  }>`
    SELECT
      agents,
      authors,
      skills,
      revenue_usdc_micros,
      staked_usdc_micros,
      on_chain_downloads,
      downloads,
      refreshed_at::text AS refreshed_at
    FROM platform_metrics_snapshot
    WHERE chain_context = ${chainContext}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;

  return {
    metrics: {
      agents: toSafeMetricNumberFromUnknown(row.agents),
      authors: toSafeMetricNumberFromUnknown(row.authors),
      skills: toSafeMetricNumberFromUnknown(row.skills),
      revenue: toSafeMetricNumberFromUnknown(row.revenue_usdc_micros),
      staked: toSafeMetricNumberFromUnknown(row.staked_usdc_micros),
      onChainDownloads: toSafeMetricNumberFromUnknown(row.on_chain_downloads),
      downloads: toSafeMetricNumberFromUnknown(row.downloads),
    },
    refreshedAt: row.refreshed_at,
  };
}

export async function writePlatformMetricsSnapshot(
  metrics: LandingMetrics,
  chainContext = getConfiguredSolanaChainContext()
): Promise<void> {
  await initializeDatabase();
  await sql()`
    INSERT INTO platform_metrics_snapshot (
      chain_context,
      agents,
      authors,
      skills,
      revenue_usdc_micros,
      staked_usdc_micros,
      on_chain_downloads,
      downloads,
      refreshed_at
    )
    VALUES (
      ${chainContext},
      ${metrics.agents},
      ${metrics.authors},
      ${metrics.skills},
      ${metrics.revenue},
      ${metrics.staked},
      ${metrics.onChainDownloads},
      ${metrics.downloads},
      NOW()
    )
    ON CONFLICT (chain_context)
    DO UPDATE SET
      agents = EXCLUDED.agents,
      authors = EXCLUDED.authors,
      skills = EXCLUDED.skills,
      revenue_usdc_micros = EXCLUDED.revenue_usdc_micros,
      staked_usdc_micros = EXCLUDED.staked_usdc_micros,
      on_chain_downloads = EXCLUDED.on_chain_downloads,
      downloads = EXCLUDED.downloads,
      refreshed_at = NOW()
  `;
}

/** Recompute platform metrics from on-chain data and persist the snapshot. */
export async function refreshPlatformMetricsSnapshot(opts?: {
  agentScan?: AgentProfileScan;
}): Promise<LandingPayload> {
  const payload = await computeLandingPayloadFromChain(opts);
  await writePlatformMetricsSnapshot(payload.metrics);
  return payload;
}
