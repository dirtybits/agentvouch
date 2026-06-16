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
import { reserveScanBudget, releaseScanBudget } from "@/lib/ai/scanBudget";
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
import {
  buildTrustSignals,
  recommendedActionFromSignals,
  type OpenWorldAction,
} from "@/lib/trustSignals";
import { upsertResolvedAuthorTrustSnapshot } from "@/lib/trustSnapshots";

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
const MAX_CHECK_BODY_BYTES = MAX_SKILL_TREE_BYTES + 256 * 1024;

const MAX_TRACKED_IPS = 10_000;

const ipWindows = new Map<string, RateWindow>();
const globalWindow: RateWindow = { resetAt: 0, count: 0 };

// On Vercel, x-real-ip is set by the platform to the true client IP and cannot
// be spoofed by the caller; x-forwarded-for may carry client-prepended hops, so
// its leftmost entry is attacker-controlled. Prefer x-real-ip, falling back to
// the nearest (rightmost) forwarded hop only for local / non-Vercel dev.
function clientIp(request: NextRequest): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const hops = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return hops && hops.length > 0 ? hops[hops.length - 1] : "unknown";
}

// Bound the in-memory IP table so a flood of distinct IPs cannot grow it without
// limit. Drop windows that have already expired; if still over the cap, the
// global window and the durable daily/monthly budget remain as backstops. Note:
// this map is per-instance and is best-effort burst smoothing only — the durable
// budget counters are the authoritative cross-instance spend cap.
function pruneIpWindows(now: number) {
  if (ipWindows.size <= MAX_TRACKED_IPS) return;
  for (const [ip, window] of ipWindows) {
    if (now >= window.resetAt) ipWindows.delete(ip);
  }
}

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
    return JSON.parse(
      Buffer.concat(chunks).toString("utf8")
    ) as CheckRequestBody;
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

function takeGenerationSlot(
  request: NextRequest
): { ok: true } | { ok: false; reason: string; retryAfterSeconds: number } {
  const now = Date.now();
  pruneIpWindows(now);
  const ip = clientIp(request);
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

function parseFilesInput(body: CheckRequestBody): SkillTreeInputFile[] | null {
  if (typeof body.content === "string") {
    return [{ path: "SKILL.md", content: body.content }];
  }
  if (!Array.isArray(body.files)) return null;

  const files = body.files.map((entry): SkillTreeInputFile => {
    if (!entry || typeof entry !== "object") {
      throw new CheckRequestError(
        "files entries must be objects with path and content"
      );
    }
    const file = entry as Record<string, unknown>;
    if (typeof file.path !== "string" || typeof file.content !== "string") {
      throw new CheckRequestError(
        "files entries must include string path and content"
      );
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

async function refreshCachedTrustFromCheck(input: {
  author: string | null;
  trust: AuthorTrust | null;
  summary: AgentTrustSummary | null;
}): Promise<void> {
  if (!input.author || !input.trust || !input.summary) return;
  try {
    await upsertResolvedAuthorTrustSnapshot({
      walletPubkey: input.author,
      trust: input.trust,
      summary: input.summary,
    });
  } catch (error) {
    console.error(
      "Failed to refresh author trust snapshot from /api/check:",
      error
    );
  }
}

function scanBlock(
  scan: SkillSecurityScan | null,
  extra?: Record<string, unknown>
) {
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
  scan: SkillSecurityScan | null;
}> {
  const cached = await getCachedSkillScan(input.treeHash);
  if (cached) {
    return {
      action: cached.verdict,
      response: scanBlock(cached, { cached: true, generated: false }),
      scan: cached,
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
      scan: heuristic,
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
      scan: null,
    };
  }

  const budget = await reserveScanBudget();
  if (!budget.ok) {
    return {
      action: "unknown",
      response: scanBlock(null, {
        unavailable_reason: budget.reason,
      }),
      scan: null,
    };
  }

  // The reservation already incremented the durable counter; refund it if the
  // model call fails so a provider outage does not burn budget without a scan.
  const generated = await ensureSkillScan(input.treeHash, input.files).catch(
    async (error) => {
      await releaseScanBudget();
      throw error;
    }
  );
  return {
    action: generated.verdict,
    response: scanBlock(generated, {
      cached: generated.cached,
      generated: generated.generated,
    }),
    scan: generated,
  };
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
    let scanResponse = scanBlock(null);
    let rawScan: SkillSecurityScan | null = null;
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
      scanResponse = scan.response;
      rawScan = scan.scan;
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
          scanResponse = scan.response;
          rawScan = scan.scan;
        }
      } else if (treeHash) {
        scanResponse = scanBlock(null, {
          unavailable_reason: "tree_hash_not_found",
        });
      }
    }

    const staked = await buildStakedBlock(author);
    await refreshCachedTrustFromCheck({
      author: staked.response.author,
      trust: staked.response.trust,
      summary: staked.response.summary,
    });
    // The checklist is the source of truth; the one-line verdict is derived from
    // it so the two can never drift.
    const signals = buildTrustSignals({
      trust: staked.response.trust,
      scan: rawScan,
    });
    const recommendedAction = recommendedActionFromSignals(signals);

    return NextResponse.json(
      {
        recommended_action: recommendedAction,
        tree_hash: resolvedTreeHash,
        signals,
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
