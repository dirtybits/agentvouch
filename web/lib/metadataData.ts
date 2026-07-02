import { sql } from "@/lib/db";
import { resolveAgentIdentityByWallet } from "@/lib/agentIdentity";
import { resolveAuthorTrust } from "@/lib/trust";
import { getAdapter } from "@/lib/adapters";
import { getConfiguredSolanaChainContext } from "@/lib/chains";
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
    // Phase 2 circle-back: cached-read metadata only needs SkillListingView fields, so this
    // goes through the chain adapter seam. Money paths keep explicit cache-bypass reads.
    const onChainAddr = id.slice(CHAIN_PREFIX.length);
    const listing = await getAdapter(
      configuredSolanaChainContext
    ).fetchSkillListing(onChainAddr);
    if (!listing) return null;

    const trust = await resolveAuthorTrust(listing.author);
    const identity = await resolveAgentIdentityByWallet(listing.author, {
      hasAgentProfile: trust.isRegistered,
    }).catch(() => null);
    const trustSummary = buildAgentTrustSummary({
      walletPubkey: listing.author,
      trust,
      identity,
    });

    return {
      id: `${CHAIN_PREFIX}${listing.listingId}`,
      name: listing.name,
      description:
        listing.description ||
        "View on-chain trust signals, stake-backed endorsements, and dispute history before installing this agent skill.",
      authorPubkey: listing.author,
      authorHandle: null,
      chainContext: configuredSolanaChainContext,
      priceUsdcMicros: String(listing.priceUsdcMicros),
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
