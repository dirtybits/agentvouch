import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getErrorMessage } from "@/lib/errors";
import { discoverGithubSkills } from "@/lib/githubSkillDiscovery";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

function isAuthorized(request: NextRequest): boolean {
  const secret =
    process.env.GITHUB_SKILL_DISCOVERY_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim();
  if (secret) {
    return timingSafeStringEqual(
      request.headers.get("authorization") ?? "",
      `Bearer ${secret}`
    );
  }
  // No secret configured: fail closed on any deployed Vercel environment.
  // Preview deployments are internet-reachable, so "not production" is not a
  // safe reason to skip auth. Only allow the open path in local development.
  const deployed =
    process.env.VERCEL_ENV === "production" ||
    process.env.VERCEL_ENV === "preview";
  if (deployed) {
    console.error(
      "[github/skills/discover] Secret is not set in a deployed environment; refusing request."
    );
    return false;
  }
  console.warn(
    "[github/skills/discover] Secret is not set; running without auth (local development only)."
  );
  return true;
}

function parseLimit(value: unknown): {
  maxResults: number;
  invalid: boolean;
} {
  if (value === null || value === undefined) {
    return { maxResults: 10, invalid: false };
  }

  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === "") {
    return { maxResults: 10, invalid: false };
  }
  if (
    (typeof normalized !== "string" && typeof normalized !== "number") ||
    (typeof normalized === "string" && !/^\d+$/.test(normalized))
  ) {
    return { maxResults: 10, invalid: true };
  }

  const parsed =
    typeof normalized === "number" ? normalized : Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    return { maxResults: 10, invalid: true };
  }

  return { maxResults: Math.max(1, Math.min(25, parsed)), invalid: false };
}

async function paramsFromRequest(request: NextRequest): Promise<{
  query: string | undefined;
  maxResults: number;
  invalidQuery: boolean;
  invalidLimit: boolean;
}> {
  if (request.method === "GET") {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseLimit(
      searchParams.get("limit") ?? searchParams.get("maxResults")
    );
    return {
      query: searchParams.get("q") ?? searchParams.get("query") ?? undefined,
      maxResults: limit.maxResults,
      invalidQuery: false,
      invalidLimit: limit.invalid,
    };
  }

  const body = ((await request.json().catch(() => null)) ?? {}) as Record<
    string,
    unknown
  >;
  const query = body.query !== undefined ? body.query : body.q;
  const limit = parseLimit(body.maxResults ?? body.limit);
  return {
    query: typeof query === "string" ? query : undefined,
    maxResults: limit.maxResults,
    invalidQuery: query !== undefined && typeof query !== "string",
    invalidLimit: limit.invalid,
  };
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { query, maxResults, invalidQuery, invalidLimit } =
      await paramsFromRequest(request);
    if (invalidQuery) {
      return NextResponse.json({ error: "Invalid query" }, { status: 400 });
    }
    if (invalidLimit) {
      return NextResponse.json({ error: "Invalid limit" }, { status: 400 });
    }
    const result = await discoverGithubSkills({
      query,
      maxResults,
      token: process.env.GITHUB_TOKEN?.trim() || undefined,
    });

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("GET /api/github/skills/discover error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
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
