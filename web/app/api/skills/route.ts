import { NextRequest, NextResponse, after } from "next/server";
import { initializeDatabase, sql } from "@/lib/db";
import { generateSummarySafe } from "@/lib/ai/summarize";
import { runScanSafe, SCAN_RUBRIC_VERSION } from "@/lib/ai/scan";
import { SCAN_MODEL } from "@/lib/ai/gateway";
import { putSkillTree } from "@/lib/skillStorage";
import { parseSkillUploadRequest, SkillUploadError } from "@/lib/skillUpload";
import {
  buildSecurityScanFromFields,
  type SkillScanFieldRow,
  type SkillSecurityScan,
} from "@/lib/securityScan";
import { buildTrustSignals, type TrustSignal } from "@/lib/trustSignals";
import {
  verifyAuthorTrust,
  resolveMultipleAuthorTrust,
  type AuthorTrust,
} from "@/lib/trust";
import { verifyWalletSignature, type AuthPayload } from "@/lib/auth";
import { pinSkillContent } from "@/lib/ipfs";
import {
  type AgentIdentitySummary,
  resolveManyAgentIdentitiesByWallet,
  upsertLocalAgentIdentity,
} from "@/lib/agentIdentity";
import {
  buildAgentTrustSummary,
  type AgentTrustSummary,
} from "@/lib/agentDiscovery";
import {
  getConfiguredSolanaChainContext,
  normalizeInputChainContext,
  normalizePersistedChainContext,
} from "@/lib/chains";
import {
  MAX_SKILL_CONTACT_LENGTH,
  MAX_SKILL_DESCRIPTION_LENGTH,
  MAX_SKILL_NAME_LENGTH,
  MAX_SKILL_CONTENT_BYTES,
  normalizeSkillContact,
  normalizeSkillDescription,
  normalizeSkillName,
} from "@/lib/skillDraft";
import {
  assessPurchasePreflight,
  createPurchasePreflightContext,
  serializePurchasePreflight,
} from "@/lib/purchasePreflight";
import {
  buildPublicCacheControl,
  PRIVATE_NO_STORE_CACHE_CONTROL,
  PUBLIC_ROUTE_CACHE_SECONDS,
  PUBLIC_ROUTE_STALE_SECONDS,
} from "@/lib/cachePolicy";
import { getErrorMessage } from "@/lib/errors";
import { listOnChainSkillListings } from "@/lib/onchain";
import { DEFAULT_SOLANA_RPC_URL } from "@/lib/solanaRpc";
import { hasUsdcPurchaseEntitlement } from "@/lib/usdcPurchases";
import { hasOnChainPurchase } from "@/lib/x402";
import { address, createSolanaRpc, isAddress, type Address } from "@solana/kit";
import { getConfiguredUsdcMint } from "@/lib/x402";
import {
  AGENTVOUCH_PROTOCOL_VERSION,
  getAgentVouchProgramId,
} from "@/lib/protocolMetadata";
import {
  getSkillPaymentFlow,
  normalizeUsdcMicros,
} from "@/lib/listingContract";
import { getGithubSessionFromRequest } from "@/lib/githubOAuth";

const PAGE_SIZE = 20;
const rpc = createSolanaRpc(DEFAULT_SOLANA_RPC_URL);
const configuredSolanaChainContext = getConfiguredSolanaChainContext();

type SkillPaymentFlow =
  | "free"
  | "legacy-sol"
  | "listing-required"
  | "x402-usdc"
  | "direct-purchase-skill";

type RepoSkillRow = SkillScanFieldRow & {
  id: string;
  skill_id: string;
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
  cached_author_trust?: AuthorTrust | string | null;
  cached_author_trust_summary?: AgentTrustSummary | string | null;
  cached_reputation_score?: number | string | null;
  cached_trust_refreshed_at?: string | null;
  created_at: string;
  updated_at: string;
};

type ChainSkillRow = Omit<
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

type RepoMergedSkillRow = RepoSkillRow & { source: "repo" };
type MergedSkillRow = RepoMergedSkillRow | ChainSkillRow;
type EnrichedSkillRow = Omit<
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

type RouteTiming = {
  measure<T>(name: string, fn: () => Promise<T>): Promise<T>;
  header(): string;
};

function createRouteTiming(): RouteTiming {
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

function parseCachedJson<T>(value: T | string | null | undefined): T | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value;
}

function getCachedTrust(skill: MergedSkillRow): AuthorTrust | null {
  if (skill.source !== "repo") return null;
  return parseCachedJson<AuthorTrust>(skill.cached_author_trust);
}

function getCachedTrustSummary(skill: MergedSkillRow): AgentTrustSummary | null {
  if (skill.source !== "repo") return null;
  return parseCachedJson<AgentTrustSummary>(skill.cached_author_trust_summary);
}

function stripCachedSkillFields(skill: MergedSkillRow): MergedSkillRow {
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

function getSkillResponseHeaders(input: {
  buyerAddress: string | null;
  mode: "fast" | "full";
  timing: RouteTiming;
}) {
  const headers: Record<string, string> = {
    "Cache-Control": input.buyerAddress
      ? PRIVATE_NO_STORE_CACHE_CONTROL
      : buildPublicCacheControl(
          PUBLIC_ROUTE_CACHE_SECONDS.skillsList,
          PUBLIC_ROUTE_STALE_SECONDS.skillsList
        ),
    "X-AgentVouch-Skills-Mode": input.mode,
  };
  const serverTiming = input.timing.header();
  if (serverTiming) {
    headers["Server-Timing"] = serverTiming;
  }
  return headers;
}

type PublisherAuth =
  | {
      kind: "wallet";
      authorPubkey: string;
      externalId: null;
      handle: null;
      displayName: null;
      identityKey: string;
      tier: "unverified" | "registered";
      isRegistered: boolean;
    }
  | {
      kind: "github";
      authorPubkey: null;
      externalId: string;
      handle: string;
      displayName: string | null;
      identityKey: string;
      tier: "unverified";
      isRegistered: false;
    };

async function fetchOnChainListings(): Promise<ChainSkillRow[]> {
  try {
    const listings = await listOnChainSkillListings();
    return listings.map((listing) => ({
      id: `chain-${listing.publicKey}`,
      skill_id: listing.publicKey,
      author_pubkey: listing.data.author,
      name: listing.data.name,
      description: listing.data.description,
      tags: [],
      current_version: 1,
      ipfs_cid: null,
      on_chain_address: listing.publicKey,
      skill_uri: listing.data.skillUri || null,
      chain_context: configuredSolanaChainContext,
      total_installs: 0,
      total_downloads: Number(listing.data.totalDownloads),
      price_lamports: null,
      price_usdc_micros: String(listing.data.priceUsdcMicros),
      currency_mint: getConfiguredUsdcMint(),
      on_chain_protocol_version: AGENTVOUCH_PROTOCOL_VERSION,
      on_chain_program_id: getAgentVouchProgramId(),
      total_revenue: Number(listing.data.totalRevenueUsdcMicros),
      security_scan: null,
      created_at: new Date(Number(listing.data.createdAt) * 1000).toISOString(),
      updated_at: new Date(Number(listing.data.updatedAt) * 1000).toISOString(),
      source: "chain" as const,
    }));
  } catch (error) {
    console.error("Failed to fetch on-chain listings:", error);
    return [];
  }
}

function mergeSkills(
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

function normalizePriceUsdcMicros(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error("price_usdc_micros must be a positive integer string");
  }

  if (BigInt(normalized) <= 0n) {
    return null;
  }

  return normalized;
}

function normalizeCurrencyMint(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const normalized = String(value).trim();
  if (!normalized || !isAddress(normalized)) {
    throw new Error("currency_mint must be a valid Solana mint address");
  }

  return normalized;
}

async function loadRepoSkillRows(input: {
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
          latest.files,
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
          SELECT files, tree_hash, has_executable
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

    if (input.q) {
      return sql()<RepoSkillRow & Record<string, unknown>>`
        SELECT
          s.*,
          latest.files,
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
          SELECT files, tree_hash, has_executable
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
        WHERE to_tsvector('english', s.name || ' ' || COALESCE(s.description, '')) @@ plainto_tsquery('english', ${input.q})
        ${input.author ? sql()`AND s.author_pubkey = ${input.author}` : sql()``}
        ${
          input.tags
            ? sql()`AND s.tags && ${input.tags.split(",").filter(Boolean)}::text[]`
            : sql()``
        }
      `;
    }

    return sql()<RepoSkillRow & Record<string, unknown>>`
      SELECT
        s.*,
        latest.files,
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
        SELECT files, tree_hash, has_executable
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
          ? sql()`AND s.tags && ${input.tags.split(",").filter(Boolean)}::text[]`
          : sql()``
      }
    `;
  };

  if (input.timing) {
    return input.timing.measure("db", load);
  }
  return load();
}

function normalizeRepoSkillRows(pgSkills: RepoSkillRow[]): RepoMergedSkillRow[] {
  return pgSkills.map((skill) => ({
    ...skill,
    security_scan: buildSecurityScanFromFields(skill),
    chain_context: normalizePersistedChainContext(skill.chain_context),
    source: "repo",
  }));
}

function getAuthorPubkeys(skills: MergedSkillRow[]): string[] {
  return [
    ...new Set(
      skills
        .map((s) => s.author_pubkey)
        .filter((value): value is string => Boolean(value && isAddress(value)))
    ),
  ];
}

function buildEnrichedSkillRows(input: {
  skills: MergedSkillRow[];
  trustMap?: Map<string, AuthorTrust>;
  identityMap?: Map<string, AgentIdentitySummary>;
  useCachedTrust?: boolean;
}): EnrichedSkillRow[] {
  const trustMap = input.trustMap ?? new Map();
  const identityMap = input.identityMap ?? new Map();

  return input.skills.map((skill) => {
    const authorTrust =
      (skill.author_pubkey ? trustMap.get(skill.author_pubkey) || null : null) ??
      (input.useCachedTrust ? getCachedTrust(skill) : null);
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

function sortEnrichedSkills(skills: EnrichedSkillRow[], sort: string) {
  if (sort === "trusted") {
    skills.sort(
      (a, b) =>
        (b.author_trust?.reputationScore ?? 0) -
          (a.author_trust?.reputationScore ?? 0) ||
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  } else if (sort === "installs") {
    skills.sort(
      (a, b) =>
        b.total_installs +
        (b.total_downloads ?? 0) -
        (a.total_installs + (a.total_downloads ?? 0))
    );
  } else if (sort === "name") {
    skills.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    skills.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }
}

async function resolveLiveSkillTrust(input: {
  skills: MergedSkillRow[];
  timing: RouteTiming;
}): Promise<{
  trustMap: Map<string, AuthorTrust>;
  identityMap: Map<string, AgentIdentitySummary>;
}> {
  const authorPubkeys = getAuthorPubkeys(input.skills);
  const trustMap =
    authorPubkeys.length > 0
      ? await input.timing.measure("trust", () =>
          resolveMultipleAuthorTrust(authorPubkeys)
        )
      : new Map<string, AuthorTrust>();
  let identityMap = new Map<string, AgentIdentitySummary>();
  if (authorPubkeys.length > 0) {
    try {
      identityMap = await input.timing.measure("identity", () =>
        resolveManyAgentIdentitiesByWallet(authorPubkeys, {
          hasAgentProfileByWallet: new Map(
            authorPubkeys.map((authorPubkey) => [
              authorPubkey,
              trustMap.get(authorPubkey)?.isRegistered ?? false,
            ])
          ),
        })
      );
    } catch (error) {
      console.error(
        "Failed to resolve author identities for /api/skills:",
        error
      );
    }
  }
  return { trustMap, identityMap };
}

async function upsertAuthorTrustSnapshots(input: {
  trustMap: Map<string, AuthorTrust>;
  identityMap: Map<string, AgentIdentitySummary>;
}) {
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

function persistAuthorTrustSnapshots(input: {
  trustMap: Map<string, AuthorTrust>;
  identityMap: Map<string, AgentIdentitySummary>;
}) {
  if (input.trustMap.size === 0) return;
  const persist = () =>
    upsertAuthorTrustSnapshots(input).catch((error) => {
      console.error("Failed to persist author trust snapshots:", error);
    });
  try {
    after(persist);
  } catch {
    void persist();
  }
}

async function addPurchasePreflightAndBuyerStatus(input: {
  skills: EnrichedSkillRow[];
  buyerAddress: Address | null;
  timing: RouteTiming;
}) {
  const usdcMint = address(getConfiguredUsdcMint());
  const preflightContext = await input.timing.measure("preflight", () =>
    createPurchasePreflightContext({
      rpc,
      buyer: input.buyerAddress,
      usdcMint,
      authors: input.skills
        .map((skill) => skill.author_pubkey)
        .filter((value): value is string => Boolean(value && isAddress(value)))
        .map((authorPubkey) => address(authorPubkey)),
    })
  );

  return input.timing.measure("buyer-status", async () =>
    Promise.all(
      input.skills.map(async (skill) => {
        const creatorPriceUsdcMicros = normalizeUsdcMicros(
          skill.price_usdc_micros
        );
        const preflight = serializePurchasePreflight(
          assessPurchasePreflight({
            context: preflightContext,
            priceUsdcMicros: creatorPriceUsdcMicros
              ? BigInt(creatorPriceUsdcMicros)
              : 0n,
            author:
              skill.author_pubkey && isAddress(skill.author_pubkey)
                ? address(skill.author_pubkey)
                : null,
            authorBackingUsdcMicros:
              skill.on_chain_address && creatorPriceUsdcMicros
                ? BigInt(skill.author_trust?.totalStakeAtRisk ?? 0)
                : null,
          })
        );
        const buyerHasPurchased = input.buyerAddress
          ? creatorPriceUsdcMicros
            ? skill.source === "repo" && !skill.on_chain_address
              ? await hasUsdcPurchaseEntitlement(
                  skill.id,
                  String(input.buyerAddress)
                ).catch(() => false)
              : skill.on_chain_address
              ? await hasOnChainPurchase(
                  String(input.buyerAddress),
                  String(skill.on_chain_address)
                ).catch(() => false)
              : false
            : skill.payment_flow === "legacy-sol" && skill.on_chain_address
            ? await hasOnChainPurchase(
                String(input.buyerAddress),
                String(skill.on_chain_address)
              ).catch(() => false)
            : false
          : false;
        return {
          ...skill,
          ...preflight,
          buyerHasPurchased,
        };
      })
    )
  );
}

async function resolvePublisherAuth(input: {
  request: NextRequest;
  auth: AuthPayload | undefined;
  requiresWallet: boolean;
}): Promise<
  | { ok: true; publisher: PublisherAuth }
  | { ok: false; status: number; error: string }
> {
  if (input.auth) {
    const verification = verifyWalletSignature(input.auth);
    if (!verification.valid || !verification.pubkey) {
      return {
        ok: false,
        status: 401,
        error: verification.error || "Invalid signature",
      };
    }

    let isRegistered = false;
    try {
      const trust = await verifyAuthorTrust(verification.pubkey);
      isRegistered = trust.isRegistered;
    } catch (error) {
      if (input.requiresWallet) {
        return {
          ok: false,
          status: 503,
          error: "Unable to verify on-chain registration. Please try again.",
        };
      }
      console.error("Unable to verify free-publish wallet trust:", error);
    }

    if (input.requiresWallet && !isRegistered) {
      return {
        ok: false,
        status: 403,
        error:
          "Paid marketplace listings require a registered on-chain AgentProfile. Publish for free, or register before setting a price.",
      };
    }

    return {
      ok: true,
      publisher: {
        kind: "wallet",
        authorPubkey: verification.pubkey,
        externalId: null,
        handle: null,
        displayName: null,
        identityKey: `wallet:${verification.pubkey}`,
        tier: isRegistered ? "registered" : "unverified",
        isRegistered,
      },
    };
  }

  if (input.requiresWallet) {
    return {
      ok: false,
      status: 401,
      error: "Paid marketplace listings require wallet signature auth.",
    };
  }

  const githubSession = getGithubSessionFromRequest(input.request);
  if (!githubSession) {
    return {
      ok: false,
      status: 401,
      error: "Sign in with GitHub or connect a wallet to publish a free skill.",
    };
  }

  return {
    ok: true,
    publisher: {
      kind: "github",
      authorPubkey: null,
      externalId: githubSession.id,
      handle: githubSession.login,
      displayName: githubSession.name,
      identityKey: `github:${githubSession.id}`,
      tier: "unverified",
      isRegistered: false,
    },
  };
}

export async function GET(request: NextRequest) {
  const timing = createRouteTiming();
  try {
    await initializeDatabase();
    const { searchParams } = request.nextUrl;
    const q = searchParams.get("q");
    const sort = searchParams.get("sort") || "trusted";
    const author = searchParams.get("author");
    const buyer = searchParams.get("buyer");
    const fastMode =
      searchParams.get("mode") === "fast" ||
      searchParams.get("deferRpc") === "1";
    const includeBuyerStatus =
      searchParams.get("buyerStatus") === "1" ||
      searchParams.get("includeBuyerStatus") === "true";
    const tags = searchParams.get("tags");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));

    const pgSkills = await loadRepoSkillRows({
      q,
      author,
      tags,
      timing,
    }).catch(() => []);
    const normalizedPgSkills = normalizeRepoSkillRows(pgSkills);
    const chainSkills =
      tags || fastMode
        ? []
        : await timing.measure("chain", () => fetchOnChainListings());

    let allSkills = mergeSkills(normalizedPgSkills, chainSkills);

    if (author) {
      allSkills = allSkills.filter((s) => s.author_pubkey === author);
    }
    if (q) {
      const lower = q.toLowerCase();
      allSkills = allSkills.filter(
        (s) =>
          s.source === "repo" ||
          s.name.toLowerCase().includes(lower) ||
          (s.description || "").toLowerCase().includes(lower)
      );
    }

    const live = fastMode
      ? {
          trustMap: new Map<string, AuthorTrust>(),
          identityMap: new Map<string, AgentIdentitySummary>(),
        }
      : await resolveLiveSkillTrust({ skills: allSkills, timing });
    if (!fastMode) {
      persistAuthorTrustSnapshots(live);
    }

    const enriched = buildEnrichedSkillRows({
      skills: allSkills,
      trustMap: live.trustMap,
      identityMap: live.identityMap,
      useCachedTrust: true,
    });
    sortEnrichedSkills(enriched, sort);

    const total = enriched.length;
    const offset = (page - 1) * PAGE_SIZE;
    const paged = enriched.slice(offset, offset + PAGE_SIZE);
    const buyerAddress =
      includeBuyerStatus && buyer && isAddress(buyer) ? address(buyer) : null;
    const responseSkills = fastMode
      ? paged
      : await addPurchasePreflightAndBuyerStatus({
          skills: paged,
          buyerAddress,
          timing,
        });

    return NextResponse.json(
      {
        skills: responseSkills,
        pagination: {
          page,
          pageSize: PAGE_SIZE,
          total,
          totalPages: Math.ceil(total / PAGE_SIZE),
        },
      },
      {
        headers: getSkillResponseHeaders({
          buyerAddress: fastMode ? null : buyerAddress ? String(buyerAddress) : null,
          mode: fastMode ? "fast" : "full",
          timing,
        }),
      }
    );
  } catch (error: unknown) {
    console.error("GET /api/skills error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const upload = await parseSkillUploadRequest(request);
    const body = upload.body;
    const content = upload.skillContent;
    const {
      auth,
      skill_id,
      name,
      description,
      tags,
      contact,
      chain_context,
      price_usdc_micros,
      currency_mint,
    } = body as {
      auth?: AuthPayload;
      skill_id: string;
      name: string;
      description?: string;
      tags?: string[];
      content?: string;
      contact?: string;
      chain_context?: string;
      price_usdc_micros?: string | number;
      currency_mint?: string;
    };

    if (!skill_id || !name || !content) {
      return NextResponse.json(
        { error: "Missing required fields: skill_id, name, content" },
        { status: 400 }
      );
    }

    const fieldByteLimits: Array<{
      field: string;
      value: string | undefined;
      max: number;
    }> = [
      { field: "name", value: name, max: MAX_SKILL_NAME_LENGTH },
      { field: "description", value: description, max: MAX_SKILL_DESCRIPTION_LENGTH },
      { field: "contact", value: contact, max: MAX_SKILL_CONTACT_LENGTH },
    ];
    for (const { field, value, max } of fieldByteLimits) {
      if (typeof value !== "string") continue;
      const bytes = Buffer.byteLength(value, "utf8");
      if (bytes > max) {
        return NextResponse.json(
          {
            error: `${field} is ${bytes} bytes, exceeds on-chain cap of ${max} bytes`,
          },
          { status: 400 }
        );
      }
    }

    const contentBytes = Buffer.byteLength(content, "utf8");
    if (contentBytes > MAX_SKILL_CONTENT_BYTES) {
      return NextResponse.json(
        {
          error: `content is ${contentBytes} bytes, exceeds cap of ${MAX_SKILL_CONTENT_BYTES} bytes`,
        },
        { status: 400 }
      );
    }

    const normalizedName = normalizeSkillName(name);
    const normalizedDescription = description
      ? normalizeSkillDescription(description)
      : "";
    const normalizedContact = contact ? normalizeSkillContact(contact) : "";
    const normalizedChainContext = chain_context
      ? normalizeInputChainContext(chain_context)
      : configuredSolanaChainContext;
    let normalizedPriceUsdcMicros: string | null = null;
    let normalizedCurrencyMint: string | null = null;
    try {
      normalizedPriceUsdcMicros = normalizePriceUsdcMicros(price_usdc_micros);
      normalizedCurrencyMint = normalizedPriceUsdcMicros
        ? normalizeCurrencyMint(currency_mint) ?? getConfiguredUsdcMint()
        : null;
    } catch (error: unknown) {
      return NextResponse.json(
        { error: getErrorMessage(error) },
        { status: 400 }
      );
    }

    const requiresWalletPublisher = Boolean(normalizedPriceUsdcMicros);
    const publisherResult = await resolvePublisherAuth({
      request,
      auth,
      requiresWallet: requiresWalletPublisher,
    });
    if (!publisherResult.ok) {
      return NextResponse.json(
        { error: publisherResult.error },
        { status: publisherResult.status }
      );
    }
    const publisher = publisherResult.publisher;

    if (!normalizedName) {
      return NextResponse.json(
        { error: "Skill name is required" },
        { status: 400 }
      );
    }

    if (chain_context && !normalizedChainContext) {
      return NextResponse.json(
        {
          error:
            "Invalid chain_context. Use a supported CAIP-2 value or known alias.",
        },
        { status: 400 }
      );
    }

    await initializeDatabase();

    const tree = await putSkillTree(upload.files);
    const pinResult = await pinSkillContent(content, skill_id, 1);
    try {
      if (publisher.kind === "wallet") {
        await upsertLocalAgentIdentity({
          walletPubkey: publisher.authorPubkey,
          chainContext: normalizedChainContext,
          hasAgentProfile: publisher.isRegistered,
        });
      }
    } catch (error) {
      console.error(
        "Failed to upsert local agent identity during skill publish:",
        error
      );
    }

    const [skill] = await sql()<RepoSkillRow & Record<string, unknown>>`
      INSERT INTO skills (
        skill_id,
        author_pubkey,
        author_kind,
        author_external_id,
        author_handle,
        author_display_name,
        publisher_identity_key,
        publisher_tier,
        name,
        description,
        tags,
        current_version,
        ipfs_cid,
        contact,
        chain_context,
        price_usdc_micros,
        currency_mint
      )
      VALUES (
        ${skill_id},
        ${publisher.authorPubkey},
        ${publisher.kind},
        ${publisher.externalId},
        ${publisher.handle},
        ${publisher.displayName},
        ${publisher.identityKey},
        ${publisher.tier},
        ${normalizedName},
        ${normalizedDescription || null},
        ${tags || []}::text[],
        1,
        ${pinResult.success ? pinResult.cid : null},
        ${normalizedContact || null},
        ${normalizedChainContext},
        ${normalizedPriceUsdcMicros},
        ${normalizedCurrencyMint}
      )
      RETURNING *
    `;

    await sql()`
      INSERT INTO skill_versions (
        skill_id,
        version,
        content,
        ipfs_cid,
        changelog,
        files,
        tree_hash,
        storage_backend,
        has_executable
      )
      VALUES (
        ${skill.id}::uuid,
        1,
        ${content},
        ${pinResult.success ? pinResult.cid : null},
        'Initial release',
        ${JSON.stringify(tree.manifest)}::jsonb,
        ${tree.treeHash},
        ${tree.backend},
        ${tree.hasExecutable}
      )
    `;

    // Auto-generate the AI summary after the response — publishers never write one.
    after(() => generateSummarySafe(skill.id, content, { expectedVersion: 1 }));
    after(() => runScanSafe(tree.treeHash, tree.filesWithBytes));

    return NextResponse.json(
      {
        ...skill,
        files: tree.manifest,
        tree_hash: tree.treeHash,
        storage_backend: tree.backend,
        has_executable: tree.hasExecutable,
        security_scan: null,
        ipfs: pinResult,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("POST /api/skills error:", error);
    const message = getErrorMessage(error);
    if (error instanceof SkillUploadError) {
      return NextResponse.json({ error: message }, { status: error.status });
    }
    if (message.includes("unique")) {
      return NextResponse.json(
        { error: "A skill with this ID already exists for your account" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
