import { sql } from "@/lib/db";
import {
  parseStaticCheckReport,
  runStaticChecks,
  STATIC_CHECKS_VERSION,
  type StaticCheckFile,
  type StaticCheckReport,
} from "@/lib/skillStaticChecks";

// Static check reports are content-addressed: one row per (tree_hash,
// checks_version) in skill_static_checks, like skill_scans. The caller must
// pass the files of that tree.

export async function getCachedStaticChecks(
  treeHash: string
): Promise<StaticCheckReport | null> {
  const rows = await sql()<{ report: unknown }>`
    SELECT report
    FROM skill_static_checks
    WHERE tree_hash = ${treeHash}
      AND checks_version = ${STATIC_CHECKS_VERSION}
    LIMIT 1
  `;
  return rows[0] ? parseStaticCheckReport(rows[0].report) : null;
}

export async function ensureStaticChecks(
  treeHash: string,
  files: ReadonlyArray<StaticCheckFile>
): Promise<{ report: StaticCheckReport; cached: boolean }> {
  const cached = await getCachedStaticChecks(treeHash);
  if (cached) return { report: cached, cached: true };

  const report = runStaticChecks(files);
  await sql()`
    INSERT INTO skill_static_checks (tree_hash, checks_version, report)
    VALUES (
      ${treeHash},
      ${STATIC_CHECKS_VERSION},
      ${JSON.stringify(report)}::jsonb
    )
    ON CONFLICT (tree_hash, checks_version) DO NOTHING
  `;
  return { report, cached: false };
}

/** Best effort: a failure is logged and never blocks a publish or sync. */
export async function runStaticChecksSafe(
  treeHash: string,
  files: ReadonlyArray<StaticCheckFile>
): Promise<void> {
  try {
    await ensureStaticChecks(treeHash, files);
  } catch (error) {
    console.error(
      `[static-checks] failed for ${treeHash}:`,
      (error as Error)?.message ?? error
    );
  }
}
