import { NextResponse } from "next/server";
import { PRIVATE_NO_STORE_CACHE_CONTROL } from "@/lib/cachePolicy";
import { isBuyerCardAccessServerEnabled } from "@/lib/buyerAuthConfig";
import { getBuyerSession } from "@/lib/buyerSession";
import { hasActiveMarketplaceAccessGrant } from "@/lib/buyerAccessGrants";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ skillId: string }> }
) {
  if (!isBuyerCardAccessServerEnabled()) {
    return NextResponse.json(
      { enabled: false, authenticated: false, hasAccess: false },
      {
        status: 503,
        headers: { "Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL },
      }
    );
  }

  const session = await getBuyerSession(request);
  if (!session) {
    return NextResponse.json(
      { enabled: true, authenticated: false, hasAccess: false },
      { headers: { "Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL } }
    );
  }

  const { skillId } = await params;
  const hasAccess = await hasActiveMarketplaceAccessGrant(
    session.accountId,
    skillId
  ).catch(() => false);
  return NextResponse.json(
    { enabled: true, authenticated: true, hasAccess },
    { headers: { "Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL } }
  );
}
