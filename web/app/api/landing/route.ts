import { NextResponse } from "next/server";
import {
  buildPublicCacheControl,
  PUBLIC_ROUTE_CACHE_SECONDS,
  PUBLIC_ROUTE_STALE_SECONDS,
} from "@/lib/cachePolicy";
import { getErrorMessage } from "@/lib/errors";
import { loadLandingPayload } from "@/lib/landingPayload";

export async function GET() {
  try {
    const { payload, source, snapshotMs, computeMs } =
      await loadLandingPayload();
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": buildPublicCacheControl(
          PUBLIC_ROUTE_CACHE_SECONDS.landing,
          PUBLIC_ROUTE_STALE_SECONDS.landing
        ),
        // Diagnostics: `snapshot-hit` is the fast Postgres path; `live-compute`
        // / `snapshot-error` mean the slow on-chain fallback was taken.
        "X-AgentVouch-Source": source,
        "Server-Timing": [
          `snapshot;dur=${snapshotMs}`,
          `compute;dur=${computeMs}`,
        ].join(", "),
      },
    });
  } catch (error: unknown) {
    console.error("GET /api/landing error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
