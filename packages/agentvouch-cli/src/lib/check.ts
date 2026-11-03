import { stat } from "node:fs/promises";
import path from "node:path";
import { collectSkillTreeFromPath } from "./archive.js";
import { CliError } from "./errors.js";
import type { AgentVouchApiClient, CheckRequestBody } from "./http.js";

export type CheckVerdict = "allow" | "review" | "avoid";
export type CheckFailOn = CheckVerdict | "none";

/** Exit code used when the verdict meets or exceeds `--fail-on`. */
export const CHECK_BLOCKED_EXIT_CODE = 2;

const VERDICT_RANK: Record<CheckVerdict, number> = {
  allow: 0,
  review: 1,
  avoid: 2,
};

export function parseCheckFailOn(value: string): CheckFailOn {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "allow" ||
    normalized === "review" ||
    normalized === "avoid" ||
    normalized === "none"
  ) {
    return normalized;
  }
  throw new Error("Expected --fail-on to be one of: review, avoid, none.");
}

/**
 * True when the verdict should block an install. Unknown verdicts block
 * whenever blocking is enabled at all: a pre-install gate must fail closed.
 */
export function shouldBlockInstall(
  verdict: unknown,
  failOn: CheckFailOn
): boolean {
  if (failOn === "none") return false;
  if (verdict !== "allow" && verdict !== "review" && verdict !== "avoid") {
    return true;
  }
  return VERDICT_RANK[verdict] >= VERDICT_RANK[failOn];
}

export interface CheckTargetInput {
  target?: string;
  skill?: string;
  hash?: string;
}

/**
 * Build the POST /api/check body. Exactly one target kind is allowed:
 * a local path (file or skill folder), `--skill <id|slug>`, or `--hash`.
 */
export async function buildCheckRequest(
  input: CheckTargetInput
): Promise<{ body: CheckRequestBody; source: string }> {
  const kinds = [input.target, input.skill, input.hash].filter(
    (value) => typeof value === "string" && value.trim() !== ""
  );
  if (kinds.length !== 1) {
    throw new CliError(
      "Provide exactly one of: a local <path>, --skill <id>, or --hash <tree_hash>."
    );
  }

  if (input.skill) {
    return { body: { skill: input.skill.trim() }, source: "registry" };
  }
  if (input.hash) {
    return { body: { tree_hash: input.hash.trim() }, source: "tree_hash" };
  }

  const absolute = path.resolve(input.target as string);
  const fileStat = await stat(absolute).catch(() => null);
  if (!fileStat) {
    throw new CliError(
      `No file or folder at "${input.target}". Use --skill <id> to check a registry skill.`
    );
  }

  const files = await collectSkillTreeFromPath(
    absolute,
    fileStat.isDirectory()
  );
  return {
    body: {
      files: files.map((file) => ({
        path: file.path,
        content: file.content.toString("utf8"),
      })),
    },
    source: fileStat.isDirectory() ? "local-tree" : "local-file",
  };
}

export interface CheckSkillResult {
  source: string;
  recommended_action: string;
  tree_hash: string | null;
  blocked: boolean;
  fail_on: CheckFailOn;
  signals: Array<{ id: string; label: string; status: string; detail: string }>;
  disclaimer?: string;
}

export async function checkSkill(
  api: AgentVouchApiClient,
  input: CheckTargetInput & { failOn: CheckFailOn }
): Promise<CheckSkillResult> {
  const { body, source } = await buildCheckRequest(input);
  const response = await api.check(body);
  return {
    source,
    recommended_action: String(response.recommended_action ?? "unknown"),
    tree_hash: response.tree_hash ?? null,
    blocked: shouldBlockInstall(response.recommended_action, input.failOn),
    fail_on: input.failOn,
    signals: Array.isArray(response.signals) ? response.signals : [],
    disclaimer: response.disclaimer,
  };
}

export function formatCheckResult(result: CheckSkillResult): string[] {
  return [
    ...(result.blocked
      ? [
          `Install blocked: recommended_action is "${result.recommended_action}" (--fail-on ${result.fail_on}).`,
        ]
      : []),
    `recommended_action: ${result.recommended_action}`,
    `source: ${result.source}`,
    ...(result.tree_hash ? [`tree_hash: ${result.tree_hash}`] : []),
    ...result.signals.map(
      (signal) => `[${signal.status}] ${signal.label}: ${signal.detail}`
    ),
    ...(result.disclaimer ? [`note: ${result.disclaimer}`] : []),
  ];
}
