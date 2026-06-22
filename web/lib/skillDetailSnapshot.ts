import { after } from "next/server";
import { initializeDatabase, sql } from "@/lib/db";
import {
  buildAgentTrustSummary,
  type AgentTrustSummary,
} from "@/lib/agentDiscovery";
import {
  getCachedTrust,
  getCachedTrustSummary,
  partitionAuthorsByTrustFreshness,
  type CachedTrustRow,
} from "@/lib/authorTrustView";
import {
  getConfiguredSolanaChainContext,
  normalizePersistedChainContext,
} from "@/lib/chains";
import {
  getSkillPaymentFlow,
  normalizeUsdcMicros,
} from "@/lib/listingContract";
import { formatUsdcMicros } from "@/lib/pricing";
import {
  buildSecurityScanFromFields,
  type SkillScanFieldRow,
  type SkillSecurityScan,
} from "@/lib/securityScan";
import { buildTrustSignals, type TrustSignal } from "@/lib/trustSignals";
import {
  resolveTrustAndIdentity,
  upsertAuthorTrustSnapshots,
} from "@/lib/trustSnapshots";
import type {
  AgentGithubProfile,
  AgentIdentityBinding,
  AgentIdentitySource,
  AgentIdentitySummary,
  AgentUsernameSource,
} from "@/lib/agentIdentity";
import type { SkillFileTreeEntry } from "@/components/SkillFileTree";
import type { AuthorTrust } from "@/lib/trust";
import { SCAN_MODEL } from "@/lib/ai/gateway";
import { SCAN_RUBRIC_VERSION } from "@/lib/ai/scan";

const configuredSolanaChainContext = getConfiguredSolanaChainContext();

type JsonValue = string | Record<string, unknown> | unknown[] | null;

export type SkillDetailSnapshot = {
  id: string;
  skill_id: string;
  public_slug?: string | null;
  public_author_slug?: string | null;
  author_pubkey: string | null;
  author_kind?: string | null;
  author_external_id?: string | null;
  author_handle?: string | null;
  author_display_name?: string | null;
  publisher_identity_key?: string | null;
  publisher_tier?: string | null;
  name: string;
  description: string | null;
  tags: string[];
  current_version: number;
  summary?: string | null;
  summary_model?: string | null;
  summary_sha256?: string | null;
  summary_capabilities?: string[] | null;
  ipfs_cid: string | null;
  on_chain_address: string | null;
  chain_context: string | null;
  total_installs: number;
  total_downloads?: number;
  total_revenue?: number;
  price_lamports?: number;
  price_usdc_micros?: string | null;
  currency_mint?: string | null;
  on_chain_protocol_version?: string | null;
  on_chain_program_id?: string | null;
  contact: string | null;
  created_at: string;
  updated_at: string;
  source: "repo";
  payment_flow: ReturnType<typeof getSkillPaymentFlow>;
  content: string | null;
  files: SkillFileTreeEntry[] | null;
  tree_hash: string | null;
  storage_backend: string | null;
  has_executable: boolean;
  security_scan: SkillSecurityScan | null;
  signals: TrustSignal[];
  versions: Array<{
    id: string;
    version: number;
    ipfs_cid: string | null;
    changelog: string | null;
    files: unknown;
    tree_hash: string | null;
    storage_backend: string | null;
    has_executable: boolean;
    created_at: string;
  }>;
  author_trust: AuthorTrust | null;
  author_trust_summary: AgentTrustSummary | null;
  author_identity: AgentIdentitySummary | null;
  buyerHasPurchased: false;
  buyerPurchaseSummary: null;
  priceDisclosure?: string | null;
  purchaseRiskWarning?: string | null;
  content_verification: {
    has_ipfs: boolean;
    all_versions_pinned: boolean;
    current_cid_consistent: boolean;
    status: "verified" | "drift_detected" | "unverified";
  };
};

type SkillDetailSnapshotRow = SkillScanFieldRow &
  CachedTrustRow & {
    id: string;
    skill_id: string;
    public_slug: string | null;
    public_author_slug: string | null;
    author_pubkey: string | null;
    author_kind: string | null;
    author_external_id: string | null;
    author_handle: string | null;
    author_display_name: string | null;
    publisher_identity_key: string | null;
    publisher_tier: string | null;
    name: string;
    description: string | null;
    tags: string[];
    current_version: number;
    summary: string | null;
    summary_model: string | null;
    summary_sha256: string | null;
    summary_capabilities: string[] | null;
    ipfs_cid: string | null;
    on_chain_address: string | null;
    chain_context: string | null;
    total_installs: number;
    total_downloads: number | null;
    total_revenue: number | null;
    price_lamports: number | null;
    price_usdc_micros: string | null;
    currency_mint: string | null;
    on_chain_protocol_version: string | null;
    on_chain_program_id: string | null;
    contact: string | null;
    created_at: string;
    updated_at: string;
    latest_version_id: string | null;
    latest_version: number | null;
    latest_content: string | null;
    latest_ipfs_cid: string | null;
    latest_changelog: string | null;
    latest_files: unknown;
    latest_tree_hash: string | null;
    latest_storage_backend: string | null;
    latest_has_executable: boolean | null;
    latest_created_at: string | null;
    versions: JsonValue;
    all_versions_pinned: boolean | null;
    agent_id: string | null;
    canonical_agent_id: string | null;
    identity_source: AgentIdentitySource | null;
    home_chain_context: string | null;
    agent_status: string | null;
    display_name: string | null;
    username: string | null;
    username_source: AgentUsernameSource | null;
    bindings: JsonValue;
  } & Record<string, unknown>;

function parseJson<T>(value: JsonValue | undefined): T | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
}

function parseFileTree(value: unknown): SkillFileTreeEntry[] | null {
  const parsed =
    typeof value === "string"
      ? parseJson<unknown[]>(value)
      : Array.isArray(value)
      ? value
      : null;
  return Array.isArray(parsed) ? (parsed as SkillFileTreeEntry[]) : null;
}

function parseBindingMetadata(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string")
    return parseJson<Record<string, unknown>>(value);
  if (typeof value === "object") return value as Record<string, unknown>;
  return null;
}

function buildGithubProfile(
  bindings: AgentIdentityBinding[]
): AgentGithubProfile | null {
  const binding = bindings.find(
    (candidate) => candidate.bindingType === "github_profile"
  );
  const metadata = parseBindingMetadata(binding?.metadata ?? null);
  if (
    !metadata ||
    typeof metadata.id !== "string" ||
    typeof metadata.login !== "string"
  ) {
    return null;
  }
  return {
    id: metadata.id,
    login: metadata.login,
    name: typeof metadata.name === "string" ? metadata.name : null,
    avatarUrl:
      typeof metadata.avatarUrl === "string" ? metadata.avatarUrl : null,
    url:
      typeof metadata.url === "string"
        ? metadata.url
        : `https://github.com/${metadata.login}`,
  };
}

function buildAuthorIdentity(
  row: SkillDetailSnapshotRow
): AgentIdentitySummary | null {
  if (!row.agent_id || !row.canonical_agent_id || !row.identity_source) {
    return null;
  }
  const bindings =
    parseJson<AgentIdentityBinding[]>(row.bindings)?.map((binding) => ({
      ...binding,
      metadata: parseBindingMetadata(binding.metadata),
    })) ?? [];
  const ownerWallet =
    bindings.find((binding) => binding.bindingType === "wallet_owner")
      ?.bindingRef ??
    row.author_pubkey ??
    null;
  const operationalWallet =
    bindings.find((binding) => binding.bindingType === "wallet_operational")
      ?.bindingRef ?? null;
  const agentProfilePda =
    bindings.find((binding) => binding.bindingType === "agent_profile_pda")
      ?.bindingRef ?? null;
  const registryAsset =
    bindings.find((binding) => binding.bindingType === "solana_8004_asset")
      ?.bindingRef ?? null;

  return {
    id: row.agent_id,
    canonicalAgentId: row.canonical_agent_id,
    identitySource: row.identity_source,
    homeChainContext: row.home_chain_context,
    status: row.agent_status ?? "active",
    displayName: row.display_name,
    username: row.username,
    usernameSource: row.username_source ?? "fallback",
    githubProfile: buildGithubProfile(bindings),
    bindings,
    ownerWallet,
    operationalWallet,
    agentProfilePda,
    registryAsset,
  };
}

function buildDefaultPriceDisclosure(
  priceUsdcMicros: string | null
): string | null {
  if (!priceUsdcMicros || BigInt(priceUsdcMicros) <= 0n) return null;
  return "Buying this skill transfers USDC and creates an on-chain purchase receipt, so your wallet still needs a small amount of SOL for rent and network fees.";
}

function scheduleSnapshotTrustRefresh(row: SkillDetailSnapshotRow) {
  const { missing, stale } = partitionAuthorsByTrustFreshness([row]);
  const refreshAuthors = [...new Set([...missing, ...stale])];
  if (refreshAuthors.length === 0) return;

  const run = async () => {
    const live = await resolveTrustAndIdentity(refreshAuthors);
    await upsertAuthorTrustSnapshots(live);
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

export async function loadSkillDetailSnapshot(
  skillDbId: string
): Promise<SkillDetailSnapshot | null> {
  await initializeDatabase();

  const rows = await sql()<SkillDetailSnapshotRow>`
    SELECT
      s.*,
      latest.id AS latest_version_id,
      latest.version AS latest_version,
      CASE
        WHEN COALESCE(s.price_usdc_micros, '0')::numeric <= 0
        THEN latest.content
        ELSE NULL
      END AS latest_content,
      NULL::bigint AS price_lamports,
      latest.ipfs_cid AS latest_ipfs_cid,
      latest.changelog AS latest_changelog,
      latest.files AS latest_files,
      latest.tree_hash AS latest_tree_hash,
      latest.storage_backend AS latest_storage_backend,
      latest.has_executable AS latest_has_executable,
      latest.created_at AS latest_created_at,
      version_meta.versions,
      COALESCE(version_meta.all_versions_pinned, false) AS all_versions_pinned,
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
      a.id AS agent_id,
      a.canonical_agent_id,
      a.identity_source,
      a.home_chain_context,
      a.status AS agent_status,
      a.display_name,
      a.username,
      a.username_source,
      binding_rows.bindings
    FROM skills s
    LEFT JOIN LATERAL (
      SELECT id, version, content, ipfs_cid, changelog, files, tree_hash, storage_backend, has_executable, created_at
      FROM skill_versions
      WHERE skill_id = s.id
      ORDER BY version DESC
      LIMIT 1
    ) latest ON true
    LEFT JOIN LATERAL (
      SELECT
        jsonb_agg(
          jsonb_build_object(
            'id', v.id,
            'version', v.version,
            'ipfs_cid', v.ipfs_cid,
            'changelog', v.changelog,
            'files', v.files,
            'tree_hash', v.tree_hash,
            'storage_backend', v.storage_backend,
            'has_executable', v.has_executable,
            'created_at', v.created_at
          )
          ORDER BY v.version DESC
        ) AS versions,
        bool_and(v.ipfs_cid IS NOT NULL) AS all_versions_pinned
      FROM skill_versions v
      WHERE v.skill_id = s.id
    ) version_meta ON true
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
    LEFT JOIN agents a
      ON a.id = owner_binding.agent_id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'bindingType', b.binding_type,
          'chainContext', b.chain_context,
          'bindingRef', b.binding_ref,
          'registryAddress', b.registry_address,
          'externalAgentId', b.external_agent_id,
          'isPrimary', b.is_primary,
          'verificationStatus', b.verification_status,
          'rawUpstreamChainLabel', b.raw_upstream_chain_label,
          'rawUpstreamChainId', b.raw_upstream_chain_id,
          'metadata', b.metadata
        )
        ORDER BY b.is_primary DESC, b.created_at ASC
      ) AS bindings
      FROM agent_identity_bindings b
      WHERE b.agent_id = a.id
    ) binding_rows ON true
    WHERE s.id = ${skillDbId}::uuid
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;

  scheduleSnapshotTrustRefresh(row);

  const priceUsdcMicros = normalizeUsdcMicros(row.price_usdc_micros);
  const paymentFlow = getSkillPaymentFlow({
    priceUsdcMicros,
    onChainAddress: row.on_chain_address,
    legacySolLamports: row.price_lamports,
    allowLegacySol: true,
  });
  const authorTrust = getCachedTrust(row);
  const authorIdentity = buildAuthorIdentity(row);
  const authorTrustSummary =
    getCachedTrustSummary(row) ??
    (authorTrust && row.author_pubkey
      ? buildAgentTrustSummary({
          walletPubkey: row.author_pubkey,
          trust: authorTrust,
          identity: authorIdentity,
        })
      : null);
  const securityScan = buildSecurityScanFromFields(row);
  const allVersionsPinned = Boolean(row.all_versions_pinned);
  const currentCidMatch = row.latest_ipfs_cid === row.ipfs_cid;
  const versions =
    parseJson<SkillDetailSnapshot["versions"]>(row.versions) ?? [];

  return {
    id: row.id,
    skill_id: row.skill_id,
    public_slug: row.public_slug,
    public_author_slug: row.public_author_slug,
    author_pubkey: row.author_pubkey,
    author_kind: row.author_kind,
    author_external_id: row.author_external_id,
    author_handle: row.author_handle,
    author_display_name: row.author_display_name,
    publisher_identity_key: row.publisher_identity_key,
    publisher_tier: row.publisher_tier,
    name: row.name,
    description: row.description,
    tags: row.tags ?? [],
    current_version: row.current_version,
    summary: row.summary,
    summary_model: row.summary_model,
    summary_sha256: row.summary_sha256,
    summary_capabilities: row.summary_capabilities,
    ipfs_cid: row.ipfs_cid,
    on_chain_address: row.on_chain_address,
    chain_context: normalizePersistedChainContext(row.chain_context),
    total_installs: row.total_installs,
    total_downloads: row.total_downloads ?? undefined,
    total_revenue: row.total_revenue ?? undefined,
    price_lamports: row.price_lamports ?? undefined,
    price_usdc_micros: priceUsdcMicros,
    currency_mint: row.currency_mint,
    on_chain_protocol_version: row.on_chain_protocol_version,
    on_chain_program_id: row.on_chain_program_id,
    contact: row.contact,
    created_at: row.created_at,
    updated_at: row.updated_at,
    source: "repo",
    payment_flow: paymentFlow,
    content: row.latest_content,
    files: parseFileTree(row.latest_files),
    tree_hash: row.latest_tree_hash,
    storage_backend: row.latest_storage_backend,
    has_executable: Boolean(row.latest_has_executable),
    security_scan: securityScan,
    signals: buildTrustSignals({ trust: authorTrust, scan: securityScan }),
    versions,
    author_trust: authorTrust,
    author_trust_summary: authorTrustSummary,
    author_identity: authorIdentity,
    buyerHasPurchased: false,
    buyerPurchaseSummary: null,
    content_verification: {
      has_ipfs: Boolean(row.ipfs_cid),
      all_versions_pinned: allVersionsPinned,
      current_cid_consistent: currentCidMatch,
      status: !row.ipfs_cid
        ? "unverified"
        : allVersionsPinned && currentCidMatch
        ? "verified"
        : "drift_detected",
    },
    priceDisclosure: buildDefaultPriceDisclosure(priceUsdcMicros),
    purchaseRiskWarning:
      priceUsdcMicros &&
      BigInt(priceUsdcMicros) > 0n &&
      authorTrust?.totalStakeAtRisk === 0
        ? "This author has not posted slashable backing yet. Dispute recovery depends on the author's locked proceeds at the time of resolution."
        : null,
  } as SkillDetailSnapshot;
}

export function buildSkillDetailSnapshotMetadata(
  snapshot: SkillDetailSnapshot
) {
  return {
    id: snapshot.id,
    public_slug: snapshot.public_slug,
    public_author_slug: snapshot.public_author_slug,
    skill_id: snapshot.skill_id,
    name: snapshot.name,
    description:
      snapshot.description ||
      "Inspect the author trust record, stake-backed vouches, and dispute history behind this AI agent skill.",
    authorPubkey: snapshot.author_pubkey,
    authorKind: snapshot.author_kind,
    authorHandle: snapshot.author_handle,
    authorDisplayName: snapshot.author_display_name,
    publisherTier: snapshot.publisher_tier,
    chainContext: snapshot.chain_context,
    priceUsdcMicros: snapshot.price_usdc_micros,
    priceLabel: formatUsdcMicros(snapshot.price_usdc_micros),
    trustSummary: snapshot.author_trust_summary,
  };
}
