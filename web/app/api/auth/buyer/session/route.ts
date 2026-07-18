import { NextResponse } from "next/server";
import { PRIVATE_NO_STORE_CACHE_CONTROL } from "@/lib/cachePolicy";
import { getBuyerAuthStatus, getBuyerSession } from "@/lib/buyerSession";

export async function GET(request: Request) {
  const configuration = getBuyerAuthStatus();
  const session = configuration.enabled ? await getBuyerSession(request) : null;

  return NextResponse.json(
    {
      configured: configuration.clerkConfigured,
      enabled: configuration.enabled,
      authenticated: Boolean(session),
      accountId: session?.accountId ?? null,
    },
    { headers: { "Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL } }
  );
}
