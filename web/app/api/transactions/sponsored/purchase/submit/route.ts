import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { checkRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { submitSponsoredPurchase } from "@/lib/sponsoredPurchase";

export const dynamic = "force-dynamic";

type SubmitBody = {
  signedTransaction?: unknown;
  transaction?: unknown;
  serializedTransaction?: unknown;
};

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function POST(request: NextRequest) {
  const rate = checkRateLimit(
    `sponsored-submit:${clientIpFromRequest(request)}`,
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

  let body: SubmitBody;
  try {
    body = (await request.json()) as SubmitBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 }
    );
  }

  const serializedTransaction =
    stringOrNull(body.signedTransaction) ??
    stringOrNull(body.serializedTransaction) ??
    stringOrNull(body.transaction);
  if (!serializedTransaction) {
    return NextResponse.json(
      { error: "signedTransaction is required" },
      { status: 400 }
    );
  }

  try {
    const result = await submitSponsoredPurchase(serializedTransaction);
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = getErrorMessage(error, "Failed to submit checkout");
    const status =
      /signature|instruction|mismatch|missing|required|invalid/i.test(message)
        ? 400
        : /balance|paused|already has a purchase/i.test(message)
        ? 409
        : 500;
    console.warn("[sponsored-purchase:submit]", message);
    return NextResponse.json({ error: message }, { status });
  }
}
