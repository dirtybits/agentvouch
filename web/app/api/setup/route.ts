import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { bootstrapDatabase } from "@/lib/databaseBootstrap";
import { getErrorMessage } from "@/lib/errors";

// Operator-only endpoint: it runs schema DDL against the live database.
// Auth matches /api/github/skills/discover: a Bearer CRON_SECRET, compared in
// constant time, that fails closed on any deployed Vercel environment
// (production and preview are both internet-reachable). The endpoint stays
// open in local development so the local dev flow is unchanged.
function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
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
      "[api/setup] CRON_SECRET is not set in a deployed environment; refusing request."
    );
    return false;
  }
  console.warn(
    "[api/setup] CRON_SECRET is not set; running without auth (local development only)."
  );
  return true;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await bootstrapDatabase();
    return NextResponse.json({
      success: true,
      message: "Database tables created",
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
