// Backfill AI one-liners for repo-backed skills (current version content).
// Run from web/ with env loaded:
//   node --env-file=.env.local --import tsx ./scripts/backfill-skill-summaries.ts [limit]
// Cost-safe + free-tier friendly: prints the count, skips skills whose summary is
// already current (cache hit, no model call), paces generations to stay under the
// free-tier rate limit, and backs off on 429s.
//   DELAY_MS  inter-generation delay (default 12000)

import { sql, initializeDatabase } from "@/lib/db";
import { ensureSkillSummary } from "@/lib/ai/summarize";

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

async function withRateLimitRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
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
  }>`
    SELECT s.id, s.name, s.current_version, sv.content
    FROM skills s
    JOIN LATERAL (
      SELECT content
      FROM skill_versions
      WHERE skill_id = s.id
      ORDER BY version DESC
      LIMIT 1
    ) sv ON true
    WHERE sv.content IS NOT NULL AND length(sv.content) > 0
    ORDER BY s.updated_at DESC
    LIMIT ${limit}
  `;

  console.log(
    `Found ${rows.length} skill(s) with content; processing up to ${limit} (pace ${DELAY_MS}ms between generations).`
  );
  let generated = 0;
  let cached = 0;
  let skipped = 0;
  for (const r of rows) {
    const res = await withRateLimitRetry(
      () =>
        ensureSkillSummary(r.id, r.content as string, {
          expectedVersion: r.current_version,
        }),
      r.name
    );
    if (res.generated) generated += 1;
    if (res.cached) cached += 1;
    if (res.skipped) skipped += 1;
    console.log(
      `${res.generated ? "GEN " : res.skipped ? "SKIP" : "HIT "} ${r.name
        .slice(0, 38)
        .padEnd(38)} → ${
        res.summary?.slice(0, 90) ?? "(none)"
      }`
    );
    // Only pace after a real model call; cache hits fly through.
    if (res.generated) await sleep(DELAY_MS);
  }
  console.log(
    `Done. generated=${generated} cached=${cached} skipped=${skipped}`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
