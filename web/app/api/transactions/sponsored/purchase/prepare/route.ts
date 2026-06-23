import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { checkRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { prepareSponsoredPurchase } from "@/lib/sponsoredPurchase";

export const dynamic = "force-dynamic";

type PrepareBody = {
  buyerPubkey?: unknown;
  listingAddress?: unknown;
  skillDbId?: unknown;
  expectedPriceUsdcMicros?: unknown;
  expectedUsdcMint?: unknown;
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
    `sponsored-prepare:${clientIpFromRequest(request)}`,
    { limit: 15, windowMs: 60_000 }
  );
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many sponsored checkout requests" },
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

  const buyerPubkey = stringOrNull(body.buyerPubkey);
  const listingAddress = stringOrNull(body.listingAddress);
  if (!buyerPubkey || !listingAddress) {
    return NextResponse.json(
      { error: "buyerPubkey and listingAddress are required" },
      { status: 400 }
    );
  }

  try {
    const result = await prepareSponsoredPurchase({
      buyerPubkey,
      listingAddress,
      skillDbId: stringOrNull(body.skillDbId),
      expectedPriceUsdcMicros: bigintishOrNull(body.expectedPriceUsdcMicros),
      expectedUsdcMint: stringOrNull(body.expectedUsdcMint),
      maxSetupFeeUsdcMicros: bigintishOrNull(body.maxSetupFeeUsdcMicros),
    });
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = getErrorMessage(error, "Failed to prepare checkout");
    const status = /not enabled|missing|invalid|required/i.test(message)
      ? 400
      : /balance|already has a purchase|paused|relink|republish|stale/i.test(
          message
        )
      ? 409
      : 500;
    console.warn("[sponsored-purchase:prepare]", message);
    return NextResponse.json({ error: message }, { status });
  }
}
