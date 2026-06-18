// CLI wrapper over the mirror engine (lib/mirror/sync.ts). Used for the initial
// seed and for manual/ad-hoc syncs; the daily automated run is the Vercel cron
// at app/api/cron/mirror-skills/route.ts. Same engine, so behavior matches.
//
// Run from web/ with env loaded:
//   Dry run (default, no writes):
//     node --env-file=.env.local --import tsx ./scripts/mirror-skills.ts
//   Apply to the configured DATABASE_URL:
//     node --env-file=.env.local --import tsx ./scripts/mirror-skills.ts --apply
//   Flags:
//     --source <key>   limit to one source (e.g. anthropic | openai); repeatable
//     --skip-review    skip AI summary/scan generation (apply only)

import { initializeDatabase } from "@/lib/db";
import { syncMirrorSkills, type SkillOutcome } from "@/lib/mirror/sync";
import { MIRROR_SOURCES } from "@/lib/mirror/sources";

const APPLY = process.argv.includes("--apply");
const SKIP_REVIEW = process.argv.includes("--skip-review");

function sourceKeys(): string[] | undefined {
  const keys: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === "--source" && process.argv[i + 1]) {
      keys.push(process.argv[i + 1]);
    }
  }
  return keys.length ? keys : undefined;
}

const ICON: Record<SkillOutcome["action"], string> = {
  create: "+",
  update: "^",
  unchanged: "=",
  skip: "-",
  error: "!",
};

async function main() {
  const keys = sourceKeys();
  const selected = keys ?? MIRROR_SOURCES.map((s) => s.key);
  console.log(
    `\nMirror sources: ${selected.join(", ")}` +
      `\nMode: ${
        APPLY ? "APPLY (writes to DATABASE_URL)" : "DRY RUN (no writes)"
      }` +
      `${SKIP_REVIEW ? " [skip-review]" : ""}`
  );

  if (APPLY) await initializeDatabase();

  const result = await syncMirrorSkills({
    apply: APPLY,
    sourceKeys: keys,
    skipReview: SKIP_REVIEW,
    log: (m) => console.log(m),
  });

  console.log("\nResults:");
  for (const o of result.outcomes) {
    const size = o.treeBytes ? `${(o.treeBytes / 1024).toFixed(0)}KB` : "";
    const extra =
      o.detail ??
      [
        o.license,
        o.version ? `v${o.version}` : "",
        size,
        o.name ? `→ ${o.name}` : "",
      ]
        .filter(Boolean)
        .join("  ");
    console.log(
      `  ${ICON[o.action]} ${o.source}/${o.skillId.padEnd(
        34
      )} ${o.action.padEnd(9)} ${extra}`
    );
  }

  const c = result.counts;
  console.log(
    `\n${APPLY ? "Applied" : "Dry run"}: create=${c.create} update=${
      c.update
    }` + ` unchanged=${c.unchanged} skip=${c.skip} error=${c.error}`
  );
  if (!APPLY && c.create + c.update > 0) {
    console.log("Re-run with --apply to write to the configured DATABASE_URL.");
  }
  process.exit(c.error > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
