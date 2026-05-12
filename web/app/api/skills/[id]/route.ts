import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase, sql } from "@/lib/db";
import { resolveAuthorTrust } from "@/lib/trust";
import { verifyWalletSignature, type AuthPayload } from "@/lib/auth";
import { resolveAgentIdentityByWallet } from "@/lib/agentIdentity";
import { getConfiguredUsdcMint, hasOnChainPurchase } from "@/lib/x402";
import {
  getUsdcPurchaseEntitlementSummary,
  hasUsdcPurchaseEntitlement,
} from "@/lib/usdcPurchases";
import { buildAgentTrustSummary } from "@/lib/agentDiscovery";
import {
  getConfiguredSolanaChainContext,
  normalizePersistedChainContext,
} from "@/lib/chains";
import {
  buildPublicCacheControl,
  PRIVATE_NO_STORE_CACHE_CONTROL,
  PUBLIC_ROUTE_CACHE_SECONDS,
  PUBLIC_ROUTE_STALE_SECONDS,
} from "@/lib/cachePolicy";
import { getErrorMessage } from "@/lib/errors";
import { fetchOnChainSkillListing, getOnChainUsdcPrice } from "@/lib/onchain";
import {
  assessPurchasePreflight,
  createPurchasePreflightContext,
  serializePurchasePreflight,
} from "@/lib/purchasePreflight";
import { DEFAULT_SOLANA_RPC_URL } from "@/lib/solanaRpc";
import { address, createSolanaRpc, isAddress } from "@solana/kit";
import {
  AGENTVOUCH_PROTOCOL_VERSION,
  getAgentVouchProgramId,
} from "@/lib/protocolMetadata";
import {
  getSkillPaymentFlow,
  normalizeUsdcMicros,
} from "@/lib/listingContract";

const CHAIN_PREFIX = "chain-";
const rpc = createSolanaRpc(DEFAULT_SOLANA_RPC_URL);
const configuredSolanaChainContext = getConfiguredSolanaChainContext();

type SkillRow = {
  id: string;
  author_pubkey: string;
  skill_id: string;
  name: string;
  description: string | null;
  tags: string[];
  current_version: number;
  ipfs_cid: string | null;
  on_chain_address: string | null;
  chain_context: string | null;
  total_installs: number;
  total_downloads?: number;
  price_lamports?: number;
  price_usdc_micros?: string | null;
  currency_mint?: string | null;
  on_chain_protocol_version?: string | null;
  on_chain_program_id?: string | null;
  contact?: string | null;
  created_at: string;
  updated_at: string;
};

type SkillVersionRow = {
  id: string;
  version: number;
  content: string;
  ipfs_cid: string | null;
  changelog: string | null;
  created_at: string;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await initializeDatabase();
    const { searchParams } = request.nextUrl;
    const includeTrust = searchParams.get("include") !== "none";
    const buyer = searchParams.get("buyer");
    const buyerAddress = buyer && isAddress(buyer) ? address(buyer) : null;

    if (id.startsWith(CHAIN_PREFIX)) {
      const onChainAddr = id.slice(CHAIN_PREFIX.length);
      const listing = await fetchOnChainSkillListing(onChainAddr);
      if (!listing) {
        return NextResponse.json({ error: "Skill not found" }, { status: 404 });
      }
      const preflightContext = await createPurchasePreflightContext({
        rpc,
        buyer: buyerAddress,
        usdcMint: address(getConfiguredUsdcMint()),
        authors: [],
      });
      const preflight = serializePurchasePreflight(
        assessPurchasePreflight({
          context: preflightContext,
          priceUsdcMicros: BigInt(listing.data.priceUsdcMicros),
          author: null,
        })
      );

      let author_trust = null;
      if (includeTrust) {
        author_trust = await resolveAuthorTrust(listing.data.author as string);
      }
      let author_identity = null;
      try {
        author_identity = await resolveAgentIdentityByWallet(
          listing.data.author as string,
          {
            hasAgentProfile: author_trust?.isRegistered ?? false,
          }
        );
      } catch (error) {
        console.error(
          "Failed to resolve author identity for chain skill:",
          error
        );
      }

      let content: string | null = null;
      if (listing.data.skillUri) {
        try {
          const res = await fetch(listing.data.skillUri);
          if (res.ok) content = await res.text();
        } catch {
          /* best effort */
        }
      }
      const buyerHasPurchased =
        buyerAddress && BigInt(listing.data.priceUsdcMicros) > 0n
          ? await hasOnChainPurchase(
              String(buyerAddress),
              listing.publicKey
            ).catch(() => false)
          : false;
      const author_trust_summary = author_trust
        ? buildAgentTrustSummary({
            walletPubkey: String(listing.data.author),
            trust: author_trust,
            identity: author_identity,
          })
        : null;

      return NextResponse.json(
        {
          id: `chain-${listing.publicKey}`,
          skill_id: listing.publicKey,
          author_pubkey: listing.data.author,
          name: listing.data.name,
          description: listing.data.description,
          tags: [],
          current_version: 1,
          ipfs_cid: null,
          on_chain_address: listing.publicKey,
          chain_context: configuredSolanaChainContext,
          total_installs: 0,
          total_downloads: Number(listing.data.totalDownloads),
          price_lamports: null,
          price_usdc_micros: String(listing.data.priceUsdcMicros),
          currency_mint: getConfiguredUsdcMint(),
          on_chain_protocol_version: AGENTVOUCH_PROTOCOL_VERSION,
          on_chain_program_id: getAgentVouchProgramId(),
          payment_flow:
            Number(listing.data.priceUsdcMicros) > 0
              ? "direct-purchase-skill"
              : "free",
          contact: null,
          created_at: new Date(
            Number(listing.data.createdAt) * 1000
          ).toISOString(),
          updated_at: new Date(
            Number(listing.data.updatedAt) * 1000
          ).toISOString(),
          source: "chain",
          skill_uri: listing.data.skillUri,
          content,
          versions: [],
          author_trust,
          author_trust_summary,
          author_identity,
          buyerHasPurchased,
          buyerPurchaseSummary: null,
          content_verification: null,
          ...preflight,
        },
        {
          headers: {
            "Cache-Control": buyer
              ? PRIVATE_NO_STORE_CACHE_CONTROL
              : buildPublicCacheControl(
                  PUBLIC_ROUTE_CACHE_SECONDS.skillDetail,
                  PUBLIC_ROUTE_STALE_SECONDS.skillDetail
                ),
          },
        }
      );
    }

    const rows = await sql()<SkillRow>`
      SELECT * FROM skills WHERE id = ${id}::uuid
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    const skill = rows[0];
    skill.chain_context = normalizePersistedChainContext(skill.chain_context);

    if (
      skill.on_chain_address &&
      !normalizeUsdcMicros(skill.price_usdc_micros)
    ) {
      const listing = await getOnChainUsdcPrice(skill.on_chain_address);
      if (listing) {
        skill.price_usdc_micros = listing.priceUsdcMicros;
        skill.currency_mint ??= getConfiguredUsdcMint();
        skill.on_chain_protocol_version ??= AGENTVOUCH_PROTOCOL_VERSION;
        skill.on_chain_program_id ??= getAgentVouchProgramId();
      }
    }

    const versions = await sql()<SkillVersionRow>`
      SELECT id, version, content, ipfs_cid, changelog, created_at
      FROM skill_versions
      WHERE skill_id = ${id}::uuid
      ORDER BY version DESC
    `;

    const latestContent = versions[0]?.content ?? null;

    let author_trust = null;
    if (includeTrust) {
      author_trust = await resolveAuthorTrust(skill.author_pubkey);
    }
    let author_identity = null;
    try {
      author_identity = await resolveAgentIdentityByWallet(
        skill.author_pubkey,
        {
          hasAgentProfile: author_trust?.isRegistered ?? false,
        }
      );
    } catch (error) {
      console.error("Failed to resolve author identity for repo skill:", error);
    }

    const latestVersion = versions[0];
    const allPinned = versions.every((version) => !!version.ipfs_cid);
    const currentCidMatch = latestVersion?.ipfs_cid === skill.ipfs_cid;
    const content_verification = {
      has_ipfs: !!skill.ipfs_cid,
      all_versions_pinned: allPinned,
      current_cid_consistent: currentCidMatch,
      status: !skill.ipfs_cid
        ? "unverified"
        : allPinned && currentCidMatch
        ? "verified"
        : "drift_detected",
    };

    const versionsWithoutContent = versions.map((version) => {
      const rest = { ...version };
      delete (rest as { content?: unknown }).content;
      return rest;
    });
    const preflightContext = await createPurchasePreflightContext({
      rpc,
      buyer: buyerAddress,
      usdcMint: address(getConfiguredUsdcMint()),
      authors: [address(skill.author_pubkey)],
    });
    const priceUsdcMicros = normalizeUsdcMicros(skill.price_usdc_micros);
    const preflight = serializePurchasePreflight(
      assessPurchasePreflight({
        context: preflightContext,
        priceUsdcMicros: priceUsdcMicros ? BigInt(priceUsdcMicros) : 0n,
        author: address(skill.author_pubkey),
        authorBackingUsdcMicros:
          skill.on_chain_address && priceUsdcMicros
            ? BigInt(author_trust?.totalStakeAtRisk ?? 0)
            : null,
      })
    );
    const buyerHasPurchased = buyerAddress
      ? priceUsdcMicros
        ? skill.on_chain_address
          ? await hasOnChainPurchase(
              String(buyerAddress),
              String(skill.on_chain_address)
            ).catch(() => false)
          : await hasUsdcPurchaseEntitlement(id, String(buyerAddress)).catch(
              () => false
            )
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
    const buyerPurchaseSummary =
      buyerAddress && buyerHasPurchased
        ? await getUsdcPurchaseEntitlementSummary(
            id,
            String(buyerAddress)
          ).catch(() => null)
        : null;
    const author_trust_summary = author_trust
      ? buildAgentTrustSummary({
          walletPubkey: skill.author_pubkey,
          trust: author_trust,
          identity: author_identity,
        })
      : null;

    return NextResponse.json(
      {
        ...skill,
        price_usdc_micros: priceUsdcMicros,
        payment_flow: getSkillPaymentFlow({
          priceUsdcMicros,
          onChainAddress: skill.on_chain_address,
          legacySolLamports: skill.price_lamports,
          allowLegacySol: true,
        }),
        content: latestContent,
        versions: versionsWithoutContent,
        author_trust,
        author_trust_summary,
        author_identity,
        buyerHasPurchased,
        buyerPurchaseSummary,
        content_verification,
        ...preflight,
      },
      {
        headers: {
          "Cache-Control": buyer
            ? PRIVATE_NO_STORE_CACHE_CONTROL
            : buildPublicCacheControl(
                PUBLIC_ROUTE_CACHE_SECONDS.skillDetail,
                PUBLIC_ROUTE_STALE_SECONDS.skillDetail
              ),
        },
      }
    );
  } catch (error: unknown) {
    console.error("GET /api/skills/[id] error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { auth, on_chain_address } = body as {
      auth: AuthPayload;
      on_chain_address: string;
    };

    if (!auth || !on_chain_address) {
      return NextResponse.json(
        { error: "Missing required fields: auth, on_chain_address" },
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

    const rows = await sql()<Pick<SkillRow, "id" | "author_pubkey">>`
      SELECT id, author_pubkey FROM skills WHERE id = ${id}::uuid
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }
    if (rows[0].author_pubkey !== verification.pubkey) {
      return NextResponse.json(
        { error: "Not the skill author" },
        { status: 403 }
      );
    }

    const listing = await getOnChainUsdcPrice(on_chain_address);
    if (!listing) {
      return NextResponse.json(
        { error: "On-chain listing not found or unreadable" },
        { status: 404 }
      );
    }
    const priceUsdcMicros = normalizeUsdcMicros(listing?.priceUsdcMicros);

    const [updated] = await sql()<SkillRow>`
      UPDATE skills
      SET
        on_chain_address = ${on_chain_address},
        price_usdc_micros = ${priceUsdcMicros},
        currency_mint = ${priceUsdcMicros ? getConfiguredUsdcMint() : null},
        on_chain_protocol_version = ${AGENTVOUCH_PROTOCOL_VERSION},
        on_chain_program_id = ${getAgentVouchProgramId()},
        updated_at = NOW()
      WHERE id = ${id}::uuid
      RETURNING *
    `;

    return NextResponse.json({
      ...updated,
      chain_context: normalizePersistedChainContext(updated.chain_context),
    });
  } catch (error: unknown) {
    console.error("PATCH /api/skills/[id] error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
