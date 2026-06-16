import { initializeDatabase, sql } from "@/lib/db";
import { SCAN_MODEL } from "@/lib/ai/gateway";
import { SCAN_RUBRIC_VERSION } from "@/lib/ai/scan";
import {
  buildAgentTrustSummary,
  type AgentTrustSummary,
} from "@/lib/agentDiscovery";
import type { AgentIdentitySummary } from "@/lib/agentIdentity";
import { getCachedTrust, getCachedTrustSummary } from "@/lib/authorTrustView";
import {
  getConfiguredSolanaChainContext,
  normalizePersistedChainContext,
} from "@/lib/chains";
import { getErrorMessage } from "@/lib/errors";
import {
  getSkillPaymentFlow,
  normalizeUsdcMicros,
} from "@/lib/listingContract";
import {
  buildSecurityScanFromFields,
  type SkillScanFieldRow,
  type SkillSecurityScan,
} from "@/lib/securityScan";
import type { AuthorTrust } from "@/lib/trust";
import { buildTrustSignals, type TrustSignal } from "@/lib/trustSignals";

// Shared marketplace browse pipeline. This is the /api/skills fast path
// (Postgres-only, cached trust snapshots, no chain RPC), extracted so the
// /skills server page can render the default browse view with the exact same
// query, enrichment, and ordering as the API the client falls back to.

const configuredSolanaChainContext = getConfiguredSolanaChainContext();

// Default browse page size, shared by the server snapshot and the client grid.
export const MARKETPLACE_PAGE_SIZE = 9;

export type SkillPaymentFlow =
  | "free"
  | "legacy-sol"
  | "listing-required"
  | "x402-usdc"
  | "direct-purchase-skill";

export type RepoSkillRow = SkillScanFieldRow & {
  id: string;
  skill_id: string;
  public_slug: string;
  public_author_slug: string;
  author_pubkey: string | null;
  author_kind?: "wallet" | "github" | "api_token" | "unknown" | string;
  author_external_id?: string | null;
  author_handle?: string | null;
  author_display_name?: string | null;
  publisher_identity_key?: string | null;
  publisher_tier?: "unverified" | "registered" | "bonded" | string;
  name: string;
  description: string | null;
  tags: string[];
  current_version: number;
  ipfs_cid: string | null;
  on_chain_address: string | null;
  skill_uri?: string | null;
  chain_context: string | null;
  total_installs: number;
  total_downloads?: number | null;
  total_revenue?: number | null;
  price_lamports?: number | null;
  price_usdc_micros?: string | null;
  currency_mint?: string | null;
  on_chain_protocol_version?: string | null;
  on_chain_program_id?: string | null;
  contact?: string | null;
  summary?: string | null;
  summary_model?: string | null;
  summary_sha256?: string | null;
  files?: unknown;
  tree_hash?: string | null;
  has_executable?: boolean | null;
  security_scan?: SkillSecurityScan | null;
  search_rank?: number | string | null;
  cached_author_trust?: AuthorTrust | string | null;
  cached_author_trust_summary?: AgentTrustSummary | string | null;
  cached_reputation_score?: number | string | null;
  cached_trust_refreshed_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type ChainSkillRow = Omit<
  RepoSkillRow,
  | "on_chain_address"
  | "chain_context"
  | "total_downloads"
  | "total_revenue"
  | "price_lamports"
  | "skill_uri"
> & {
  on_chain_address: string;
  chain_context: string;
  total_downloads: number;
  total_revenue: number;
  price_lamports: null;
  price_usdc_micros: string;
  currency_mint: string | null;
  on_chain_protocol_version: string;
  on_chain_program_id: string;
  skill_uri: string | null;
  source: "chain";
};

export type RepoMergedSkillRow = RepoSkillRow & { source: "repo" };
export type MergedSkillRow = RepoMergedSkillRow | ChainSkillRow;
export type EnrichedSkillRow = Omit<
  MergedSkillRow,
  | "cached_author_trust"
  | "cached_author_trust_summary"
  | "cached_reputation_score"
  | "cached_trust_refreshed_at"
> & {
  price_usdc_micros: string | null;
  payment_flow: SkillPaymentFlow;
  author_trust: AuthorTrust | null;
  author_trust_summary: AgentTrustSummary | null;
  author_identity: AgentIdentitySummary | null;
  signals: TrustSignal[];
};

export type RouteTiming = {
  measure<T>(name: string, fn: () => Promise<T>): Promise<T>;
  header(): string;
};

export function createRouteTiming(): RouteTiming {
  const entries: { name: string; durationMs: number }[] = [];
  return {
    async measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
      const startedAt = Date.now();
      try {
        return await fn();
      } finally {
        entries.push({ name, durationMs: Date.now() - startedAt });
      }
    },
    header() {
      return entries
        .map(
          ({ name, durationMs }) =>
            `${name};dur=${Math.max(0, durationMs).toFixed(1)}`
        )
        .join(", ");
    },
  };
}

export function stripCachedSkillFields(skill: MergedSkillRow): MergedSkillRow {
  if (skill.source !== "repo") return skill;
  const publicSkill = { ...skill };
  delete publicSkill.cached_author_trust;
  delete publicSkill.cached_author_trust_summary;
  delete publicSkill.cached_reputation_score;
  delete publicSkill.cached_trust_refreshed_at;
  delete publicSkill.scan_verdict;
  delete publicSkill.scan_risk;
  delete publicSkill.scan_findings;
  delete publicSkill.scan_truncated;
  delete publicSkill.scan_scanned_at;
  delete publicSkill.scan_model;
  delete publicSkill.scan_rubric_version;
  delete publicSkill.scan_source;
  delete publicSkill.scan_generated_by_model;
  return publicSkill;
}

export function mergeSkills(
  pgSkills: RepoMergedSkillRow[],
  chainSkills: ChainSkillRow[]
): MergedSkillRow[] {
  const merged: MergedSkillRow[] = [...pgSkills];

  for (const chain of chainSkills) {
    // Only merge into a PG skill if the on_chain_address already recorded there matches.
    // Two separate on-chain listings (different pubkeys) are always kept as separate cards.
    const existing = merged.find(
      (s) =>
        s.source === "repo" && s.on_chain_address === chain.on_chain_address
    );
    if (existing) {
      existing.price_usdc_micros ??= chain.price_usdc_micros;
      existing.total_downloads = chain.total_downloads;
      existing.total_revenue = chain.total_revenue;
      existing.skill_uri = chain.skill_uri;
      existing.on_chain_protocol_version ??= chain.on_chain_protocol_version;
      existing.on_chain_program_id ??= chain.on_chain_program_id;
      existing.currency_mint ??= chain.currency_mint;
    } else {
      merged.push(chain);
    }
  }

  return merged;
}

export async function loadRepoSkillRows(input: {
  q?: string | null;
  author?: string | null;
  tags?: string | null;
  ids?: string[];
  timing?: RouteTiming;
}): Promise<RepoSkillRow[]> {
  const load = async () => {
    const skillIds = input.ids ?? [];
    if (skillIds.length > 0) {
      return sql()<RepoSkillRow & Record<string, unknown>>`
        SELECT
          s.*,
          latest.tree_hash,
          latest.has_executable,
          scan.verdict AS scan_verdict,
          scan.risk AS scan_risk,
          scan.findings AS scan_findings,
          scan.truncated AS scan_truncated,
          scan.scanned_at AS scan_scanned_at,
          scan.model AS scan_model,
          scan.rubric_version AS scan_rubric_version,
          scan.scan_source AS scan_source,
          scan.generated_by_model AS scan_generated_by_model,
          ats.author_trust AS cached_author_trust,
          ats.author_trust_summary AS cached_author_trust_summary,
          ats.reputation_score AS cached_reputation_score,
          ats.refreshed_at AS cached_trust_refreshed_at
        FROM skills s
        LEFT JOIN LATERAL (
          SELECT tree_hash, has_executable
          FROM skill_versions
          WHERE skill_id = s.id
          ORDER BY version DESC
          LIMIT 1
        ) latest ON true
        LEFT JOIN skill_scans scan
          ON scan.tree_hash = latest.tree_hash
          AND scan.rubric_version = ${SCAN_RUBRIC_VERSION}
          AND scan.model = ${SCAN_MODEL}
        LEFT JOIN author_trust_snapshots ats
          ON ats.wallet_pubkey = s.author_pubkey
          AND ats.chain_context = ${configuredSolanaChainContext}
        WHERE s.id = ANY(${skillIds}::uuid[])
      `;
    }

    const query = input.q?.trim();
    if (query) {
      return sql()<RepoSkillRow & Record<string, unknown>>`
        WITH search AS (
          SELECT
            websearch_to_tsquery('english', ${query}) AS query,
            lower(${query}) AS raw_query
        )
        SELECT
          s.*,
          latest.tree_hash,
          latest.has_executable,
          scan.verdict AS scan_verdict,
          scan.risk AS scan_risk,
          scan.findings AS scan_findings,
          scan.truncated AS scan_truncated,
          scan.scanned_at AS scan_scanned_at,
          scan.model AS scan_model,
          scan.rubric_version AS scan_rubric_version,
          scan.scan_source AS scan_source,
          scan.generated_by_model AS scan_generated_by_model,
          ats.author_trust AS cached_author_trust,
          ats.author_trust_summary AS cached_author_trust_summary,
          ats.reputation_score AS cached_reputation_score,
          ats.refreshed_at AS cached_trust_refreshed_at,
          (
            CASE
              WHEN numnode(search.query) > 0 THEN ts_rank_cd(
                agentvouch_skill_search_tsvector(
                  s.name,
                  s.skill_id,
                  s.public_slug,
                  s.tags,
                  s.description,
                  s.author_handle,
                  s.author_display_name,
                  author_agent.username,
                  github_binding.metadata->>'login'
                ),
                search.query
              )
              ELSE 0
            END
            +
            GREATEST(
              similarity(
                agentvouch_skill_search_text(
                  s.name,
                  s.skill_id,
                  s.public_slug,
                  s.tags,
                  s.description,
                  s.author_handle,
                  s.author_display_name,
                  author_agent.username,
                  github_binding.metadata->>'login'
                ),
                search.raw_query
              ),
              word_similarity(
                search.raw_query,
                agentvouch_skill_search_text(
                  s.name,
                  s.skill_id,
                  s.public_slug,
                  s.tags,
                  s.description,
                  s.author_handle,
                  s.author_display_name,
                  author_agent.username,
                  github_binding.metadata->>'login'
                )
              ),
              CASE
                WHEN agentvouch_skill_search_text(
                  s.name,
                  s.skill_id,
                  s.public_slug,
                  s.tags,
                  s.description,
                  s.author_handle,
                  s.author_display_name,
                  author_agent.username,
                  github_binding.metadata->>'login'
                ) LIKE '%' || search.raw_query || '%' THEN 0.15
                ELSE 0
              END
            )
          ) AS search_rank
        FROM skills s
        CROSS JOIN search
        LEFT JOIN LATERAL (
          SELECT tree_hash, has_executable
          FROM skill_versions
          WHERE skill_id = s.id
          ORDER BY version DESC
          LIMIT 1
        ) latest ON true
        LEFT JOIN skill_scans scan
          ON scan.tree_hash = latest.tree_hash
          AND scan.rubric_version = ${SCAN_RUBRIC_VERSION}
          AND scan.model = ${SCAN_MODEL}
        LEFT JOIN author_trust_snapshots ats
          ON ats.wallet_pubkey = s.author_pubkey
          AND ats.chain_context = ${configuredSolanaChainContext}
        LEFT JOIN agent_identity_bindings owner_binding
          ON owner_binding.binding_type = 'wallet_owner'
          AND owner_binding.binding_ref = s.author_pubkey
          AND owner_binding.chain_context = ${configuredSolanaChainContext}
        LEFT JOIN agents author_agent
          ON author_agent.id = owner_binding.agent_id
        LEFT JOIN LATERAL (
          SELECT metadata
          FROM agent_identity_bindings
          WHERE agent_id = author_agent.id
            AND binding_type = 'github_profile'
          ORDER BY created_at DESC
          LIMIT 1
        ) github_binding ON true
        WHERE (
          (
            numnode(search.query) > 0 AND
            agentvouch_skill_search_tsvector(
              s.name,
              s.skill_id,
              s.public_slug,
              s.tags,
              s.description,
              s.author_handle,
              s.author_display_name,
              author_agent.username,
              github_binding.metadata->>'login'
            ) @@ search.query
          )
          OR agentvouch_skill_search_text(
            s.name,
            s.skill_id,
            s.public_slug,
            s.tags,
            s.description,
            s.author_handle,
            s.author_display_name,
            author_agent.username,
            github_binding.metadata->>'login'
          ) LIKE '%' || search.raw_query || '%'
          OR agentvouch_skill_search_text(
            s.name,
            s.skill_id,
            s.public_slug,
            s.tags,
            s.description,
            s.author_handle,
            s.author_display_name,
            author_agent.username,
            github_binding.metadata->>'login'
          ) % search.raw_query
          OR word_similarity(
            search.raw_query,
            agentvouch_skill_search_text(
              s.name,
              s.skill_id,
              s.public_slug,
              s.tags,
              s.description,
              s.author_handle,
              s.author_display_name,
              author_agent.username,
              github_binding.metadata->>'login'
            )
          ) >= 0.6
        )
        ${input.author ? sql()`AND s.author_pubkey = ${input.author}` : sql()``}
        ${
          input.tags
            ? sql()`AND s.tags && ${input.tags
                .split(",")
                .filter(Boolean)}::text[]`
            : sql()``
        }
      `;
    }

    return sql()<RepoSkillRow & Record<string, unknown>>`
      SELECT
        s.*,
        latest.tree_hash,
        latest.has_executable,
        scan.verdict AS scan_verdict,
        scan.risk AS scan_risk,
        scan.findings AS scan_findings,
        scan.truncated AS scan_truncated,
        scan.scanned_at AS scan_scanned_at,
        scan.model AS scan_model,
        scan.rubric_version AS scan_rubric_version,
        scan.scan_source AS scan_source,
        scan.generated_by_model AS scan_generated_by_model,
        ats.author_trust AS cached_author_trust,
        ats.author_trust_summary AS cached_author_trust_summary,
        ats.reputation_score AS cached_reputation_score,
        ats.refreshed_at AS cached_trust_refreshed_at
      FROM skills s
      LEFT JOIN LATERAL (
        SELECT tree_hash, has_executable
        FROM skill_versions
        WHERE skill_id = s.id
        ORDER BY version DESC
        LIMIT 1
      ) latest ON true
      LEFT JOIN skill_scans scan
        ON scan.tree_hash = latest.tree_hash
        AND scan.rubric_version = ${SCAN_RUBRIC_VERSION}
        AND scan.model = ${SCAN_MODEL}
      LEFT JOIN author_trust_snapshots ats
        ON ats.wallet_pubkey = s.author_pubkey
        AND ats.chain_context = ${configuredSolanaChainContext}
      WHERE 1=1
      ${input.author ? sql()`AND s.author_pubkey = ${input.author}` : sql()``}
      ${
        input.tags
          ? sql()`AND s.tags && ${input.tags
              .split(",")
              .filter(Boolean)}::text[]`
          : sql()``
      }
    `;
  };

  if (input.timing) {
    return input.timing.measure("db", load);
  }
  return load();
}

export function normalizeRepoSkillRows(
  pgSkills: RepoSkillRow[]
): RepoMergedSkillRow[] {
  return pgSkills.map((skill) => ({
    ...skill,
    security_scan: buildSecurityScanFromFields(skill),
    chain_context: normalizePersistedChainContext(skill.chain_context),
    source: "repo",
  }));
}

export function buildEnrichedSkillRows(input: {
  skills: MergedSkillRow[];
  trustMap?: Map<string, AuthorTrust>;
  identityMap?: Map<string, AgentIdentitySummary>;
  useCachedTrust?: boolean;
}): EnrichedSkillRow[] {
  const trustMap = input.trustMap ?? new Map();
  const identityMap = input.identityMap ?? new Map();

  return input.skills.map((skill) => {
    const authorTrust =
      (skill.author_pubkey
        ? trustMap.get(skill.author_pubkey) || null
        : null) ?? (input.useCachedTrust ? getCachedTrust(skill) : null);
    const authorIdentity = skill.author_pubkey
      ? identityMap.get(skill.author_pubkey) || null
      : null;
    const authorTrustSummary =
      skill.author_pubkey && trustMap.has(skill.author_pubkey) && authorTrust
        ? buildAgentTrustSummary({
            walletPubkey: skill.author_pubkey,
            trust: authorTrust,
            identity: authorIdentity,
          })
        : input.useCachedTrust
        ? getCachedTrustSummary(skill)
        : null;
    const priceUsdcMicros = normalizeUsdcMicros(skill.price_usdc_micros);

    return {
      ...stripCachedSkillFields(skill),
      price_usdc_micros: priceUsdcMicros,
      payment_flow: getSkillPaymentFlow({
        priceUsdcMicros,
        onChainAddress: skill.on_chain_address,
        legacySolLamports: skill.price_lamports,
        allowLegacySol: true,
      }),
      author_trust: authorTrust,
      author_trust_summary: authorTrustSummary,
      author_identity: authorIdentity,
      signals: buildTrustSignals({
        trust: authorTrust,
        scan: skill.security_scan ?? null,
      }),
    };
  });
}

function compareEnrichedSkillsBySort(
  a: EnrichedSkillRow,
  b: EnrichedSkillRow,
  sort: string
) {
  if (sort === "trusted") {
    return (
      (b.author_trust?.reputationScore ?? 0) -
        (a.author_trust?.reputationScore ?? 0) ||
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }
  if (sort === "installs") {
    return (
      b.total_installs +
      (b.total_downloads ?? 0) -
      (a.total_installs + (a.total_downloads ?? 0))
    );
  }
  if (sort === "name") {
    return a.name.localeCompare(b.name);
  }
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

export function sortEnrichedSkills(
  skills: EnrichedSkillRow[],
  sort: string,
  options?: { hasSearchQuery?: boolean }
) {
  skills.sort((a, b) => {
    if (options?.hasSearchQuery) {
      const rankDelta = Number(b.search_rank ?? 0) - Number(a.search_rank ?? 0);
      if (rankDelta !== 0) return rankDelta;
    }
    return compareEnrichedSkillsBySort(a, b, sort);
  });
}

export type MarketplaceBrowseSnapshot = {
  skills: EnrichedSkillRow[];
  total: number;
};

/**
 * Server-render seed for the default /skills browse view (page 1, trusted
 * sort, no filters) — the same fast path the API serves with mode=fast.
 * Returns null on any failure so the page falls back to client fetching.
 */
export async function loadMarketplaceBrowseSnapshot(input: {
  pageSize: number;
}): Promise<MarketplaceBrowseSnapshot | null> {
  try {
    await initializeDatabase();
    const rows = await loadRepoSkillRows({});
    const enriched = buildEnrichedSkillRows({
      skills: normalizeRepoSkillRows(rows),
      useCachedTrust: true,
    });
    sortEnrichedSkills(enriched, "trusted");
    return {
      skills: enriched.slice(0, input.pageSize),
      total: enriched.length,
    };
  } catch (error) {
    console.error(
      "Failed to load marketplace browse snapshot:",
      getErrorMessage(error)
    );
    return null;
  }
}
