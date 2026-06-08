import { generateSummarySafe } from "@/lib/ai/summarize";
import { runScanSafe } from "@/lib/ai/scan";
import type { SkillFileWithBytes } from "@/lib/skillStorage";

/**
 * One entry point for a skill's "automated review" — the capability summary
 * ("what it does") and the advisory security scan.
 *
 * It composes the two passes rather than merging their model call. They are
 * deliberately tuned differently and must stay that way:
 *   - the scan is a focused adversarial security reviewer over the whole file
 *     tree, cached by tree_hash, spend-budgeted, and (at /api/check) gated by a
 *     heuristic prefilter;
 *   - the summary is a cheap SKILL.md-only read cached by content hash.
 * Merging the call would dilute the security prompt and entangle two different
 * cache keys / cost models, so we keep them separate and just trigger together.
 *
 * Best-effort: each pass already swallows its own errors, and Promise.allSettled
 * guarantees one failing never blocks the other. Intended to run via `after()`.
 */
export async function runReviewSafe(args: {
  skillId: string;
  content: string;
  treeHash: string;
  files: SkillFileWithBytes[];
  expectedVersion: number;
}): Promise<void> {
  await Promise.allSettled([
    generateSummarySafe(args.skillId, args.content, {
      expectedVersion: args.expectedVersion,
    }),
    runScanSafe(args.treeHash, args.files),
  ]);
}
