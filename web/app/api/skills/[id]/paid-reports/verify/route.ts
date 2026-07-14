import { NextRequest, NextResponse } from "next/server";
import {
  verifyAndIndexBasePaidPurchaseReport,
  type PaidReportSkillRow,
} from "@/lib/basePaidPurchaseReportVerification";
import { initializeDatabase, sql } from "@/lib/db";

const PRIVATE_NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

type VerifyPaidReportBody = {
  txHash?: unknown;
  purchaseId?: unknown;
};

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

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

// This endpoint is intentionally public and idempotent: it cannot create a report or move funds.
// It only indexes immutable metadata after re-verifying the exact on-chain event, deployment,
// append-only purchase receipt, purchase lane, and fresh report state.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await initializeDatabase();

  let body: VerifyPaidReportBody;
  try {
    body = (await request.json()) as VerifyPaidReportBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
  const txHash = stringOrNull(body.txHash);
  const purchaseId = stringOrNull(body.purchaseId);
  if (!txHash || !purchaseId) {
    return NextResponse.json(
      { error: "txHash and purchaseId are required" },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }

  const skill = await fetchSkill(id);
  if (!skill) {
    return NextResponse.json(
      { error: "Skill not found" },
      { status: 404, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }

  try {
    const result = await verifyAndIndexBasePaidPurchaseReport({
      skill,
      txHash,
      purchaseId,
    });
    return NextResponse.json(
      { ok: true, report: result },
      { headers: PRIVATE_NO_STORE_HEADERS }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Paid-purchase report verification failed";
    console.warn(
      `[paid-report-verify] failed skill=${id} purchase=${purchaseId} tx=${txHash} reason=${message}`
    );
    const status = /conflict/i.test(message) ? 409 : 400;
    return NextResponse.json(
      { error: message },
      { status, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
}
