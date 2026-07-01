import { after } from "next/server";
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

export type LandingPayloadSource =
  | "snapshot-hit"
  | "snapshot-stale"
  | "live-compute"
  | "snapshot-error";

export type LoadedLandingPayload = {
  payload: LandingPayload;
  source: LandingPayloadSource;
  snapshotMs: number;
  computeMs: number;
};

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
          console.error("Failed to persist platform metrics snapshot:", error);
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

export async function loadLandingPayload(): Promise<LoadedLandingPayload> {
  let snapshot: Awaited<ReturnType<typeof readPlatformMetricsSnapshot>> = null;
  let source: LandingPayloadSource = "live-compute";
  const snapshotStart = Date.now();
  try {
    snapshot = await readPlatformMetricsSnapshot();
  } catch (error) {
    source = "snapshot-error";
    console.error(
      "Failed to read platform metrics snapshot; falling back to live compute:",
      error
    );
  }
  const snapshotMs = Date.now() - snapshotStart;

  if (snapshot) {
    const stale = isStale(snapshot.refreshedAt);
    if (stale) scheduleSnapshotRefresh();
    return {
      payload: { metrics: snapshot.metrics },
      source: stale ? "snapshot-stale" : "snapshot-hit",
      snapshotMs,
      computeMs: 0,
    };
  }

  const computeStart = Date.now();
  const payload = await computeLandingPayloadOnce();
  return { payload, source, snapshotMs, computeMs: Date.now() - computeStart };
}
