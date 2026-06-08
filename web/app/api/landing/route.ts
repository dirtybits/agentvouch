import { NextResponse, after } from "next/server";
import {
  buildPublicCacheControl,
  PUBLIC_ROUTE_CACHE_SECONDS,
  PUBLIC_ROUTE_STALE_SECONDS,
} from "@/lib/cachePolicy";
import { getErrorMessage } from "@/lib/errors";
import {
  computeLandingPayloadFromChain,
  readPlatformMetricsSnapshot,
  refreshPlatformMetricsSnapshot,
  writePlatformMetricsSnapshot,
  type LandingPayload,
} from "@/lib/platformMetrics";

// A snapshot older than this is served immediately but triggers a background
// recompute (stale-while-revalidate), so organic traffic keeps metrics fresh
// even if the cron is delayed or disabled.
const SNAPSHOT_STALE_MS = 15 * 60_000;

let inFlightCompute: Promise<LandingPayload> | null = null;
let inFlightRefresh: Promise<unknown> | null = null;

/**
 * Cold path (no snapshot row yet, e.g. before the first refresh): compute from
 * chain, dedupe concurrent callers, and persist the snapshot so subsequent
 * requests serve straight from Postgres.
 */
function computeLandingPayloadOnce(): Promise<LandingPayload> {
  if (inFlightCompute) return inFlightCompute;

  inFlightCompute = computeLandingPayloadFromChain()
    .then((value) => {
      const persist = () =>
        writePlatformMetricsSnapshot(value.metrics).catch((error) => {
          console.error(
            "Failed to persist platform metrics snapshot from /api/landing:",
            error
          );
        });
      try {
        after(persist);
      } catch {
        void persist();
      }
      return value;
    })
    .finally(() => {
      inFlightCompute = null;
    });

  return inFlightCompute;
}

/** Recompute the snapshot in the background, single-flighted to avoid a stampede. */
function scheduleSnapshotRefresh(): void {
  const run = () => {
    if (inFlightRefresh) return inFlightRefresh;
    inFlightRefresh = refreshPlatformMetricsSnapshot()
      .catch((error) => {
        console.error(
          "Background platform metrics refresh failed:",
          getErrorMessage(error)
        );
      })
      .finally(() => {
        inFlightRefresh = null;
      });
    return inFlightRefresh;
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

function isStale(refreshedAt: string): boolean {
  const refreshedMs = Date.parse(refreshedAt);
  if (Number.isNaN(refreshedMs)) return true;
  return Date.now() - refreshedMs > SNAPSHOT_STALE_MS;
}

async function getLandingPayload(): Promise<LandingPayload> {
  let snapshot: Awaited<ReturnType<typeof readPlatformMetricsSnapshot>> = null;
  try {
    snapshot = await readPlatformMetricsSnapshot();
  } catch (error) {
    console.error(
      "Failed to read platform metrics snapshot; falling back to live compute:",
      error
    );
  }

  if (snapshot) {
    if (isStale(snapshot.refreshedAt)) {
      scheduleSnapshotRefresh();
    }
    return { metrics: snapshot.metrics };
  }

  return computeLandingPayloadOnce();
}

export async function GET() {
  try {
    return NextResponse.json(await getLandingPayload(), {
      headers: {
        "Cache-Control": buildPublicCacheControl(
          PUBLIC_ROUTE_CACHE_SECONDS.landing,
          PUBLIC_ROUTE_STALE_SECONDS.landing
        ),
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
