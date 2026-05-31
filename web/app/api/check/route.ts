import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase, sql } from "@/lib/db";
import {
  buildAgentTrustSummary,
  type AgentTrustSummary,
} from "@/lib/agentDiscovery";
import { resolveAgentIdentityByWallet } from "@/lib/agentIdentity";
import {
  ensureSkillScan,
  getCachedSkillScan,
  hasScanEscalationSignal,
  recordHeuristicReviewScan,
} from "@/lib/ai/scan";
import { PRIVATE_NO_STORE_CACHE_CONTROL } from "@/lib/cachePolicy";
import { getErrorMessage } from "@/lib/errors";
import {
  getFilesForVersion,
  prepareSkillTree,
  type SkillFileWithBytes,
  type SkillTreeInputFile,
  type StoredSkillVersionRef,
} from "@/lib/skillStorage";
import { MAX_SKILL_TREE_BYTES } from "@/lib/skillDraft";
import type { AuthorTrust } from "@/lib/trust";
import { resolveAuthorTrust } from "@/lib/trust";
import type { SkillSecurityScan } from "@/lib/securityScan";

type OpenWorldAction = "allow" | "review" | "avoid" | "unknown";

type CheckRequestBody = {
  author?: unknown;
  skill?: unknown;
  tree_hash?: unknown;
  hash?: unknown;
  content?: unknown;
  files?: unknown;
};

type SkillLookupRow = StoredSkillVersionRef & {
  skill_db_id: string;
  skill_id: string;
  author_pubkey: string | null;
  version: number;
};

type RateWindow = {
  resetAt: number;
  count: number;
};

const RATE_WINDOW_MS = 10 * 60 * 1000;
const IP_GENERATION_LIMIT = Number(process.env.AI_SCAN_IP_WINDOW_LIMIT ?? 20);
const GLOBAL_GENERATION_LIMIT = Number(
  process.env.AI_SCAN_GLOBAL_WINDOW_LIMIT ?? 100
);
const DAILY_GENERATION_LIMIT = Number(
  process.env.AI_SCAN_DAILY_GENERATION_LIMIT ?? 200
);
const MONTHLY_GENERATION_LIMIT = Number(
  process.env.AI_SCAN_MONTHLY_GENERATION_LIMIT ?? 2000
);
const MAX_CHECK_BODY_BYTES = MAX_SKILL_TREE_BYTES + 256 * 1024;

const ipWindows = new Map<string, RateWindow>();
const globalWindow: RateWindow = { resetAt: 0, count: 0 };

class CheckRequestError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

async function readBoundedJsonBody(
  request: NextRequest
): Promise<CheckRequestBody> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength &&
    /^\d+$/.test(contentLength) &&
    Number(contentLength) > MAX_CHECK_BODY_BYTES
  ) {
    throw new CheckRequestError("Check payload exceeds size limit", 413);
  }

  if (!request.body) {
    throw new CheckRequestError("Missing JSON body", 400);
  }

  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    totalBytes += chunk.byteLength;
    if (totalBytes > MAX_CHECK_BODY_BYTES) {
      throw new CheckRequestError("Check payload exceeds size limit", 413);
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as CheckRequestBody;
  } catch {
    throw new CheckRequestError("Invalid JSON body", 400);
  }
}

function resetWindowIfNeeded(window: RateWindow, now: number) {
  if (now >= window.resetAt) {
    window.resetAt = now + RATE_WINDOW_MS;
    window.count = 0;
  }
}

function takeGenerationSlot(request: NextRequest):
  | { ok: true }
  | { ok: false; reason: string; retryAfterSeconds: number } {
  const now = Date.now();
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  const ipWindow = ipWindows.get(ip) ?? { resetAt: 0, count: 0 };
  resetWindowIfNeeded(ipWindow, now);
  resetWindowIfNeeded(globalWindow, now);

  if (ipWindow.count >= IP_GENERATION_LIMIT) {
    ipWindows.set(ip, ipWindow);
    return {
      ok: false,
      reason: "ip_rate_limited",
      retryAfterSeconds: Math.ceil((ipWindow.resetAt - now) / 1000),
    };
  }
  if (globalWindow.count >= GLOBAL_GENERATION_LIMIT) {
    return {
      ok: false,
      reason: "global_rate_limited",
      retryAfterSeconds: Math.ceil((globalWindow.resetAt - now) / 1000),
    };
  }

  ipWindow.count += 1;
  globalWindow.count += 1;
  ipWindows.set(ip, ipWindow);
  return { ok: true };
}

async function reserveScanBudget(): Promise<
  | { ok: true }
  | { ok: false; reason: "daily_scan_budget_exhausted" | "monthly_scan_budget_exhausted" }
> {
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
    daily_reserved: boolean;
    monthly_reserved: boolean;
    daily_used: string | number;
    monthly_used: string | number;
  }>`
    WITH budget_lock AS (
      SELECT pg_advisory_xact_lock(hashtext('agentvouch:ai_scan_budget')::bigint) AS locked
    ),
    params AS (
      SELECT
        CURRENT_DATE::date AS day_start,
        date_trunc('month', NOW())::date AS month_start,
        ${DAILY_GENERATION_LIMIT}::integer AS daily_limit,
        ${MONTHLY_GENERATION_LIMIT}::integer AS monthly_limit
      FROM budget_lock
    ),
    day_insert AS (
      INSERT INTO ai_scan_budget_counters (bucket, period_start, used)
      SELECT 'day', day_start, 0
      FROM params
      ON CONFLICT (bucket, period_start) DO NOTHING
      RETURNING 1
    ),
    month_insert AS (
      INSERT INTO ai_scan_budget_counters (bucket, period_start, used)
      SELECT 'month', month_start, 0
      FROM params
      ON CONFLICT (bucket, period_start) DO NOTHING
      RETURNING 1
    ),
    current_counts AS (
      SELECT
        (
          SELECT c.used
          FROM ai_scan_budget_counters c
          WHERE c.bucket = 'day'
            AND c.period_start = params.day_start
        ) AS daily_used,
        (
          SELECT c.used
          FROM ai_scan_budget_counters c
          WHERE c.bucket = 'month'
            AND c.period_start = params.month_start
        ) AS monthly_used,
        params.daily_limit,
        params.monthly_limit
      FROM params
      CROSS JOIN (SELECT COUNT(*) FROM day_insert) day_inserted
      CROSS JOIN (SELECT COUNT(*) FROM month_insert) month_inserted
    ),
    reservation AS (
      UPDATE ai_scan_budget_counters c
      SET
        used = c.used + 1,
        updated_at = NOW()
      FROM params, current_counts
      WHERE (
          (c.bucket = 'day' AND c.period_start = params.day_start)
          OR (c.bucket = 'month' AND c.period_start = params.month_start)
        )
        AND current_counts.daily_used < params.daily_limit
        AND current_counts.monthly_used < params.monthly_limit
      RETURNING c.bucket
    )
    SELECT
      EXISTS (SELECT 1 FROM reservation WHERE bucket = 'day') AS daily_reserved,
      EXISTS (SELECT 1 FROM reservation WHERE bucket = 'month') AS monthly_reserved,
      COALESCE((SELECT daily_used FROM current_counts), 0) AS daily_used,
      COALESCE((SELECT monthly_used FROM current_counts), 0) AS monthly_used
  `;
  const row = rows[0];
  if (row?.daily_reserved && row.monthly_reserved) {
    return { ok: true };
  }

  if (Number(row?.daily_used ?? 0) >= DAILY_GENERATION_LIMIT) {
    return { ok: false, reason: "daily_scan_budget_exhausted" };
  }

  return { ok: false, reason: "monthly_scan_budget_exhausted" };
}

function parseFilesInput(body: CheckRequestBody): SkillTreeInputFile[] | null {
  if (typeof body.content === "string") {
    return [{ path: "SKILL.md", content: body.content }];
  }
  if (!Array.isArray(body.files)) return null;

  const files = body.files.map((entry): SkillTreeInputFile => {
    if (!entry || typeof entry !== "object") {
      throw new Error("files entries must be objects with path and content");
    }
    const file = entry as Record<string, unknown>;
    if (typeof file.path !== "string" || typeof file.content !== "string") {
      throw new Error("files entries must include string path and content");
    }
    return { path: file.path, content: file.content };
  });
  return files;
}

async function lookupSkillVersion(input: {
  skill?: string | null;
  treeHash?: string | null;
}): Promise<SkillLookupRow | null> {
  if (input.skill) {
    const rows = await sql()<SkillLookupRow>`
      SELECT
        s.id AS skill_db_id,
        s.skill_id,
        s.author_pubkey,
        sv.version,
        sv.content,
        sv.files,
        sv.tree_hash,
        sv.storage_backend
      FROM skills s
      LEFT JOIN LATERAL (
        SELECT version, content, files, tree_hash, storage_backend
        FROM skill_versions
        WHERE skill_id = s.id
        ORDER BY version DESC
        LIMIT 1
      ) sv ON true
      WHERE s.id::text = ${input.skill}
         OR s.skill_id = ${input.skill}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  if (input.treeHash) {
    const rows = await sql()<SkillLookupRow>`
      SELECT
        s.id AS skill_db_id,
        s.skill_id,
        s.author_pubkey,
        sv.version,
        sv.content,
        sv.files,
        sv.tree_hash,
        sv.storage_backend
      FROM skill_versions sv
      JOIN skills s ON s.id = sv.skill_id
      WHERE sv.tree_hash = ${input.treeHash}
      ORDER BY sv.created_at DESC
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  return null;
}

async function buildStakedBlock(author: string | null): Promise<{
  action: OpenWorldAction;
  response: {
    status: "present" | "unknown";
    author: string | null;
    trust: AuthorTrust | null;
    summary: AgentTrustSummary | null;
  };
}> {
  if (!author) {
    return {
      action: "unknown",
      response: {
        status: "unknown",
        author: null,
        trust: null,
        summary: null,
      },
    };
  }

  const trust = await resolveAuthorTrust(author);
  const identity = await resolveAgentIdentityByWallet(author, {
    hasAgentProfile: trust.isRegistered,
  }).catch(() => null);
  const summary = buildAgentTrustSummary({
    walletPubkey: author,
    trust,
    identity,
  });

  return {
    action: trust.isRegistered ? summary.recommended_action : "unknown",
    response: {
      status: trust.isRegistered ? "present" : "unknown",
      author,
      trust,
      summary,
    },
  };
}

function scanBlock(scan: SkillSecurityScan | null, extra?: Record<string, unknown>) {
  if (!scan) {
    return {
      verdict: "unknown" as const,
      advisory: true,
      ...extra,
    };
  }
  return {
    verdict: scan.verdict,
    risk: scan.risk,
    findings: scan.findings,
    truncated: scan.truncated,
    scanned_at: scan.scanned_at,
    model: scan.model,
    rubric_version: scan.rubric_version,
    source: scan.scan_source,
    generated_by_model: scan.generated_by_model,
    advisory: true,
    ...extra,
  };
}

async function resolveScanForFiles(input: {
  request: NextRequest;
  treeHash: string;
  files: SkillFileWithBytes[];
  knownSkill: boolean;
}): Promise<{
  action: OpenWorldAction;
  response: ReturnType<typeof scanBlock>;
}> {
  const cached = await getCachedSkillScan(input.treeHash);
  if (cached) {
    return {
      action: cached.verdict,
      response: scanBlock(cached, { cached: true, generated: false }),
    };
  }

  if (!hasScanEscalationSignal(input.files) && !input.knownSkill) {
    const heuristic = await recordHeuristicReviewScan(input.treeHash);
    return {
      action: heuristic.verdict,
      response: scanBlock(heuristic, {
        cached: false,
        generated: false,
        source: "heuristic_prefilter",
      }),
    };
  }

  const slot = takeGenerationSlot(input.request);
  if (!slot.ok) {
    return {
      action: "unknown",
      response: scanBlock(null, {
        unavailable_reason: slot.reason,
        retry_after_seconds: slot.retryAfterSeconds,
      }),
    };
  }

  const budget = await reserveScanBudget();
  if (!budget.ok) {
    return {
      action: "unknown",
      response: scanBlock(null, {
        unavailable_reason: budget.reason,
      }),
    };
  }

  const generated = await ensureSkillScan(input.treeHash, input.files);
  return {
    action: generated.verdict,
    response: scanBlock(generated, {
      cached: generated.cached,
      generated: generated.generated,
    }),
  };
}

function fuseActions(input: {
  staked: OpenWorldAction;
  scan: OpenWorldAction;
}): OpenWorldAction {
  const rank: Record<OpenWorldAction, number> = {
    avoid: 0,
    review: 1,
    unknown: 2,
    allow: 3,
  };
  return rank[input.staked] <= rank[input.scan] ? input.staked : input.scan;
}

export async function POST(request: NextRequest) {
  try {
    const body = await readBoundedJsonBody(request);
    await initializeDatabase();
    const treeHash =
      typeof body.tree_hash === "string"
        ? body.tree_hash
        : typeof body.hash === "string"
        ? body.hash
        : null;
    const skill = typeof body.skill === "string" ? body.skill : null;
    const explicitAuthor = typeof body.author === "string" ? body.author : null;
    const inputFiles = parseFilesInput(body);

    let author = explicitAuthor;
    let scanAction: OpenWorldAction = "unknown";
    let scanResponse = scanBlock(null);
    let resolvedTreeHash: string | null = treeHash;

    if (inputFiles) {
      const tree = prepareSkillTree(inputFiles);
      resolvedTreeHash = tree.treeHash;
      const scan = await resolveScanForFiles({
        request,
        treeHash: tree.treeHash,
        files: tree.filesWithBytes,
        knownSkill: false,
      });
      scanAction = scan.action;
      scanResponse = scan.response;
    } else {
      const known = await lookupSkillVersion({ skill, treeHash });
      if (known) {
        author ??= known.author_pubkey;
        resolvedTreeHash = known.tree_hash;
        if (known.tree_hash) {
          const files = await getFilesForVersion(known);
          const scan = await resolveScanForFiles({
            request,
            treeHash: known.tree_hash,
            files,
            knownSkill: true,
          });
          scanAction = scan.action;
          scanResponse = scan.response;
        }
      } else if (treeHash) {
        scanResponse = scanBlock(null, {
          unavailable_reason: "tree_hash_not_found",
        });
      }
    }

    const staked = await buildStakedBlock(author);
    const recommendedAction = fuseActions({
      staked: staked.action,
      scan: scanAction,
    });

    return NextResponse.json(
      {
        recommended_action: recommendedAction,
        tree_hash: resolvedTreeHash,
        staked: staked.response,
        scan: scanResponse,
        disclaimer:
          "Automated scans are advisory; absence of findings is not proof of safety. Only staked on-chain trust can grant allow.",
      },
      {
        headers: {
          "Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL,
        },
      }
    );
  } catch (error: unknown) {
    console.error("POST /api/check error:", error);
    const message = getErrorMessage(error);
    const status =
      error instanceof CheckRequestError
        ? error.status
        : message.includes("exceeds cap")
        ? 413
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
