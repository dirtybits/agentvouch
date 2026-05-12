import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase, sql } from "@/lib/db";
import { verifyAuthorTrust, resolveMultipleAuthorTrust } from "@/lib/trust";
import { verifyWalletSignature, type AuthPayload } from "@/lib/auth";
import { pinSkillContent } from "@/lib/ipfs";
import {
  resolveManyAgentIdentitiesByWallet,
  upsertLocalAgentIdentity,
} from "@/lib/agentIdentity";
import { buildAgentTrustSummary } from "@/lib/agentDiscovery";
import {
  getConfiguredSolanaChainContext,
  normalizeInputChainContext,
  normalizePersistedChainContext,
} from "@/lib/chains";
import {
  MAX_SKILL_CONTACT_LENGTH,
  MAX_SKILL_DESCRIPTION_LENGTH,
  MAX_SKILL_NAME_LENGTH,
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
import { address, createSolanaRpc, isAddress } from "@solana/kit";
import { getConfiguredUsdcMint } from "@/lib/x402";
import {
  AGENTVOUCH_PROTOCOL_VERSION,
  getAgentVouchProgramId,
} from "@/lib/protocolMetadata";
import {
  getSkillPaymentFlow,
  normalizeUsdcMicros,
} from "@/lib/listingContract";

const PAGE_SIZE = 20;
const rpc = createSolanaRpc(DEFAULT_SOLANA_RPC_URL);
const configuredSolanaChainContext = getConfiguredSolanaChainContext();

type RepoSkillRow = {
  id: string;
  skill_id: string;
  author_pubkey: string;
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
    throw new Error("price_usdc_micros must be greater than zero");
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

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase();
    const { searchParams } = request.nextUrl;
    const q = searchParams.get("q");
    const sort = searchParams.get("sort") || "newest";
    const author = searchParams.get("author");
    const buyer = searchParams.get("buyer");
    const includeBuyerStatus =
      searchParams.get("buyerStatus") === "1" ||
      searchParams.get("includeBuyerStatus") === "true";
    const tags = searchParams.get("tags");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));

    let pgSkills: RepoSkillRow[] = [];
    try {
      if (q) {
        pgSkills = await sql()<RepoSkillRow>`
          SELECT *
          FROM skills
          WHERE to_tsvector('english', name || ' ' || COALESCE(description, '')) @@ plainto_tsquery('english', ${q})
          ${author ? sql()`AND author_pubkey = ${author}` : sql()``}
          ${
            tags
              ? sql()`AND tags && ${tags.split(",").filter(Boolean)}::text[]`
              : sql()``
          }
        `;
      } else {
        pgSkills = await sql()<RepoSkillRow>`
          SELECT *
          FROM skills
          WHERE 1=1
          ${author ? sql()`AND author_pubkey = ${author}` : sql()``}
          ${
            tags
              ? sql()`AND tags && ${tags.split(",").filter(Boolean)}::text[]`
              : sql()``
          }
        `;
      }
    } catch {
      pgSkills = [];
    }

    const normalizedPgSkills: RepoMergedSkillRow[] = pgSkills.map((skill) => ({
      ...skill,
      chain_context: normalizePersistedChainContext(skill.chain_context),
      source: "repo",
    }));

    const chainSkills = tags ? [] : await fetchOnChainListings();

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

    const authorPubkeys = [...new Set(allSkills.map((s) => s.author_pubkey))];
    const trustMap =
      authorPubkeys.length > 0
        ? await resolveMultipleAuthorTrust(authorPubkeys)
        : new Map();
    let identityMap = new Map();
    if (authorPubkeys.length > 0) {
      try {
        identityMap = await resolveManyAgentIdentitiesByWallet(authorPubkeys, {
          hasAgentProfileByWallet: new Map(
            authorPubkeys.map((authorPubkey) => [
              authorPubkey,
              trustMap.get(authorPubkey)?.isRegistered ?? false,
            ])
          ),
        });
      } catch (error) {
        console.error(
          "Failed to resolve author identities for /api/skills:",
          error
        );
      }
    }

    const enriched = allSkills.map((skill) => {
      const authorTrust = trustMap.get(skill.author_pubkey) || null;
      const authorIdentity = identityMap.get(skill.author_pubkey) || null;
      const priceUsdcMicros = normalizeUsdcMicros(skill.price_usdc_micros);

      return {
        ...skill,
        price_usdc_micros: priceUsdcMicros,
        payment_flow: getSkillPaymentFlow({
          priceUsdcMicros,
          onChainAddress: skill.on_chain_address,
          legacySolLamports: skill.price_lamports,
          allowLegacySol: true,
        }),
        author_trust: authorTrust,
        author_trust_summary: authorTrust
          ? buildAgentTrustSummary({
              walletPubkey: skill.author_pubkey,
              trust: authorTrust,
              identity: authorIdentity,
            })
          : null,
        author_identity: authorIdentity,
      };
    });

    if (sort === "trusted") {
      enriched.sort(
        (a, b) =>
          (b.author_trust?.reputationScore ?? 0) -
          (a.author_trust?.reputationScore ?? 0)
      );
    } else if (sort === "installs") {
      enriched.sort(
        (a, b) =>
          b.total_installs +
          (b.total_downloads ?? 0) -
          (a.total_installs + (a.total_downloads ?? 0))
      );
    } else if (sort === "name") {
      enriched.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      enriched.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }

    const total = enriched.length;
    const offset = (page - 1) * PAGE_SIZE;
    const paged = enriched.slice(offset, offset + PAGE_SIZE);
    const buyerAddress =
      includeBuyerStatus && buyer && isAddress(buyer) ? address(buyer) : null;
    const usdcMint = address(getConfiguredUsdcMint());
    const preflightContext = await createPurchasePreflightContext({
      rpc,
      buyer: buyerAddress,
      usdcMint,
      authors: paged.map((skill) => address(skill.author_pubkey)),
    });
    const pagedWithPricing = await Promise.all(
      paged.map(async (skill) => {
        const creatorPriceUsdcMicros = normalizeUsdcMicros(
          skill.price_usdc_micros
        );
        const preflight = serializePurchasePreflight(
          assessPurchasePreflight({
            context: preflightContext,
            priceUsdcMicros: creatorPriceUsdcMicros
              ? BigInt(creatorPriceUsdcMicros)
              : 0n,
            author: address(skill.author_pubkey),
            authorBackingUsdcMicros:
              skill.on_chain_address && creatorPriceUsdcMicros
                ? BigInt(skill.author_trust?.totalStakedFor ?? 0)
                : null,
          })
        );
        const buyerHasPurchased = buyerAddress
          ? creatorPriceUsdcMicros
            ? skill.source === "repo" && !skill.on_chain_address
              ? await hasUsdcPurchaseEntitlement(
                  skill.id,
                  String(buyerAddress)
                ).catch(() => false)
              : skill.on_chain_address
              ? await hasOnChainPurchase(
                  String(buyerAddress),
                  String(skill.on_chain_address)
                ).catch(() => false)
              : false
            : getSkillPaymentFlow({
                legacySolLamports: skill.price_lamports,
                allowLegacySol: true,
              }) === "legacy-sol" && skill.on_chain_address
            ? await hasOnChainPurchase(
                String(buyerAddress),
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

    return NextResponse.json(
      {
        skills: pagedWithPricing,
        pagination: {
          page,
          pageSize: PAGE_SIZE,
          total,
          totalPages: Math.ceil(total / PAGE_SIZE),
        },
      },
      {
        headers: {
          "Cache-Control": buyerAddress
            ? PRIVATE_NO_STORE_CACHE_CONTROL
            : buildPublicCacheControl(
                PUBLIC_ROUTE_CACHE_SECONDS.skillsList,
                PUBLIC_ROUTE_STALE_SECONDS.skillsList
              ),
        },
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
    const body = await request.json();
    const {
      auth,
      skill_id,
      name,
      description,
      tags,
      content,
      contact,
      price_usdc_micros,
      currency_mint,
    } = body as {
      auth: AuthPayload;
      skill_id: string;
      name: string;
      description?: string;
      tags?: string[];
      content: string;
      contact?: string;
      chain_context?: string;
      price_usdc_micros?: string | number;
      currency_mint?: string;
    };

    if (!auth || !skill_id || !name || !content) {
      return NextResponse.json(
        { error: "Missing required fields: auth, skill_id, name, content" },
        { status: 400 }
      );
    }

    const verification = verifyWalletSignature(auth);
    if (!verification.valid) {
      return NextResponse.json(
        { error: verification.error || "Invalid signature" },
        { status: 401 }
      );
    }

    const authorPubkey = verification.pubkey!;

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

    const normalizedName = normalizeSkillName(name);
    const normalizedDescription = description
      ? normalizeSkillDescription(description)
      : "";
    const normalizedContact = contact ? normalizeSkillContact(contact) : "";
    const normalizedChainContext = body.chain_context
      ? normalizeInputChainContext(body.chain_context)
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

    if (!normalizedName) {
      return NextResponse.json(
        { error: "Skill name is required" },
        { status: 400 }
      );
    }

    if (body.chain_context && !normalizedChainContext) {
      return NextResponse.json(
        {
          error:
            "Invalid chain_context. Use a supported CAIP-2 value or known alias.",
        },
        { status: 400 }
      );
    }

    let trust;
    try {
      trust = await verifyAuthorTrust(authorPubkey);
    } catch {
      return NextResponse.json(
        { error: "Unable to verify on-chain registration. Please try again." },
        { status: 503 }
      );
    }

    if (!trust.isRegistered) {
      return NextResponse.json(
        {
          error:
            "You must register an on-chain AgentProfile before publishing. Go to your Profile tab to register.",
        },
        { status: 403 }
      );
    }

    await initializeDatabase();

    const pinResult = await pinSkillContent(content, skill_id, 1);
    try {
      await upsertLocalAgentIdentity({
        walletPubkey: authorPubkey,
        chainContext: normalizedChainContext,
        hasAgentProfile: trust.isRegistered,
      });
    } catch (error) {
      console.error(
        "Failed to upsert local agent identity during skill publish:",
        error
      );
    }

    const [skill] = await sql()<RepoSkillRow>`
      INSERT INTO skills (
        skill_id,
        author_pubkey,
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
        ${authorPubkey},
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
      INSERT INTO skill_versions (skill_id, version, content, ipfs_cid, changelog)
      VALUES (
        ${skill.id}::uuid,
        1,
        ${content},
        ${pinResult.success ? pinResult.cid : null},
        'Initial release'
      )
    `;

    return NextResponse.json(
      {
        ...skill,
        ipfs: pinResult,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("POST /api/skills error:", error);
    const message = getErrorMessage(error);
    if (message.includes("unique")) {
      return NextResponse.json(
        { error: "A skill with this ID already exists for your account" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
