import { buildAgentTrustSummary } from "@/lib/agentDiscovery";
import {
  resolveManyAgentIdentitiesByWallet,
  type AgentIdentitySummary,
} from "@/lib/agentIdentity";
import { getConfiguredSolanaChainContext } from "@/lib/chains";
import { initializeDatabase, sql } from "@/lib/db";
import { resolveMultipleAuthorTrust, type AuthorTrust } from "@/lib/trust";

const configuredSolanaChainContext = getConfiguredSolanaChainContext();

/**
 * Upsert per-author trust snapshots so the marketplace and homepage can serve
 * trust from Postgres (the `author_trust_snapshots` LEFT JOIN) instead of
 * resolving it from on-chain accounts on the request hot path.
 */
export async function upsertAuthorTrustSnapshots(input: {
  trustMap: Map<string, AuthorTrust>;
  identityMap: Map<string, AgentIdentitySummary>;
}): Promise<void> {
  const entries = [...input.trustMap.entries()];
  if (entries.length === 0) return;

  await Promise.all(
    entries.map(([walletPubkey, trust]) => {
      const identity = input.identityMap.get(walletPubkey) ?? null;
      const summary = buildAgentTrustSummary({
        walletPubkey,
        trust,
        identity,
      });
      return sql()`
        INSERT INTO author_trust_snapshots (
          wallet_pubkey,
          chain_context,
          reputation_score,
          author_trust,
          author_trust_summary,
          refreshed_at
        )
        VALUES (
          ${walletPubkey},
          ${configuredSolanaChainContext},
          ${trust.reputationScore},
          ${JSON.stringify(trust)}::jsonb,
          ${JSON.stringify(summary)}::jsonb,
          NOW()
        )
        ON CONFLICT (wallet_pubkey, chain_context)
        DO UPDATE SET
          reputation_score = EXCLUDED.reputation_score,
          author_trust = EXCLUDED.author_trust,
          author_trust_summary = EXCLUDED.author_trust_summary,
          refreshed_at = NOW()
      `;
    })
  );
}

/**
 * Resolve trust + identity from on-chain data for every author that currently
 * has a repo skill, and persist the snapshots. This is the slow path and is
 * intended for the background refresh job.
 */
export async function refreshAllAuthorTrustSnapshots(): Promise<{
  authors: number;
}> {
  await initializeDatabase();
  const rows = await sql()<{ author_pubkey: string | null }>`
    SELECT DISTINCT author_pubkey
    FROM skills
    WHERE author_pubkey IS NOT NULL AND author_pubkey <> ''
  `;
  const authorPubkeys = rows
    .map((row) => row.author_pubkey)
    .filter((pubkey): pubkey is string => Boolean(pubkey));

  if (authorPubkeys.length === 0) {
    return { authors: 0 };
  }

  const trustMap = await resolveMultipleAuthorTrust(authorPubkeys);
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

  await upsertAuthorTrustSnapshots({ trustMap, identityMap });
  return { authors: trustMap.size };
}
