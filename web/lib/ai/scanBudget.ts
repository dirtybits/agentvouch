import { sql } from "@/lib/db";

// Durable, cross-instance spend cap for model-backed scans. Both the open-world
// /api/check path and the publish-time background scan draw from these counters,
// so neither a request flood nor a flood of free publishes can run up unbounded
// model spend.
const DAILY_GENERATION_LIMIT = Number(
  process.env.AI_SCAN_DAILY_GENERATION_LIMIT ?? 200
);
const MONTHLY_GENERATION_LIMIT = Number(
  process.env.AI_SCAN_MONTHLY_GENERATION_LIMIT ?? 2000
);

export type ScanBudgetReservation =
  | { ok: true }
  | {
      ok: false;
      reason: "daily_scan_budget_exhausted" | "monthly_scan_budget_exhausted";
    };

// Atomically reserve one model-scan unit against the daily and monthly budgets.
// Backed by reserve_ai_scan_budget() (advisory-locked + FOR UPDATE) so it is
// race-free across serverless instances.
export async function reserveScanBudget(): Promise<ScanBudgetReservation> {
  if (!Number.isFinite(DAILY_GENERATION_LIMIT) || DAILY_GENERATION_LIMIT <= 0) {
    return { ok: false, reason: "daily_scan_budget_exhausted" };
  }
  if (
    !Number.isFinite(MONTHLY_GENERATION_LIMIT) ||
    MONTHLY_GENERATION_LIMIT <= 0
  ) {
    return { ok: false, reason: "monthly_scan_budget_exhausted" };
  }

  const rows = await sql()<{
    ok: boolean;
    reason: string | null;
  }>`
    SELECT ok, reason
    FROM reserve_ai_scan_budget(
      ${DAILY_GENERATION_LIMIT}::integer,
      ${MONTHLY_GENERATION_LIMIT}::integer
    )
  `;
  const row = rows[0];
  if (row?.ok) {
    return { ok: true };
  }
  if (row?.reason === "daily_scan_budget_exhausted") {
    return { ok: false, reason: "daily_scan_budget_exhausted" };
  }
  return { ok: false, reason: "monthly_scan_budget_exhausted" };
}

// Refund a reserved unit when the model call fails or turned out to be
// unnecessary (e.g. another request generated the scan first), so transient
// errors and cache races do not permanently erode the cap. Best-effort: a failed
// release is logged, never thrown.
export async function releaseScanBudget(): Promise<void> {
  try {
    await sql()`SELECT release_ai_scan_budget()`;
  } catch (error) {
    console.error(
      "[ai-scan] failed to release reserved budget:",
      (error as Error)?.message ?? error
    );
  }
}
