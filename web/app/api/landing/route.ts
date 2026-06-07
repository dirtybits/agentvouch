import { NextResponse, after } from "next/server";
import {
  buildPublicCacheControl,
  IN_MEMORY_CACHE_TTL_MS,
  PUBLIC_ROUTE_CACHE_SECONDS,
  PUBLIC_ROUTE_STALE_SECONDS,
} from "@/lib/cachePolicy";
import { getErrorMessage } from "@/lib/errors";
import {
  computeLandingPayloadFromChain,
  readPlatformMetricsSnapshot,
  writePlatformMetricsSnapshot,
  type LandingPayload,
} from "@/lib/platformMetrics";

const LANDING_CACHE_KEY = "landing";

const landingCache = new Map<
  string,
  { value: LandingPayload; expiresAt: number }
>();
let inFlightLandingPayload: Promise<LandingPayload> | null = null;

/**
 * Slow path: compute metrics from on-chain data, dedupe concurrent callers, and
 * persist the snapshot so subsequent requests can serve straight from Postgres.
 * Used only when the background-refreshed snapshot is missing (e.g. cold start
 * before the first cron run).
 */
function computeAndCacheLandingPayload(): Promise<LandingPayload> {
  if (process.env.NODE_ENV === "test") {
    return computeLandingPayloadFromChain();
  }

  const now = Date.now();
  const cached = landingCache.get(LANDING_CACHE_KEY);
  if (cached && cached.expiresAt > now) {
    return Promise.resolve(cached.value);
  }

  if (inFlightLandingPayload) {
    return inFlightLandingPayload;
  }

  inFlightLandingPayload = computeLandingPayloadFromChain()
    .then((value) => {
      landingCache.set(LANDING_CACHE_KEY, {
        value,
        expiresAt: Date.now() + IN_MEMORY_CACHE_TTL_MS.landing,
      });
      after(() =>
        writePlatformMetricsSnapshot(value.metrics).catch((error) => {
          console.error(
            "Failed to persist platform metrics snapshot from /api/landing:",
            error
          );
        })
      );
      return value;
    })
    .finally(() => {
      inFlightLandingPayload = null;
    });

  return inFlightLandingPayload;
}

async function getLandingPayload(): Promise<LandingPayload> {
  if (process.env.NODE_ENV !== "test") {
    try {
      const snapshot = await readPlatformMetricsSnapshot();
      if (snapshot) {
        // featuredSkills is unused by the homepage; metrics come from Postgres.
        return { metrics: snapshot.metrics, featuredSkills: [] };
      }
    } catch (error) {
      console.error(
        "Failed to read platform metrics snapshot; falling back to live compute:",
        error
      );
    }
  }

  return computeAndCacheLandingPayload();
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
