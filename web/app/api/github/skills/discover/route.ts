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

function parseLimit(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") {
    return 10;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return 10;
  }
  return Math.max(1, Math.min(25, Math.floor(parsed)));
}

async function paramsFromRequest(request: NextRequest): Promise<{
  query: string | undefined;
  maxResults: number;
}> {
  if (request.method === "GET") {
    const searchParams = request.nextUrl.searchParams;
    return {
      query: searchParams.get("q") ?? searchParams.get("query") ?? undefined,
      maxResults: parseLimit(
        searchParams.get("limit") ?? searchParams.get("maxResults")
      ),
    };
  }

  const body = (await request.json().catch(() => null)) as {
    q?: string;
    query?: string;
    limit?: number;
    maxResults?: number;
  } | null;
  return {
    query: body?.query ?? body?.q,
    maxResults: parseLimit(body?.maxResults ?? body?.limit),
  };
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { query, maxResults } = await paramsFromRequest(request);
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
