import { NextRequest, NextResponse } from "next/server";
import {
  getBasePaidPurchaseReportContract,
  readBasePaidPurchaseReportPreflight,
  readBasePaidPurchaseReportState,
  type PaidReportSkillRow,
} from "@/lib/basePaidPurchaseReportVerification";
import { BASE_SEPOLIA_CHAIN_CONTEXT } from "@/lib/chains";
import { initializeDatabase, sql } from "@/lib/db";
import {
  requireBaseBytes32,
  requireBaseEvmAddress,
} from "@/lib/adapters/baseListing";
import { getEvmPaidPurchaseReportIndex } from "@/lib/usdcPurchases";

const PRIVATE_NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

async function fetchSkill(id: string): Promise<PaidReportSkillRow | null> {
  const rows = await sql()<PaidReportSkillRow>`
    SELECT
      id::text,
      chain_context,
      on_chain_protocol_version,
      on_chain_program_id,
      evm_listing_id,
      evm_contract_address
    FROM skills
    WHERE id = ${id}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await initializeDatabase();
  const skill = await fetchSkill(id);
  if (!skill) {
    return NextResponse.json(
      { error: "Skill not found" },
      { status: 404, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }

  try {
    const buyerAddress = requireBaseEvmAddress(
      request.nextUrl.searchParams.get("buyer") ?? "",
      "Buyer"
    );
    const purchaseId = requireBaseBytes32(
      request.nextUrl.searchParams.get("purchaseId") ?? "",
      "Paid report purchase id"
    );
    const contractAddress = getBasePaidPurchaseReportContract(skill);
    const preflight = await readBasePaidPurchaseReportPreflight({
      skill,
      buyerAddress,
      purchaseId,
    });
    const indexed = await getEvmPaidPurchaseReportIndex({
      skillDbId: id,
      chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
      contractAddress,
      buyerAddress,
      purchaseId,
    });
    if (!indexed) {
      return NextResponse.json(
        { preflight, report: null },
        { headers: PRIVATE_NO_STORE_HEADERS }
      );
    }

    const state = await readBasePaidPurchaseReportState({
      skill,
      reportId: indexed.reportId,
    });
    if (
      state.buyerAddress.toLowerCase() !== indexed.buyerAddress ||
      state.authorAddress.toLowerCase() !== indexed.authorAddress ||
      state.listingId.toLowerCase() !== indexed.listingId ||
      state.purchaseId.toLowerCase() !== indexed.purchaseId
    ) {
      throw new Error(
        "Indexed paid report identity does not match fresh on-chain state"
      );
    }

    return NextResponse.json(
      {
        preflight: {
          ...preflight,
          eligible: false,
          reason: "purchase-already-reported",
          requiresExactCallSimulation: false,
        },
        report: { index: indexed, state },
      },
      { headers: PRIVATE_NO_STORE_HEADERS }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Paid report lookup failed";
    return NextResponse.json(
      { error: message },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
}
