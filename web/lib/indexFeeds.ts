import { PUBLIC_ROUTE_CACHE_SECONDS } from "@/lib/cachePolicy";

type SkillIndexRow = {
  id: string;
  skill_id: string;
  author_pubkey: string;
  name: string;
  description: string | null;
  tags: string[];
  current_version: number;
  ipfs_cid: string | null;
  on_chain_address?: string | null;
  chain_context?: string | null;
  total_installs: number;
  total_downloads?: number | null;
  total_revenue?: number | null;
  price_lamports?: number | null;
  price_usdc_micros?: string | null;
  currency_mint?: string | null;
  payment_flow?:
    | "free"
    | "legacy-sol"
    | "x402-usdc"
    | "direct-purchase-skill";
  skill_uri?: string | null;
  source?: "repo" | "chain";
  created_at: string;
  updated_at?: string;
  author_trust: {
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
  } | null;
  author_trust_summary?: {
    wallet_pubkey: string;
    canonical_agent_id: string;
    chain_context: string;
    schema_version: string;
    trust_updated_at: string;
    recommended_action: string;
    reputationScore: number;
    totalVouchesReceived: number;
    totalStakedFor: number;
    disputesAgainstAuthor: number;
    disputesUpheldAgainstAuthor: number;
    activeDisputesAgainstAuthor: number;
    registeredAt: number;
    isRegistered: boolean;
  } | null;
  author_identity?: {
    canonicalAgentId?: string | null;
    displayName?: string | null;
  } | null;
};

type SkillsResponse = {
  skills: SkillIndexRow[];
  pagination: {
    page: number;
    totalPages: number;
  };
};

export async function fetchAllIndexedSkills(baseUrl: string) {
  const results: SkillIndexRow[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const response = await fetch(
      `${baseUrl}/api/skills?sort=trusted&page=${page}`,
      {
        next: { revalidate: PUBLIC_ROUTE_CACHE_SECONDS.skillsList },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch public skills index page ${page}`);
    }

    const body = (await response.json()) as SkillsResponse;
    results.push(...body.skills);
    totalPages = body.pagination.totalPages;
    page += 1;
  } while (page <= totalPages);

  return results;
}
