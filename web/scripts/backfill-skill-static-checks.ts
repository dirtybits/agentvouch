// Backfill static checks (web/lib/skillStaticChecks.ts) for the current
// version of every skill. New publishes, new versions, and mirror syncs run the
// checks on their own; this script covers versions stored before that.
//
// Run from web/ with env loaded:
//   npx tsx --env-file=.env.local ./scripts/backfill-skill-static-checks.ts
//       Dry run: reads stored trees and prints results. No writes.
//   npx tsx --env-file=.env.local ./scripts/backfill-skill-static-checks.ts --apply
//       Writes missing rows to skill_static_checks (cached rows are kept).
// Options: --limit <n> to process only the n most recently updated skills.
//
// The script never uses the public download routes, so it records no
// download events.

import { initializeDatabase, sql } from "@/lib/db";
import {
  getFilesForVersion,
  type StoredSkillVersionRef,
} from "@/lib/skillStorage";
import {
  countFindingsBySeverity,
  runStaticChecks,
  STATIC_CHECKS_VERSION,
} from "@/lib/skillStaticChecks";
import { ensureStaticChecks } from "@/lib/skillStaticChecksStore";

function databaseHost(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? "").host || "(unset)";
  } catch {
    return "(invalid DATABASE_URL)";
  }
}

function parseLimit(args: string[]): number | null {
  const index = args.indexOf("--limit");
  if (index < 0) return null;
  const limit = Number(args[index + 1]);
  if (!Number.isInteger(limit) || limit <= 0) {
    console.error("--limit needs a positive integer");
    process.exit(2);
  }
  return limit;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const limit = parseLimit(args);

  console.log(`Database host: ${databaseHost()}`);
  console.log(
    apply
      ? `Mode: apply (writes skill_static_checks, ${STATIC_CHECKS_VERSION})`
      : "Mode: dry run (no writes; pass --apply to write)"
  );
  // The initializer creates skill_static_checks. Only apply mode needs it.
  if (apply) await initializeDatabase();

  const rows = await sql()<{
    name: string;
    content: string | null;
    files: unknown;
    tree_hash: string;
    storage_backend: string | null;
  }>`
    SELECT s.name, sv.content, sv.files, sv.tree_hash, sv.storage_backend
    FROM skills s
    JOIN LATERAL (
      SELECT content, files, tree_hash, storage_backend
      FROM skill_versions
      WHERE skill_id = s.id
      ORDER BY version DESC
      LIMIT 1
    ) sv ON true
    WHERE sv.tree_hash IS NOT NULL
    ORDER BY s.updated_at DESC
    LIMIT ${limit ?? 1_000_000}
  `;
  console.log(`Found ${rows.length} skill(s) with a current tree hash.`);

  const done = new Set<string>();
  let written = 0;
  let cached = 0;
  let withMedium = 0;
  let failed = 0;
  for (const row of rows) {
    if (done.has(row.tree_hash)) continue;
    done.add(row.tree_hash);
    const label = row.name.slice(0, 38).padEnd(38);
    try {
      const versionRef = {
        content: row.content ?? "",
        files: (row.files as StoredSkillVersionRef["files"]) ?? null,
        tree_hash: row.tree_hash,
        storage_backend: row.storage_backend,
      } satisfies StoredSkillVersionRef;
      const files = await getFilesForVersion(versionRef);
      let report;
      let state = "DRY ";
      if (apply) {
        const result = await ensureStaticChecks(row.tree_hash, files);
        report = result.report;
        state = result.cached ? "HIT " : "NEW ";
        if (result.cached) cached += 1;
        else written += 1;
      } else {
        report = runStaticChecks(files);
      }
      const counts = countFindingsBySeverity(report);
      if (counts.medium > 0) withMedium += 1;
      console.log(
        `${state} ${label} → medium ${counts.medium}, low ${counts.low}, info ${counts.info}`
      );
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${label} → ${(error as Error)?.message ?? error}`);
    }
  }

  console.log(
    `Done. trees=${done.size} written=${written} cached=${cached} with_medium=${withMedium} failed=${failed}`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
