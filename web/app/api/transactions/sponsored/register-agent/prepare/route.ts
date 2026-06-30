import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { checkRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { prepareSponsoredRegisterAgent } from "@/lib/sponsoredRegisterAgent";

export const dynamic = "force-dynamic";

type PrepareBody = {
  authorityPubkey?: unknown;
  metadataUri?: unknown;
  maxSetupFeeUsdcMicros?: unknown;
};

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function bigintishOrNull(value: unknown): string | number | bigint | null {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
    ? value
    : null;
}

export async function POST(request: NextRequest) {
  const rate = checkRateLimit(
    `sponsored-register-prepare:${clientIpFromRequest(request)}`,
    { limit: 15, windowMs: 60_000 }
  );
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many sponsored registration requests" },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      }
    );
  }

  let body: PrepareBody;
  try {
    body = (await request.json()) as PrepareBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 }
    );
  }

  const authorityPubkey = stringOrNull(body.authorityPubkey);
  if (!authorityPubkey) {
    return NextResponse.json(
      { error: "authorityPubkey is required" },
      { status: 400 }
    );
  }

  try {
    const result = await prepareSponsoredRegisterAgent({
      authorityPubkey,
      // metadataUri may legitimately be an empty string, so don't coerce to null.
      metadataUri: typeof body.metadataUri === "string" ? body.metadataUri : "",
      maxSetupFeeUsdcMicros: bigintishOrNull(body.maxSetupFeeUsdcMicros),
    });
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = getErrorMessage(error, "Failed to prepare registration");
    const status = /not enabled|missing|invalid|required|at most/i.test(message)
      ? 400
      : /balance|already has a registered|paused/i.test(message)
      ? 409
      : 500;
    console.warn("[sponsored-register-agent:prepare]", message);
    return NextResponse.json({ error: message }, { status });
  }
}
