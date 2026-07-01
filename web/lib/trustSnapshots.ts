import {
  buildAgentTrustSummary,
  type AgentTrustSummary,
} from "@/lib/agentDiscovery";
import {
  resolveManyAgentIdentitiesByWallet,
  type AgentIdentitySummary,
} from "@/lib/agentIdentity";
import { getConfiguredSolanaChainContext } from "@/lib/chains";
import { initializeDatabase, sql } from "@/lib/db";
import {
  resolveMultipleAuthorTrust,
  type AgentProfileData,
  type AuthorTrust,
} from "@/lib/trust";

const configuredSolanaChainContext = getConfiguredSolanaChainContext();

type TrustSnapshotEntry = {
  walletPubkey: string;
  trust: AuthorTrust;
  summary: AgentTrustSummary;
};

async function upsertTrustSnapshotEntries(
  entries: TrustSnapshotEntry[]
): Promise<void> {
  if (entries.length === 0) return;

  const wallets: string[] = [];
  const scores: number[] = [];
  const trusts: string[] = [];
  const summaries: string[] = [];

  for (const entry of entries) {
    wallets.push(entry.walletPubkey);
    scores.push(entry.trust.reputationScore);
    trusts.push(JSON.stringify(entry.trust));
    summaries.push(JSON.stringify(entry.summary));
  }

  await sql()`
    INSERT INTO author_trust_snapshots (
      wallet_pubkey,
      chain_context,
      reputation_score,
      author_trust,
      author_trust_summary,
      refreshed_at
    )
    SELECT
      u.wallet_pubkey,
      ${configuredSolanaChainContext},
      u.reputation_score,
      u.author_trust::jsonb,
      u.author_trust_summary::jsonb,
      NOW()
    FROM UNNEST(
      ${wallets}::text[],
      ${scores}::int[],
      ${trusts}::text[],
      ${summaries}::text[]
    ) AS u(
      wallet_pubkey,
      reputation_score,
      author_trust,
      author_trust_summary
    )
    ON CONFLICT (wallet_pubkey, chain_context)
    DO UPDATE SET
      reputation_score = EXCLUDED.reputation_score,
      author_trust = EXCLUDED.author_trust,
      author_trust_summary = EXCLUDED.author_trust_summary,
      refreshed_at = NOW()
  `;
}

/**
 * Upsert per-author trust snapshots so the marketplace and homepage can serve
 * trust from Postgres (the `author_trust_snapshots` LEFT JOIN) instead of
 * resolving it from on-chain accounts on the request hot path.
 *
 * Uses a single multi-row `INSERT ... SELECT FROM UNNEST(...)` so a batch of
 * authors is one round-trip rather than N concurrent statements.
 */
export async function upsertAuthorTrustSnapshots(input: {
  trustMap: Map<string, AuthorTrust>;
  identityMap: Map<string, AgentIdentitySummary>;
}): Promise<void> {
  const entries = [...input.trustMap.entries()];
  if (entries.length === 0) return;

  await upsertTrustSnapshotEntries(
    entries.map(([walletPubkey, trust]) => ({
      walletPubkey,
      trust,
      summary: buildAgentTrustSummary({
        walletPubkey,
        trust,
        identity: input.identityMap.get(walletPubkey) ?? null,
      }),
    }))
  );
}

export async function upsertResolvedAuthorTrustSnapshot(input: {
  walletPubkey: string;
  trust: AuthorTrust;
  summary: AgentTrustSummary;
}): Promise<void> {
  await upsertTrustSnapshotEntries([input]);
}

/**
 * Resolve trust + identity from on-chain data for a set of authors. A
 * pre-fetched `agentProfilesByWallet` map (from a shared agent-profile scan)
 * lets the trust resolution skip its per-author profile fetches.
 */
export async function resolveTrustAndIdentity(
  authorPubkeys: string[],
  options?: {
    agentProfilesByWallet?: Map<string, AgentProfileData>;
  }
): Promise<{
  trustMap: Map<string, AuthorTrust>;
  identityMap: Map<string, AgentIdentitySummary>;
}> {
  if (authorPubkeys.length === 0) {
    return { trustMap: new Map(), identityMap: new Map() };
  }
  const trustMap = await resolveMultipleAuthorTrust(authorPubkeys, {
    agentProfilesByWallet: options?.agentProfilesByWallet,
  });
  let identityMap = new Map<string, AgentIdentitySummary>();
  try {
    identityMap = await resolveManyAgentIdentitiesByWallet(authorPubkeys, {
      hasAgentProfileByWallet: new Map(
        authorPubkeys.map((authorPubkey) => [
          authorPubkey,
          trustMap.get(authorPubkey)?.isRegistered ?? false,
        ])
      ),
    });
  } catch (error) {
    console.error(
      "Failed to resolve author identities for trust snapshot refresh:",
      error
    );
  }
  return { trustMap, identityMap };
}

/** Resolve trust for the given authors from on-chain data and persist snapshots. */
export async function refreshAuthorTrustSnapshotsFor(
  authorPubkeys: string[],
  options?: {
    agentProfilesByWallet?: Map<string, AgentProfileData>;
  }
): Promise<{ authors: number }> {
  if (authorPubkeys.length === 0) return { authors: 0 };
  const { trustMap, identityMap } = await resolveTrustAndIdentity(
    authorPubkeys,
    options
  );
  await upsertAuthorTrustSnapshots({ trustMap, identityMap });
  return { authors: trustMap.size };
}

/**
 * Resolve trust + identity from on-chain data for every author that currently
 * has a repo skill, and persist the snapshots. This is the slow path and is
 * intended for the background refresh job.
 */
export async function refreshAllAuthorTrustSnapshots(options?: {
  agentProfilesByWallet?: Map<string, AgentProfileData>;
}): Promise<{ authors: number }> {
  await initializeDatabase();
  const rows = await sql()<{ author_pubkey: string | null }>`
    SELECT DISTINCT author_pubkey
    FROM skills
    WHERE author_pubkey IS NOT NULL AND author_pubkey <> ''
  `;
  const authorPubkeys = rows
    .map((row) => row.author_pubkey)
    .filter((pubkey): pubkey is string => Boolean(pubkey));

  return refreshAuthorTrustSnapshotsFor(authorPubkeys, options);
}
