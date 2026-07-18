import { NextResponse } from "next/server";
import { PRIVATE_NO_STORE_CACHE_CONTROL } from "@/lib/cachePolicy";
import { listBuyerWalletLinks } from "@/lib/buyerWalletLinks";
import { getBuyerAuthStatus, getBuyerSession } from "@/lib/buyerSession";

export async function GET(request: Request) {
  if (!getBuyerAuthStatus().enabled) {
    return NextResponse.json(
      { error: "Buyer authentication is not enabled." },
      { status: 503 }
    );
  }
  const session = await getBuyerSession(request);
  if (!session) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 }
    );
  }
  const links = await listBuyerWalletLinks(session.accountId);
  return NextResponse.json(
    { links },
    { headers: { "Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL } }
  );
}
