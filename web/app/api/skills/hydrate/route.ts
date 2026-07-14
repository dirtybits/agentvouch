import { after, NextRequest, NextResponse } from "next/server";
import { address, createSolanaRpc, isAddress, type Address } from "@solana/kit";
import {
  resolveManyAgentIdentitiesByWallet,
  type AgentIdentitySummary,
} from "@/lib/agentIdentity";
import {
  buildAgentTrustSummary,
  type AgentTrustSummary,
} from "@/lib/agentDiscovery";
import { PRIVATE_NO_STORE_CACHE_CONTROL } from "@/lib/cachePolicy";
import {
  getConfiguredSolanaChainContext,
  normalizeInputChainContext,
  normalizePersistedChainContext,
} from "@/lib/chains";
import { initializeDatabase, sql } from "@/lib/db";
import { getErrorMessage } from "@/lib/errors";
import {
  getSkillPaymentFlow,
  normalizeUsdcMicros,
} from "@/lib/listingContract";
import { hydrateEvmRepoSkillRows } from "@/lib/marketplaceBrowse";
import {
  assessPurchasePreflight,
  createPurchasePreflightContext,
  serializePurchasePreflight,
} from "@/lib/purchasePreflight";
import { DEFAULT_SOLANA_RPC_URL } from "@/lib/solanaRpc";
import { type AuthorTrust } from "@/lib/trust";
import { SCAN_RUBRIC_VERSION } from "@/lib/ai/scan";
import { SCAN_MODEL } from "@/lib/ai/gateway";
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
import {
  getCachedTrust,
  getCachedTrustSummary,
  partitionAuthorsByTrustFreshness,
  scheduleBackgroundTrustRefresh,
} from "@/lib/authorTrustView";
import {
  hasChainUsdcPurchaseEntitlement,
  hasUsdcPurchaseEntitlement,
} from "@/lib/usdcPurchases";
import { normalizeChainAddressForStorage } from "@/lib/chainAddress";
import { getConfiguredUsdcMint, hasOnChainPurchase } from "@/lib/x402";

const MAX_HYDRATE_SKILLS = 24;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const configuredSolanaChainContext = getConfiguredSolanaChainContext();
const rpc = createSolanaRpc(DEFAULT_SOLANA_RPC_URL);

type HydrateRequestBody = {
  skillIds?: unknown;
  buyer?: unknown;
  buyerChainContext?: unknown;
  includeBuyerStatus?: unknown;
};

type SkillPaymentFlow =
  | "free"
  | "legacy-sol"
  | "listing-required"
  | "x402-usdc"
  | "direct-purchase-skill";

type RepoSkillRow = SkillScanFieldRow & {
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
  mirror_source_key?: string | null;
  synced_repo_url?: string | null;
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
  evm_listing_id?: string | null;
  evm_contract_address?: string | null;
  evm_tx_hash?: string | null;
  summary?: string | null;
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
  source: "repo";
};

type HydratedSkillRow = RepoSkillRow & {
  price_usdc_micros: string | null;
  payment_flow: SkillPaymentFlow;
  author_trust: AuthorTrust | null;
  author_trust_summary: AgentTrustSummary | null;
  author_identity: AgentIdentitySummary | null;
  signals: TrustSignal[];
};

async function loadRepoSkillsById(skillIds: string[]): Promise<RepoSkillRow[]> {
  const rows = await sql()<
    Omit<RepoSkillRow, "source"> & SkillScanFieldRow & Record<string, unknown>
  >`
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
  return rows.map((skill) => {
    const security_scan = buildSecurityScanFromFields(skill);
    const publicSkill = { ...skill };
    delete publicSkill.scan_verdict;
    delete publicSkill.scan_risk;
    delete publicSkill.scan_findings;
    delete publicSkill.scan_truncated;
    delete publicSkill.scan_scanned_at;
    delete publicSkill.scan_model;
    delete publicSkill.scan_rubric_version;
    delete publicSkill.scan_source;
    delete publicSkill.scan_generated_by_model;
    return {
      ...publicSkill,
      security_scan,
      chain_context: normalizePersistedChainContext(skill.chain_context),
      source: "repo",
    };
  });
}

function buildHydratedBaseRows(input: {
  skills: RepoSkillRow[];
  trustMap: Map<string, AuthorTrust>;
  identityMap: Map<string, AgentIdentitySummary>;
}): HydratedSkillRow[] {
  return input.skills.map((skill) => {
    // Prefer freshly-resolved trust (first-seen authors); fall back to the
    // cached snapshot for everyone else.
    const authorTrust =
      (skill.author_pubkey
        ? input.trustMap.get(skill.author_pubkey) || null
        : null) ?? getCachedTrust(skill);
    const authorIdentity = skill.author_pubkey
      ? input.identityMap.get(skill.author_pubkey) || null
      : null;
    const authorTrustSummary =
      skill.author_pubkey &&
      input.trustMap.has(skill.author_pubkey) &&
      authorTrust
        ? buildAgentTrustSummary({
            walletPubkey: skill.author_pubkey,
            trust: authorTrust,
            identity: authorIdentity,
          })
        : getCachedTrustSummary(skill);
    const priceUsdcMicros = normalizeUsdcMicros(skill.price_usdc_micros);

    const publicSkill = { ...skill };
    delete publicSkill.cached_author_trust;
    delete publicSkill.cached_author_trust_summary;
    delete publicSkill.cached_reputation_score;
    delete publicSkill.cached_trust_refreshed_at;

    return {
      ...publicSkill,
      price_usdc_micros: priceUsdcMicros,
      payment_flow: getSkillPaymentFlow({
        priceUsdcMicros,
        onChainAddress: skill.on_chain_address,
        evmListingId: skill.evm_listing_id,
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

async function resolveHydratedAuthorIdentities(input: {
  skills: RepoSkillRow[];
  trustMap: Map<string, AuthorTrust>;
}): Promise<Map<string, AgentIdentitySummary>> {
  const authorRows = new Map<string, RepoSkillRow>();
  for (const skill of input.skills) {
    if (skill.author_pubkey && isAddress(skill.author_pubkey)) {
      authorRows.set(skill.author_pubkey, skill);
    }
  }

  const authorPubkeys = [...authorRows.keys()];
  if (authorPubkeys.length === 0) {
    return new Map<string, AgentIdentitySummary>();
  }

  try {
    return await resolveManyAgentIdentitiesByWallet(authorPubkeys, {
      hasAgentProfileByWallet: new Map(
        authorPubkeys.map((authorPubkey) => [
          authorPubkey,
          input.trustMap.get(authorPubkey)?.isRegistered ??
            getCachedTrust(authorRows.get(authorPubkey) ?? {})?.isRegistered ??
            false,
        ])
      ),
      persistDerived: false,
    });
  } catch (error) {
    console.error(
      "Failed to resolve author identities for /api/skills/hydrate:",
      error
    );
    return new Map<string, AgentIdentitySummary>();
  }
}

async function addPurchasePreflightAndBuyerStatus(input: {
  skills: HydratedSkillRow[];
  buyerAddress: Address | null;
}) {
  const preflightContext = await createPurchasePreflightContext({
    rpc,
    buyer: input.buyerAddress,
    usdcMint: address(getConfiguredUsdcMint()),
    authors: input.skills
      .map((skill) => skill.author_pubkey)
      .filter((value): value is string => Boolean(value && isAddress(value)))
      .map((authorPubkey) => address(authorPubkey)),
  });

  return Promise.all(
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
          ? skill.source === "repo"
            ? skill.on_chain_address
              ? (
                  await Promise.all([
                    hasOnChainPurchase(
                      String(input.buyerAddress),
                      String(skill.on_chain_address)
                    ).catch(() => false),
                    hasUsdcPurchaseEntitlement(
                      skill.id,
                      String(input.buyerAddress)
                    ).catch(() => false),
                  ])
                ).some(Boolean)
              : await hasUsdcPurchaseEntitlement(
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
  );
}

export async function POST(request: NextRequest) {
  try {
    await initializeDatabase();
    const body = (await request.json()) as HydrateRequestBody;
    const skillIds = Array.isArray(body.skillIds)
      ? [
          ...new Set(
            body.skillIds
              .filter((value): value is string => typeof value === "string")
              .filter((value) => UUID_PATTERN.test(value))
          ),
        ].slice(0, MAX_HYDRATE_SKILLS)
      : [];

    if (skillIds.length === 0) {
      return NextResponse.json({ skills: {} });
    }

    const buyerChainContext = normalizeInputChainContext(
      typeof body.buyerChainContext === "string" ? body.buyerChainContext : null
    );
    // An explicit EVM buyer context is EXCLUSIVE: an invalid EVM buyer value yields no
    // buyer status instead of falling through to Solana handling (Phase 7 boundary rule).
    const wantsEvmBuyer = Boolean(buyerChainContext?.startsWith("eip155:"));
    const evmBuyer = wantsEvmBuyer
      ? normalizeChainAddressForStorage({
          chainContext: buyerChainContext,
          value: typeof body.buyer === "string" ? body.buyer : null,
        })
      : null;
    const buyer =
      !wantsEvmBuyer && typeof body.buyer === "string" && isAddress(body.buyer)
        ? body.buyer
        : null;
    const includeBuyerStatus = body.includeBuyerStatus === true;
    const repoSkills = await hydrateEvmRepoSkillRows(
      await loadRepoSkillsById(skillIds)
    );
    // Snapshot-first trust: serve cached snapshots, resolve only first-seen
    // authors synchronously, and revalidate stale authors in the background.
    const { missing, stale } = partitionAuthorsByTrustFreshness(repoSkills);
    const live =
      missing.length > 0
        ? await resolveTrustAndIdentity(missing)
        : {
            trustMap: new Map<string, AuthorTrust>(),
            identityMap: new Map<string, AgentIdentitySummary>(),
          };
    if (live.trustMap.size > 0) {
      const persist = () =>
        upsertAuthorTrustSnapshots(live).catch((error) => {
          console.error("Failed to persist author trust snapshots:", error);
        });
      try {
        after(persist);
      } catch {
        void persist();
      }
    }
    scheduleBackgroundTrustRefresh(stale);
    const identityMap = await resolveHydratedAuthorIdentities({
      skills: repoSkills,
      trustMap: live.trustMap,
    });

    const baseHydrated = buildHydratedBaseRows({
      skills: repoSkills,
      trustMap: live.trustMap,
      identityMap,
    });
    const hydrated =
      includeBuyerStatus && evmBuyer && buyerChainContext
        ? await Promise.all(
            baseHydrated.map(async (skill) => ({
              ...skill,
              // EVM buyers: chain-qualified entitlement lookup (no Solana preflight).
              buyerHasPurchased: normalizeUsdcMicros(skill.price_usdc_micros)
                ? await hasChainUsdcPurchaseEntitlement(skill.id, {
                    buyerChainContext,
                    buyerAddress: evmBuyer,
                  }).catch(() => false)
                : false,
            }))
          )
        : includeBuyerStatus && buyer
        ? await addPurchasePreflightAndBuyerStatus({
            skills: baseHydrated,
            buyerAddress: address(buyer),
          })
        : baseHydrated;

    return NextResponse.json(
      {
        skills: Object.fromEntries(hydrated.map((skill) => [skill.id, skill])),
      },
      {
        headers: {
          "Cache-Control":
            buyer ?? evmBuyer
              ? PRIVATE_NO_STORE_CACHE_CONTROL
              : "public, s-maxage=30, stale-while-revalidate=120",
        },
      }
    );
  } catch (error: unknown) {
    console.error("POST /api/skills/hydrate error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
