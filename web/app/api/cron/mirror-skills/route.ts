import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { initializeDatabase } from "@/lib/db";
import { syncConnectedRepos, syncMirrorSkills } from "@/lib/mirror/sync";

// Mirroring downloads upstream files and may regenerate reviews for changed
// skills; give it headroom and keep it off the static optimizer. Steady-state
// runs only touch skills whose upstream tree changed since the last sync.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily re-sync of mirrored external skills (see lib/mirror/sources.ts).
 * Creates listings for new upstream skills and publishes a new version when an
 * already-mirrored skill changes. Invoked by Vercel Cron (see web/vercel.json).
 * Auth matches /api/cron/refresh-snapshots: a Bearer CRON_SECRET that Vercel
 * Cron sends automatically; fails closed in production when the secret is unset.
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    return request.headers.get("authorization") === `Bearer ${secret}`;
  }
  if (process.env.VERCEL_ENV === "production") {
    console.error(
      "[cron/mirror-skills] CRON_SECRET is not set in production; refusing request."
    );
    return false;
  }
  console.warn(
    "[cron/mirror-skills] CRON_SECRET is not set; running without auth (non-production)."
  );
  return true;
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    await initializeDatabase();
    const log = (message: string) =>
      console.log("[cron/mirror-skills]", message);
    // Community mirrors (Anthropic/OpenAI) + every active first-party connected repo.
    const mirror = await syncMirrorSkills({ apply: true, log });
    const connected = await syncConnectedRepos({ apply: true, log });
    const changed = [...mirror.outcomes, ...connected.outcomes].filter(
      (o) =>
        o.action === "create" || o.action === "update" || o.action === "error"
    );
    const ok = mirror.counts.error === 0 && connected.counts.error === 0;
    const body = {
      ok,
      durationMs: Date.now() - startedAt,
      counts: { mirror: mirror.counts, connected: connected.counts },
      changed,
    };
    return NextResponse.json(body, { status: ok ? 200 : 500 });
  } catch (error) {
    console.error("[cron/mirror-skills] failed:", error);
    return NextResponse.json(
      { ok: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
