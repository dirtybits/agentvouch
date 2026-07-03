import { NextResponse } from "next/server";
import { initializeDatabase, sql } from "@/lib/db";
import {
  buildPublicCacheControl,
  PUBLIC_ROUTE_CACHE_SECONDS,
  PUBLIC_ROUTE_STALE_SECONDS,
} from "@/lib/cachePolicy";
import { getErrorMessage } from "@/lib/errors";
import { getSkillPaymentFlow } from "@/lib/listingContract";

type RepoListingActivityRow = {
  id: string;
  skill_id: string;
  public_slug: string;
  public_author_slug: string;
  name: string;
  author_pubkey: string | null;
  on_chain_address: string | null;
  price_usdc_micros: string | null;
  currency_mint: string | null;
  on_chain_protocol_version: string | null;
  on_chain_program_id: string | null;
  chain_context: string | null;
  created_at: string;
};

type UsdcPurchaseActivityRow = {
  payment_tx_signature: string;
  buyer_pubkey: string;
  currency_mint: string;
  amount_micros: string;
  verified_at: string;
  skill_db_id: string;
  skill_id: string;
  public_slug: string;
  public_author_slug: string;
  skill_name: string;
  author_pubkey: string | null;
  on_chain_address: string | null;
  price_usdc_micros: string | null;
  payment_flow: string | null;
  protocol_version: string | null;
  on_chain_program_id: string | null;
  chain_context: string | null;
  purchase_pda: string | null;
};

export async function GET() {
  try {
    await initializeDatabase();

    const [repoListings, usdcPurchases] = await Promise.all([
      sql()<RepoListingActivityRow>`
        SELECT
          id,
          skill_id,
          public_slug,
          public_author_slug,
          name,
          author_pubkey,
          on_chain_address,
          price_usdc_micros,
          currency_mint,
          on_chain_protocol_version,
          on_chain_program_id,
          chain_context,
          created_at::text AS created_at
        FROM skills
        ORDER BY created_at DESC
        LIMIT 20
      `,
      sql()<UsdcPurchaseActivityRow>`
        SELECT
          r.payment_tx_signature,
          r.buyer_pubkey,
          r.currency_mint,
          r.amount_micros::text AS amount_micros,
          r.verified_at::text AS verified_at,
          s.id AS skill_db_id,
          s.skill_id,
          s.public_slug,
          s.public_author_slug,
          s.name AS skill_name,
          s.author_pubkey,
          s.on_chain_address,
          s.price_usdc_micros,
          r.payment_flow,
          r.protocol_version,
          r.on_chain_program_id,
          r.chain_context,
          r.purchase_pda
        FROM usdc_purchase_receipts r
        INNER JOIN skills s
          ON s.id = r.skill_db_id
        WHERE r.payment_flow IS DISTINCT FROM 'stripe-mpp-offchain'
        ORDER BY r.verified_at DESC
        LIMIT 20
      `,
    ]);

    return NextResponse.json(
      {
        repoListings: repoListings.map((skill) => ({
          ...skill,
          payment_flow: getSkillPaymentFlow({
            priceUsdcMicros: skill.price_usdc_micros,
            onChainAddress: skill.on_chain_address,
          }),
        })),
        usdcPurchases,
      },
      {
        headers: {
          "Cache-Control": buildPublicCacheControl(
            PUBLIC_ROUTE_CACHE_SECONDS.skillsList,
            PUBLIC_ROUTE_STALE_SECONDS.skillsList
          ),
        },
      }
    );
  } catch (error: unknown) {
    console.error("GET /api/skills/activity error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
