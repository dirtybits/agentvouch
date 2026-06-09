import { sql } from "@/lib/db";
import { resolveAgentIdentityByWallet } from "@/lib/agentIdentity";
import { resolveAuthorTrust } from "@/lib/trust";
import { fetchOnChainSkillListing } from "@/lib/onchain";
import {
  getConfiguredSolanaChainContext,
} from "@/lib/chains";
import { buildAgentTrustSummary } from "@/lib/agentDiscovery";
import { truncateDescription } from "@/lib/site";
import { resolveSkillRouteParam } from "@/lib/skillRouteResolver";
import {
  buildSkillDetailSnapshotMetadata,
  loadSkillDetailSnapshot,
} from "@/lib/skillDetailSnapshot";

const CHAIN_PREFIX = "chain-";
const configuredSolanaChainContext = getConfiguredSolanaChainContext();

export async function getSkillMetadataSummary(id: string) {
  if (id.startsWith(CHAIN_PREFIX)) {
    const onChainAddr = id.slice(CHAIN_PREFIX.length);
    const listing = await fetchOnChainSkillListing(onChainAddr);
    if (!listing) return null;

    const trust = await resolveAuthorTrust(String(listing.data.author));
    const identity = await resolveAgentIdentityByWallet(
      String(listing.data.author),
      {
        hasAgentProfile: trust.isRegistered,
      }
    ).catch(() => null);
    const trustSummary = buildAgentTrustSummary({
      walletPubkey: String(listing.data.author),
      trust,
      identity,
    });

    return {
      id: `${CHAIN_PREFIX}${listing.publicKey}`,
      name: listing.data.name,
      description:
        listing.data.description ||
        "View on-chain trust signals, stake-backed endorsements, and dispute history before installing this agent skill.",
      authorPubkey: String(listing.data.author),
      authorHandle: null,
      chainContext: configuredSolanaChainContext,
      priceUsdcMicros: String(listing.data.priceUsdcMicros),
      trustSummary,
    };
  }

  const route = await resolveSkillRouteParam(id).catch(() => null);
  if (!route || route.id.startsWith(CHAIN_PREFIX)) return null;

  const snapshot = await loadSkillDetailSnapshot(route.id).catch(() => null);
  return snapshot ? buildSkillDetailSnapshotMetadata(snapshot) : null;
}

export async function getAuthorMetadataSummary(pubkey: string) {
  const trust = await resolveAuthorTrust(pubkey);
  const identity = await resolveAgentIdentityByWallet(pubkey, {
    hasAgentProfile: trust.isRegistered,
  }).catch(() => null);
  const trustSummary = buildAgentTrustSummary({
    walletPubkey: pubkey,
    trust,
    identity,
  });

  const rows = await sql()<{
    published_skills: number;
  }>`
    SELECT COUNT(*)::int AS published_skills
    FROM skills
    WHERE author_pubkey = ${pubkey}
  `.catch(() => []);

  const publishedSkills = rows[0]?.published_skills ?? 0;
  const displayName = identity?.displayName || pubkey;
  const description = truncateDescription(
    `${displayName} has ${trust.totalVouchesReceived} vouches, ${trust.activeDisputesAgainstAuthor} active disputes, and ${publishedSkills} published skills on AgentVouch.`
  );

  return {
    pubkey,
    displayName,
    description,
    trustSummary,
    publishedSkills,
  };
}
