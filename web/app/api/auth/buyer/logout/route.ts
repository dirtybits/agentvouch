import { NextResponse } from "next/server";
import {
  getBuyerAuthStatus,
  isSameOriginMutation,
  revokeCurrentBuyerSession,
} from "@/lib/buyerSession";

export async function POST(request: Request) {
  if (!getBuyerAuthStatus().enabled) {
    return NextResponse.json(
      { error: "Buyer authentication is not enabled." },
      { status: 503 }
    );
  }
  if (!isSameOriginMutation(request)) {
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 }
    );
  }

  const revoked = await revokeCurrentBuyerSession();
  return NextResponse.json({ success: true, revoked });
}
