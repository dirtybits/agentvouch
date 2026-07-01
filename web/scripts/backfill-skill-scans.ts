// Backfill AI security scans for repo-backed skills (current version tree).
// Run from web/ with env loaded:
//   npx tsx --env-file=.env.local ./scripts/backfill-skill-scans.ts [limit]
// Cost-safe + cache-aware: ensureSkillScan no-ops on a cache hit (no model
// call), paces real generations to stay under rate limits, and backs off on
// 429s. Mirrors backfill-skill-summaries.ts.
//   DELAY_MS  inter-generation delay (default 12000)

import { sql, initializeDatabase } from "@/lib/db";
import { ensureSkillScan } from "@/lib/ai/scan";
import {
  getFilesForVersion,
  type StoredSkillVersionRef,
} from "@/lib/skillStorage";

const DELAY_MS = Number(process.env.DELAY_MS ?? 12_000);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRateLimit(e: unknown): boolean {
  const err = e as { statusCode?: number; message?: string } | undefined;
  return (
    err?.statusCode === 429 ||
    /rate.?limit/i.test(err?.message ?? "") ||
    /rate_limit/i.test(JSON.stringify((e as { data?: unknown })?.data ?? ""))
  );
}

async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  label: string
): Promise<T> {
  let delay = 30_000;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      if (isRateLimit(e) && attempt < 3) {
        console.log(`  rate-limited — backing off ${delay / 1000}s (${label})`);
        await sleep(delay);
        delay *= 2;
      } else {
        throw e;
      }
    }
  }
}

async function main() {
  await initializeDatabase();
  const limit = Number(process.argv[2] ?? process.env.LIMIT ?? 1);

  // Scans key on the current version's tree_hash, so only rows with one are
  // scannable (matches the detail route's scan JOIN). Newest first.
  const rows = await sql()<{
    id: string;
    name: string;
    content: string | null;
    files: unknown;
    tree_hash: string;
    storage_backend: string | null;
  }>`
    SELECT s.id, s.name, sv.content, sv.files, sv.tree_hash, sv.storage_backend
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
    LIMIT ${limit}
  `;

  console.log(
    `Found ${rows.length} scannable skill(s); processing up to ${limit} (pace ${DELAY_MS}ms between scans).`
  );
  let generated = 0;
  let cached = 0;
  let failed = 0;
  for (const r of rows) {
    const label = r.name.slice(0, 38).padEnd(38);
    try {
      const versionRef = {
        content: r.content ?? "",
        files: (r.files as StoredSkillVersionRef["files"]) ?? null,
        tree_hash: r.tree_hash,
        storage_backend: r.storage_backend,
      } satisfies StoredSkillVersionRef;
      const files = await getFilesForVersion(versionRef);
      const res = await withRateLimitRetry(
        () => ensureSkillScan(r.tree_hash, files),
        r.name
      );
      if (res.generated) generated += 1;
      if (res.cached) cached += 1;
      const n = res.findings?.length ?? 0;
      console.log(
        `${res.generated ? "GEN " : "HIT "} ${label} → ${res.verdict}${
          res.truncated ? " (truncated)" : ""
        }, ${n} finding(s)`
      );
      // Only pace after a real model call; cache hits fly through.
      if (res.generated) await sleep(DELAY_MS);
    } catch (e) {
      failed += 1;
      console.error(`FAIL ${label} → ${(e as Error)?.message ?? e}`);
    }
  }
  console.log(`Done. generated=${generated} cached=${cached} failed=${failed}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
