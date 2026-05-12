import { sql } from "@/lib/db";
import { resolveAgentIdentityByWallet } from "@/lib/agentIdentity";
import { resolveAuthorTrust } from "@/lib/trust";
import { fetchOnChainSkillListing, getOnChainUsdcPrice } from "@/lib/onchain";
import {
  getConfiguredSolanaChainContext,
  normalizePersistedChainContext,
} from "@/lib/chains";
import { buildAgentTrustSummary } from "@/lib/agentDiscovery";
import { truncateDescription } from "@/lib/site";

const CHAIN_PREFIX = "chain-";
const configuredSolanaChainContext = getConfiguredSolanaChainContext();

type SkillRow = {
  id: string;
  author_pubkey: string;
  skill_id: string;
  name: string;
  description: string | null;
  chain_context: string | null;
  on_chain_address: string | null;
  price_usdc_micros?: string | null;
};

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
      chainContext: configuredSolanaChainContext,
      priceUsdcMicros: String(listing.data.priceUsdcMicros),
      trustSummary,
    };
  }

  const rows = await sql()<SkillRow>`
    SELECT id, author_pubkey, skill_id, name, description, chain_context, on_chain_address, price_usdc_micros
    FROM skills
    WHERE id = ${id}::uuid
    LIMIT 1
  `.catch(() => []);
  const skill = rows[0];
  if (!skill) return null;

  const trust = await resolveAuthorTrust(skill.author_pubkey);
  const identity = await resolveAgentIdentityByWallet(skill.author_pubkey, {
    hasAgentProfile: trust.isRegistered,
  }).catch(() => null);
  const trustSummary = buildAgentTrustSummary({
    walletPubkey: skill.author_pubkey,
    trust,
    identity,
  });

  let priceUsdcMicros = skill.price_usdc_micros ?? null;
  if (skill.on_chain_address) {
    const listing = await getOnChainUsdcPrice(skill.on_chain_address).catch(
      () => null
    );
    if (listing) priceUsdcMicros = listing.priceUsdcMicros;
  }

  return {
    id: skill.id,
    name: skill.name,
    description:
      skill.description ||
      "Inspect the author trust record, stake-backed vouches, and dispute history behind this AI agent skill.",
    authorPubkey: skill.author_pubkey,
    chainContext: normalizePersistedChainContext(skill.chain_context),
    priceUsdcMicros,
    trustSummary,
  };
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
