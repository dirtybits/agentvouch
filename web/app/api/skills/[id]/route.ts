import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase, sql } from "@/lib/db";
import { resolveAuthorTrust } from "@/lib/trust";
import { verifyEvmWalletSignature } from "@/lib/evmAuth";
import { verifyWalletSignature, type AuthPayload } from "@/lib/auth";
import { resolveAgentIdentityByWallet } from "@/lib/agentIdentity";
import { getConfiguredUsdcMint, hasOnChainPurchase } from "@/lib/x402";
import {
  hasChainUsdcPurchaseEntitlement,
  getUsdcPurchaseEntitlementSummary,
  hasUsdcPurchaseEntitlement,
} from "@/lib/usdcPurchases";
import { resolveBaseAuthorTrust } from "@/lib/baseAuthorTrust";
import { buildAgentTrustSummary } from "@/lib/agentDiscovery";
import { buildTrustSignals } from "@/lib/trustSignals";
import {
  getConfiguredSolanaChainContext,
  BASE_SEPOLIA_CHAIN_CONTEXT,
  normalizeInputChainContext,
  normalizePersistedChainContext,
} from "@/lib/chains";
import {
  verifyBaseSkillListing,
  type BaseSkillListingRow,
} from "@/lib/baseListingVerification";
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
import { getAddress as getEvmAddress, isAddress as isEvmAddress } from "viem";
import {
  AGENTVOUCH_PROTOCOL_VERSION,
  getAgentVouchProgramId,
} from "@/lib/protocolMetadata";
import { normalizeUsdcMicros } from "@/lib/listingContract";
import { resolveSkillRouteParam } from "@/lib/skillRouteResolver";
import { getCanonicalSkillRawUrl } from "@/lib/skillUrls";
import {
  loadSkillDetailSnapshot,
  type SkillDetailSnapshot,
} from "@/lib/skillDetailSnapshot";
import { upsertResolvedAuthorTrustSnapshot } from "@/lib/trustSnapshots";

const CHAIN_PREFIX = "chain-";
const rpc = createSolanaRpc(DEFAULT_SOLANA_RPC_URL);
const configuredSolanaChainContext = getConfiguredSolanaChainContext();

async function applyLiveAuthorTrust(
  snapshot: SkillDetailSnapshot
): Promise<SkillDetailSnapshot> {
  const snapshotChainContext = snapshot.chain_context;
  if (
    snapshot.author_pubkey &&
    snapshotChainContext?.startsWith("eip155:") &&
    isEvmAddress(snapshot.author_pubkey)
  ) {
    const authorAddress = getEvmAddress(snapshot.author_pubkey);
    const authorTrust = await resolveBaseAuthorTrust(
      authorAddress,
      snapshotChainContext
    );
    const authorIdentity =
      (await resolveAgentIdentityByWallet(authorAddress, {
        chainContext: snapshotChainContext,
        hasAgentProfile: authorTrust.isRegistered,
      }).catch(() => null)) ?? snapshot.author_identity;
    const authorTrustSummary = buildAgentTrustSummary({
      walletPubkey: authorAddress,
      trust: authorTrust,
      identity: authorIdentity,
    });

    return {
      ...snapshot,
      author_pubkey: authorAddress,
      author_trust: authorTrust,
      author_trust_summary: authorTrustSummary,
      author_identity: authorIdentity,
      signals: buildTrustSignals({
        trust: authorTrust,
        scan: snapshot.security_scan,
      }),
      purchaseRiskWarning:
        snapshot.price_usdc_micros &&
        BigInt(snapshot.price_usdc_micros) > 0n &&
        authorTrust.totalStakeAtRisk === 0
          ? "This author has not posted slashable backing yet. Dispute recovery depends on the author's locked proceeds at the time of resolution."
          : null,
    };
  }

  if (!snapshot.author_pubkey || !isAddress(snapshot.author_pubkey)) {
    return snapshot;
  }

  const authorTrust = await resolveAuthorTrust(snapshot.author_pubkey);
  const authorIdentity =
    (await resolveAgentIdentityByWallet(snapshot.author_pubkey, {
      hasAgentProfile: authorTrust.isRegistered,
    }).catch(() => null)) ?? snapshot.author_identity;
  const authorTrustSummary = buildAgentTrustSummary({
    walletPubkey: snapshot.author_pubkey,
    trust: authorTrust,
    identity: authorIdentity,
  });

  try {
    await upsertResolvedAuthorTrustSnapshot({
      walletPubkey: snapshot.author_pubkey,
      trust: authorTrust,
      summary: authorTrustSummary,
    });
  } catch (error) {
    console.error(
      "Failed to refresh author trust snapshot from skill detail:",
      error
    );
  }

  return {
    ...snapshot,
    author_trust: authorTrust,
    author_trust_summary: authorTrustSummary,
    author_identity: authorIdentity,
    signals: buildTrustSignals({
      trust: authorTrust,
      scan: snapshot.security_scan,
    }),
    purchaseRiskWarning:
      snapshot.price_usdc_micros &&
      BigInt(snapshot.price_usdc_micros) > 0n &&
      authorTrust.totalStakeAtRisk === 0
        ? "This author has not posted slashable backing yet. Dispute recovery depends on the author's locked proceeds at the time of resolution."
        : null,
  };
}

type SkillRow = {
  id: string;
  public_slug: string;
  public_author_slug: string;
  author_pubkey: string | null;
  author_kind?: string | null;
  author_external_id?: string | null;
  author_handle?: string | null;
  author_display_name?: string | null;
  publisher_identity_key?: string | null;
  publisher_tier?: string | null;
  mirror_source_key?: string | null;
  synced_repo_url?: string | null;
  skill_id: string;
  name: string;
  description: string | null;
  tags: string[];
  current_version: number;
  ipfs_cid: string | null;
  on_chain_address: string | null;
  chain_context: string | null;
  evm_listing_id?: string | null;
  evm_contract_address?: string | null;
  evm_tx_hash?: string | null;
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await initializeDatabase();
    const { searchParams } = request.nextUrl;
    const includeTrust = searchParams.get("include") !== "none";
    const useLiveTrust = searchParams.get("trust") === "live";
    const buyer = searchParams.get("buyer");
    const buyerAddress = buyer && isAddress(buyer) ? address(buyer) : null;
    const buyerEvmAddress =
      buyer && isEvmAddress(buyer) ? getEvmAddress(buyer) : null;
    const buyerChainContextParam =
      searchParams.get("buyerChainContext") ??
      searchParams.get("buyer_chain_context");

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

      // Content wall: only free skills expose full content pre-purchase. Paid
      // skills surface trust signals + metadata as the decision layer; the
      // content itself is delivered via the signature-verified raw/archive
      // download, so the detail surface can't bypass the paywall.
      const chainIsFree = Number(listing.data.priceUsdcMicros) <= 0;
      let content: string | null = null;
      if (chainIsFree && listing.data.skillUri) {
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
          public_slug: `chain-${listing.publicKey}`,
          public_author_slug: "chain",
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
          files: null,
          tree_hash: null,
          storage_backend: null,
          has_executable: false,
          security_scan: null,
          signals: buildTrustSignals({ trust: author_trust, scan: null }),
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

    const route = await resolveSkillRouteParam(id);
    if (!route || route.id.startsWith(CHAIN_PREFIX)) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }
    const skillDbId = route.id;

    const snapshot = await loadSkillDetailSnapshot(skillDbId);
    if (!snapshot) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    const skillSnapshot = useLiveTrust
      ? await applyLiveAuthorTrust(snapshot)
      : snapshot;

    const priceUsdcMicros = skillSnapshot.price_usdc_micros;
    const paymentFlow = skillSnapshot.payment_flow;
    const skillChainContext = skillSnapshot.chain_context;
    const isEvmSkill =
      Boolean(skillSnapshot.evm_listing_id) ||
      skillChainContext?.startsWith("eip155:");
    const normalizedBuyerChainContext =
      normalizeInputChainContext(buyerChainContextParam) ??
      (isEvmSkill ? skillChainContext : null);
    const canCheckEvmBuyer =
      Boolean(buyerEvmAddress) &&
      Boolean(normalizedBuyerChainContext?.startsWith("eip155:"));

    if (!buyerAddress && !canCheckEvmBuyer) {
      return NextResponse.json(skillSnapshot, {
        headers: {
          "Cache-Control": useLiveTrust
            ? PRIVATE_NO_STORE_CACHE_CONTROL
            : buildPublicCacheControl(
                PUBLIC_ROUTE_CACHE_SECONDS.skillDetail,
                PUBLIC_ROUTE_STALE_SECONDS.skillDetail
              ),
        },
      });
    }

    if (canCheckEvmBuyer && buyerEvmAddress && normalizedBuyerChainContext) {
      const buyerHasPurchased = priceUsdcMicros
        ? await hasChainUsdcPurchaseEntitlement(skillDbId, {
            buyerChainContext: normalizedBuyerChainContext,
            buyerAddress: buyerEvmAddress,
          }).catch(() => false)
        : false;

      return NextResponse.json(
        {
          ...skillSnapshot,
          buyerHasPurchased,
          buyerPurchaseSummary: null,
        },
        {
          headers: {
            "Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL,
          },
        }
      );
    }

    const preflightContext = await createPurchasePreflightContext({
      rpc,
      buyer: buyerAddress,
      usdcMint: address(getConfiguredUsdcMint()),
      authors:
        skillSnapshot.author_pubkey && isAddress(skillSnapshot.author_pubkey)
          ? [address(skillSnapshot.author_pubkey)]
          : [],
    });
    const preflight = serializePurchasePreflight(
      assessPurchasePreflight({
        context: preflightContext,
        priceUsdcMicros: priceUsdcMicros ? BigInt(priceUsdcMicros) : 0n,
        author:
          skillSnapshot.author_pubkey && isAddress(skillSnapshot.author_pubkey)
            ? address(skillSnapshot.author_pubkey)
            : null,
        authorBackingUsdcMicros:
          skillSnapshot.on_chain_address && priceUsdcMicros
            ? BigInt(skillSnapshot.author_trust?.totalStakeAtRisk ?? 0)
            : null,
      })
    );
    const buyerHasPurchased = buyerAddress
      ? priceUsdcMicros
        ? skillSnapshot.on_chain_address
          ? await hasOnChainPurchase(
              String(buyerAddress),
              String(skillSnapshot.on_chain_address)
            ).catch(() => false)
          : await hasUsdcPurchaseEntitlement(
              skillDbId,
              String(buyerAddress)
            ).catch(() => false)
        : paymentFlow === "legacy-sol" && skillSnapshot.on_chain_address
        ? await hasOnChainPurchase(
            String(buyerAddress),
            String(skillSnapshot.on_chain_address)
          ).catch(() => false)
        : false
      : false;
    const buyerPurchaseSummary =
      buyerAddress && buyerHasPurchased
        ? await getUsdcPurchaseEntitlementSummary(
            skillDbId,
            String(buyerAddress)
          ).catch(() => null)
        : null;
    return NextResponse.json(
      {
        ...skillSnapshot,
        buyerHasPurchased,
        buyerPurchaseSummary,
        ...preflight,
      },
      {
        headers: {
          "Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL,
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
    const { auth, on_chain_address, baseListing } = body as {
      auth?: AuthPayload;
      on_chain_address?: string;
      baseListing?: {
        txHash?: string;
        relinkExisting?: boolean;
        authorAddress?: string;
        chainContext?: string;
        expectedPriceUsdcMicros?: string;
      };
    };

    if (baseListing) {
      const submittedChainContext = normalizeInputChainContext(
        baseListing.chainContext
      );
      if (submittedChainContext !== BASE_SEPOLIA_CHAIN_CONTEXT) {
        return NextResponse.json(
          { error: "Base listings must use Base Sepolia" },
          { status: 400 }
        );
      }
      const relinkExisting = baseListing.relinkExisting === true;
      if (!baseListing.txHash && !relinkExisting) {
        return NextResponse.json(
          {
            error:
              "Missing required field: baseListing.txHash unless relinkExisting is true",
          },
          { status: 400 }
        );
      }

      const rows = await sql()<BaseSkillListingRow>`
        SELECT
          id,
          skill_id,
          author_pubkey,
          name,
          description,
          price_usdc_micros::text,
          currency_mint,
          chain_context,
          on_chain_protocol_version,
          on_chain_program_id,
          evm_listing_id,
          evm_contract_address
        FROM skills
        WHERE id = ${id}::uuid
      `;
      const row = rows[0];
      if (!row) {
        return NextResponse.json({ error: "Skill not found" }, { status: 404 });
      }

      // Parity with the Solana PATCH path (Bugbot #78): linking on-chain state to a repo row
      // requires proof of wallet control, not just a public UUID + the stored author address.
      // All written fields are still chain-verified below; this gates who can trigger the sync.
      if (!auth) {
        return NextResponse.json(
          {
            error:
              "Base listing linking requires wallet signature auth (auth payload missing).",
          },
          { status: 401 }
        );
      }
      const evmAuthVerification = await verifyEvmWalletSignature(auth);
      if (!evmAuthVerification.valid || !evmAuthVerification.pubkey) {
        return NextResponse.json(
          { error: evmAuthVerification.error || "Invalid signature" },
          { status: 401 }
        );
      }
      if (
        !row.author_pubkey ||
        evmAuthVerification.pubkey !== row.author_pubkey.toLowerCase()
      ) {
        return NextResponse.json(
          { error: "Only the Base skill author can link this listing" },
          { status: 403 }
        );
      }
      if (
        normalizeInputChainContext(row.chain_context) !==
        BASE_SEPOLIA_CHAIN_CONTEXT
      ) {
        return NextResponse.json(
          { error: "Base listings can only be linked to Base Sepolia skills" },
          { status: 400 }
        );
      }
      if (
        !row.author_pubkey ||
        !isEvmAddress(row.author_pubkey) ||
        !baseListing.authorAddress ||
        !isEvmAddress(baseListing.authorAddress) ||
        getEvmAddress(row.author_pubkey) !==
          getEvmAddress(baseListing.authorAddress)
      ) {
        return NextResponse.json(
          { error: "Not the Base skill author" },
          { status: 403 }
        );
      }

      const verification = await verifyBaseSkillListing({
        skill: row,
        txHash: baseListing.txHash ?? null,
        authorAddress: baseListing.authorAddress,
        expectedPriceUsdcMicros: relinkExisting
          ? null
          : baseListing.expectedPriceUsdcMicros ?? null,
        expectedUri: getCanonicalSkillRawUrl(id),
      });

      const [updated] = await sql()<SkillRow>`
        UPDATE skills
        SET
          chain_context = ${verification.chainContext},
          on_chain_address = NULL,
          price_usdc_micros = ${verification.priceUsdcMicros},
          currency_mint = ${
            verification.priceUsdcMicros ? verification.currencyMint : null
          },
          on_chain_protocol_version = ${verification.protocolVersion},
          on_chain_program_id = ${verification.onChainProgramId},
          evm_listing_id = ${verification.listingId},
          evm_contract_address = ${verification.onChainProgramId.toLowerCase()},
          evm_tx_hash = COALESCE(${verification.txHash}, evm_tx_hash),
          updated_at = NOW()
        WHERE id = ${id}::uuid
        RETURNING *
      `;

      return NextResponse.json({
        ...updated,
        chain_context: normalizePersistedChainContext(updated.chain_context),
      });
    }

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
    if (
      !rows[0].author_pubkey ||
      rows[0].author_pubkey !== verification.pubkey
    ) {
      return NextResponse.json(
        { error: "Not the skill author" },
        { status: 403 }
      );
    }

    const listing = await getOnChainUsdcPrice(on_chain_address, {
      useCache: false,
    });
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
