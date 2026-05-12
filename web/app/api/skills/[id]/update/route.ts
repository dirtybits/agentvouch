import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase, sql } from "@/lib/db";
import {
  buildPublicCacheControl,
  PUBLIC_ROUTE_CACHE_SECONDS,
  PUBLIC_ROUTE_STALE_SECONDS,
} from "@/lib/cachePolicy";
import { getErrorMessage } from "@/lib/errors";
import { getOnChainUsdcPrice } from "@/lib/onchain";
import {
  getSkillPaymentFlow,
  normalizeUsdcMicros,
  requiresPurchase,
} from "@/lib/listingContract";
import { getConfiguredUsdcMint } from "@/lib/x402";

type SkillRow = {
  id: string;
  skill_id: string;
  current_version: number;
  updated_at: string;
  on_chain_address: string | null;
  price_usdc_micros: string | null;
  currency_mint: string | null;
  on_chain_protocol_version?: string | null;
  on_chain_program_id?: string | null;
};

const CHAIN_PREFIX = "chain-";

function parseInstalledVersion(value: string | null): number | null {
  if (value === null || value === "") {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("installed_version must be a positive integer");
  }

  return parsed;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await initializeDatabase();
    if (id.startsWith(CHAIN_PREFIX)) {
      return NextResponse.json(
        { error: "Chain-only skills do not support version-aware updates" },
        { status: 400 }
      );
    }

    const source = request.nextUrl.searchParams.get("source");
    if (source && source !== "repo") {
      return NextResponse.json(
        { error: "Only repo-backed skills support version-aware updates" },
        { status: 400 }
      );
    }

    let installedVersion: number | null;
    try {
      installedVersion = parseInstalledVersion(
        request.nextUrl.searchParams.get("installed_version")
      );
    } catch (error: unknown) {
      return NextResponse.json(
        { error: getErrorMessage(error) },
        { status: 400 }
      );
    }
    const providedListing = request.nextUrl.searchParams.get("listing");

    const rows = await sql()<SkillRow>`
      SELECT
        id,
        skill_id,
        current_version,
        updated_at,
        on_chain_address,
        price_usdc_micros,
        currency_mint,
        on_chain_protocol_version,
        on_chain_program_id
      FROM skills
      WHERE id = ${id}::uuid
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    const skill = rows[0];
    const listing = skill.on_chain_address && !normalizeUsdcMicros(skill.price_usdc_micros)
      ? await getOnChainUsdcPrice(skill.on_chain_address)
      : null;
    const priceUsdcMicros =
      normalizeUsdcMicros(skill.price_usdc_micros) ??
      normalizeUsdcMicros(listing?.priceUsdcMicros);
    const paymentFlow = getSkillPaymentFlow({
      priceUsdcMicros,
      onChainAddress: skill.on_chain_address,
    });

    const status =
      installedVersion === null
        ? "unknown_installed_version"
        : installedVersion < skill.current_version
        ? "update_available"
        : "up_to_date";

    return NextResponse.json(
      {
        id: skill.id,
        skill_slug: skill.skill_id,
        source: "repo",
        status,
        installed_version: installedVersion,
        latest_version: skill.current_version,
        latest_updated_at: new Date(skill.updated_at).toISOString(),
        on_chain_address: skill.on_chain_address,
        price_lamports: 0,
        price_usdc_micros: priceUsdcMicros,
        currency_mint:
          priceUsdcMicros && !skill.currency_mint
            ? getConfiguredUsdcMint()
            : skill.currency_mint,
        on_chain_protocol_version: skill.on_chain_protocol_version ?? null,
        on_chain_program_id: skill.on_chain_program_id ?? null,
        payment_flow: paymentFlow,
        requires_purchase: requiresPurchase(paymentFlow),
        listing_changed:
          providedListing !== null && providedListing !== skill.on_chain_address,
      },
      {
        headers: {
          "Cache-Control": buildPublicCacheControl(
            PUBLIC_ROUTE_CACHE_SECONDS.skillDetail,
            PUBLIC_ROUTE_STALE_SECONDS.skillDetail
          ),
        },
      }
    );
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
