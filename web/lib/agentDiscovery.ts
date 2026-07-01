import type { AgentIdentitySummary } from "@/lib/agentIdentity";
import type { AuthorTrust } from "@/lib/trust";
import { getConfiguredSolanaChainContext } from "@/lib/chains";
import { buildLocalCanonicalAgentId } from "@/lib/agentIdentity";

export const AGENT_DISCOVERY_SCHEMA_VERSION = "2026-04-03";

export type RecommendedAction = "allow" | "review" | "avoid";

export interface AgentTrustSummary {
  wallet_pubkey: string;
  canonical_agent_id: string;
  username: string | null;
  display_name: string | null;
  github_login: string | null;
  github_url: string | null;
  chain_context: string;
  schema_version: string;
  trust_updated_at: string;
  recommended_action: RecommendedAction;
  reputationScore: number;
  totalVouchesReceived: number;
  totalStakedFor: number;
  disputesAgainstAuthor: number;
  disputesUpheldAgainstAuthor: number;
  activeDisputesAgainstAuthor: number;
  registeredAt: number;
  isRegistered: boolean;
}

export function getRecommendedAction(
  trust: Pick<
    AuthorTrust,
    | "isRegistered"
    | "activeDisputesAgainstAuthor"
    | "disputesUpheldAgainstAuthor"
    | "totalStakedFor"
  >
): RecommendedAction {
  if (!trust.isRegistered || trust.disputesUpheldAgainstAuthor > 0) {
    return "avoid";
  }

  if (trust.activeDisputesAgainstAuthor > 0 || trust.totalStakedFor <= 0) {
    return "review";
  }

  return "allow";
}

export function buildAgentTrustSummary(params: {
  walletPubkey: string;
  trust: AuthorTrust;
  identity?: AgentIdentitySummary | null;
  trustUpdatedAt?: string;
}): AgentTrustSummary {
  const chainContext =
    params.identity?.homeChainContext || getConfiguredSolanaChainContext();

  return {
    wallet_pubkey: params.walletPubkey,
    canonical_agent_id:
      params.identity?.canonicalAgentId ||
      buildLocalCanonicalAgentId(params.walletPubkey, chainContext),
    username: params.identity?.username ?? null,
    display_name: params.identity?.displayName ?? null,
    github_login: params.identity?.githubProfile?.login ?? null,
    github_url: params.identity?.githubProfile?.url ?? null,
    chain_context: chainContext,
    schema_version: AGENT_DISCOVERY_SCHEMA_VERSION,
    trust_updated_at: params.trustUpdatedAt || new Date().toISOString(),
    recommended_action: getRecommendedAction(params.trust),
    reputationScore: params.trust.reputationScore,
    totalVouchesReceived: params.trust.totalVouchesReceived,
    totalStakedFor: params.trust.totalStakedFor,
    disputesAgainstAuthor: params.trust.disputesAgainstAuthor,
    disputesUpheldAgainstAuthor: params.trust.disputesUpheldAgainstAuthor,
    activeDisputesAgainstAuthor: params.trust.activeDisputesAgainstAuthor,
    registeredAt: params.trust.registeredAt,
    isRegistered: params.trust.isRegistered,
  };
}
