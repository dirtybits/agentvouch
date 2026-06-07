import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { refreshPlatformMetricsSnapshot } from "@/lib/platformMetrics";
import { refreshAllAuthorTrustSnapshots } from "@/lib/trustSnapshots";

// On-chain scans + trust resolution can take a while; give the job headroom and
// keep it off the static optimizer.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Background refresh of the Postgres snapshots that back the homepage:
 *  - platform_metrics_snapshot (landing metrics)
 *  - author_trust_snapshots (per-author trust used by skill cards)
 *
 * Invoked by Vercel Cron (see web/vercel.json). When CRON_SECRET is set, the
 * caller must present it as a Bearer token (Vercel Cron does this automatically).
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    // No secret configured: allow (e.g. local dev / first deploy) but warn.
    console.warn(
      "[cron/refresh-snapshots] CRON_SECRET is not set; running without auth."
    );
    return true;
  }
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const [metrics, trust] = await Promise.allSettled([
    refreshPlatformMetricsSnapshot(),
    refreshAllAuthorTrustSnapshots(),
  ]);

  const result = {
    ok:
      metrics.status === "fulfilled" && trust.status === "fulfilled",
    durationMs: Date.now() - startedAt,
    platformMetrics:
      metrics.status === "fulfilled"
        ? { status: "ok", metrics: metrics.value.metrics }
        : { status: "error", error: getErrorMessage(metrics.reason) },
    authorTrust:
      trust.status === "fulfilled"
        ? { status: "ok", authors: trust.value.authors }
        : { status: "error", error: getErrorMessage(trust.reason) },
  };

  if (!result.ok) {
    console.error("[cron/refresh-snapshots] partial/total failure:", result);
  }

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
