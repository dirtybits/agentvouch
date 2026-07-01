// Backfill a skill's full automated review — capability summary ("what it does")
// AND advisory security scan — for repo-backed skills (current version).
// Run from web/ with env loaded:
//   node --env-file=.env.local --import tsx ./scripts/backfill-skill-review.ts [limit]
// Cost-safe + cache-aware: both ensureSkillSummary and ensureSkillScan no-op on a
// cache hit (no model call). Paces only after a real generation and backs off on
// 429s. Supersedes running backfill-skill-summaries.ts + backfill-skill-scans.ts
// separately. The two passes stay independent (separate prompts/cache/budget);
// this only runs them together.
//   DELAY_MS  inter-generation delay (default 12000)

import { sql, initializeDatabase } from "@/lib/db";
import { ensureSkillSummary } from "@/lib/ai/summarize";
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

  const rows = await sql()<{
    id: string;
    name: string;
    current_version: number;
    content: string | null;
    files: unknown;
    tree_hash: string | null;
    storage_backend: string | null;
  }>`
    SELECT s.id, s.name, s.current_version,
           sv.content, sv.files, sv.tree_hash, sv.storage_backend
    FROM skills s
    JOIN LATERAL (
      SELECT content, files, tree_hash, storage_backend
      FROM skill_versions
      WHERE skill_id = s.id
      ORDER BY version DESC
      LIMIT 1
    ) sv ON true
    WHERE sv.content IS NOT NULL OR sv.tree_hash IS NOT NULL
    ORDER BY s.updated_at DESC
    LIMIT ${limit}
  `;

  console.log(
    `Found ${rows.length} skill(s); processing up to ${limit} (pace ${DELAY_MS}ms after a real generation).`
  );
  let sumGen = 0;
  let scanGen = 0;
  let failed = 0;

  for (const r of rows) {
    const label = r.name.slice(0, 34).padEnd(34);
    let didGenerate = false;
    const parts: string[] = [];

    // Capability summary (SKILL.md-only, cheap).
    if (r.content && r.content.length > 0) {
      try {
        const res = await withRateLimitRetry(
          () =>
            ensureSkillSummary(r.id, r.content as string, {
              expectedVersion: r.current_version,
            }),
          `${r.name} (summary)`
        );
        if (res.generated) {
          sumGen += 1;
          didGenerate = true;
        }
        parts.push(`sum:${res.generated ? "GEN" : "hit"}`);
      } catch (e) {
        failed += 1;
        parts.push(`sum:FAIL(${(e as Error)?.message ?? e})`);
      }
    } else {
      parts.push("sum:—");
    }

    // Advisory security scan (whole tree, budget-/cache-tuned).
    if (r.tree_hash) {
      try {
        const versionRef = {
          content: r.content ?? "",
          files: (r.files as StoredSkillVersionRef["files"]) ?? null,
          tree_hash: r.tree_hash,
          storage_backend: r.storage_backend,
        } satisfies StoredSkillVersionRef;
        const files = await getFilesForVersion(versionRef);
        const res = await withRateLimitRetry(
          () => ensureSkillScan(r.tree_hash as string, files),
          `${r.name} (scan)`
        );
        if (res.generated) {
          scanGen += 1;
          didGenerate = true;
        }
        parts.push(`scan:${res.generated ? "GEN" : "hit"}=${res.verdict}`);
      } catch (e) {
        failed += 1;
        parts.push(`scan:FAIL(${(e as Error)?.message ?? e})`);
      }
    } else {
      parts.push("scan:—");
    }

    console.log(`${label} → ${parts.join(" | ")}`);
    if (didGenerate) await sleep(DELAY_MS);
  }

  console.log(
    `Done. summaries generated=${sumGen} scans generated=${scanGen} failed=${failed}`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
