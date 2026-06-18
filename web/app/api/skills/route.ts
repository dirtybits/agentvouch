import { NextRequest, NextResponse, after } from "next/server";
import { randomUUID } from "crypto";
import { initializeDatabase, sql } from "@/lib/db";
import { runReviewSafe } from "@/lib/ai/review";
import { putSkillTree } from "@/lib/skillStorage";
import { parseSkillUploadRequest, SkillUploadError } from "@/lib/skillUpload";
import {
  verifyAuthorTrust,
  resolveMultipleAuthorTrust,
  type AuthorTrust,
} from "@/lib/trust";
import { verifyWalletSignature, type AuthPayload } from "@/lib/auth";
import { pinSkillContent } from "@/lib/ipfs";
import {
  ensureAgentIdentitySchema,
  type AgentIdentitySummary,
  resolveManyAgentIdentitiesByWallet,
  upsertLocalAgentIdentity,
} from "@/lib/agentIdentity";
import {
  getConfiguredSolanaChainContext,
  normalizeInputChainContext,
} from "@/lib/chains";
import {
  MAX_SKILL_CONTACT_LENGTH,
  MAX_SKILL_DESCRIPTION_LENGTH,
  MAX_SKILL_NAME_LENGTH,
  MAX_SKILL_CONTENT_BYTES,
  normalizeSkillContact,
  normalizeSkillDescription,
  normalizeSkillName,
  normalizeSkillTags,
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
import { normalizeUsdcMicros } from "@/lib/listingContract";
import { getGithubSessionFromRequest } from "@/lib/githubOAuth";
import { buildUniquePublicSkillRoute } from "@/lib/skillRouteResolver";
import { upsertAuthorTrustSnapshots } from "@/lib/trustSnapshots";
import {
  getCachedTrust,
  partitionAuthorsByTrustFreshness,
  scheduleBackgroundTrustRefresh,
} from "@/lib/authorTrustView";
import {
  buildEnrichedSkillRows,
  createRouteTiming,
  loadRepoSkillRows,
  mergeSkills,
  type MergedSkillRow,
  normalizeRepoSkillRows,
  sortEnrichedSkills,
  type ChainSkillRow,
  type EnrichedSkillRow,
  type RepoSkillRow,
  type RouteTiming,
} from "@/lib/marketplaceBrowse";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const rpc = createSolanaRpc(DEFAULT_SOLANA_RPC_URL);
const configuredSolanaChainContext = getConfiguredSolanaChainContext();

function parsePageSize(value: string | null): number {
  if (!value) return DEFAULT_PAGE_SIZE;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, parsed));
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
      public_slug: `chain-${listing.publicKey}`,
      public_author_slug: "chain",
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

async function resolveLiveSkillTrust(input: {
  authorPubkeys: string[];
  timing: RouteTiming;
}): Promise<{
  trustMap: Map<string, AuthorTrust>;
  identityMap: Map<string, AgentIdentitySummary>;
}> {
  const authorPubkeys = input.authorPubkeys;
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

async function resolveSkillAuthorIdentities(input: {
  skills: Array<MergedSkillRow>;
  trustMap: Map<string, AuthorTrust>;
  timing: RouteTiming;
}): Promise<Map<string, AgentIdentitySummary>> {
  const authorRows = new Map<string, MergedSkillRow>();
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
    return await input.timing.measure("identity", () =>
      resolveManyAgentIdentitiesByWallet(authorPubkeys, {
        hasAgentProfileByWallet: new Map(
          authorPubkeys.map((authorPubkey) => [
            authorPubkey,
            input.trustMap.get(authorPubkey)?.isRegistered ??
              getCachedTrust(authorRows.get(authorPubkey) ?? {})
                ?.isRegistered ??
              false,
          ])
        ),
        persistDerived: false,
      })
    );
  } catch (error) {
    console.error(
      "Failed to resolve author identities for /api/skills:",
      error
    );
    return new Map<string, AgentIdentitySummary>();
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
    await ensureAgentIdentitySchema();
    const { searchParams } = request.nextUrl;
    const q = searchParams.get("q")?.trim() || null;
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
    const pageSize = parsePageSize(
      searchParams.get("pageSize") ?? searchParams.get("limit")
    );

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

    // Snapshot-first trust: serve cached author_trust_snapshots, resolve only
    // first-seen authors synchronously, and revalidate stale authors in the
    // background. Fast mode skips trust entirely and relies on the cache.
    const live = {
      trustMap: new Map<string, AuthorTrust>(),
      identityMap: new Map<string, AgentIdentitySummary>(),
    };
    if (!fastMode) {
      const { missing, stale } = partitionAuthorsByTrustFreshness(allSkills);
      if (missing.length > 0) {
        const resolved = await resolveLiveSkillTrust({
          authorPubkeys: missing,
          timing,
        });
        live.trustMap = resolved.trustMap;
        live.identityMap = resolved.identityMap;
        persistAuthorTrustSnapshots(resolved);
      }
      scheduleBackgroundTrustRefresh(stale);
    }

    const identityMap = fastMode
      ? live.identityMap
      : await resolveSkillAuthorIdentities({
          skills: allSkills,
          trustMap: live.trustMap,
          timing,
        });

    const enriched = buildEnrichedSkillRows({
      skills: allSkills,
      trustMap: live.trustMap,
      identityMap,
      useCachedTrust: true,
    });
    sortEnrichedSkills(enriched, sort, { hasSearchQuery: Boolean(q) });

    const total = enriched.length;
    const offset = (page - 1) * pageSize;
    const paged = enriched.slice(offset, offset + pageSize);
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
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      },
      {
        headers: getSkillResponseHeaders({
          buyerAddress: fastMode
            ? null
            : buyerAddress
            ? String(buyerAddress)
            : null,
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
      {
        field: "description",
        value: description,
        max: MAX_SKILL_DESCRIPTION_LENGTH,
      },
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
    const normalizedTags = normalizeSkillTags(tags);
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
    const skillDbId = randomUUID();
    const { publicAuthorSlug, publicSlug } = await buildUniquePublicSkillRoute(
      sql(),
      {
        id: skillDbId,
        skill_id,
        author_handle: publisher.handle,
        author_pubkey: publisher.authorPubkey,
        publisher_identity_key: publisher.identityKey,
      }
    );

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
        id,
        skill_id,
        public_slug,
        public_author_slug,
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
        ${skillDbId}::uuid,
        ${skill_id},
        ${publicSlug},
        ${publicAuthorSlug},
        ${publisher.authorPubkey},
        ${publisher.kind},
        ${publisher.externalId},
        ${publisher.handle},
        ${publisher.displayName},
        ${publisher.identityKey},
        ${publisher.tier},
        ${normalizedName},
        ${normalizedDescription || null},
        ${normalizedTags}::text[],
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

    // Auto-generate the skill's automated review (summary + scan) after the
    // response — publishers never write one.
    after(() =>
      runReviewSafe({
        skillId: skill.id,
        content,
        treeHash: tree.treeHash,
        files: tree.filesWithBytes,
        expectedVersion: 1,
      })
    );

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
