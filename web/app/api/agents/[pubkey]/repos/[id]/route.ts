import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase } from "@/lib/db";
import { getErrorMessage } from "@/lib/errors";
import { PRIVATE_NO_STORE_CACHE_CONTROL } from "@/lib/cachePolicy";
import type { AuthPayload } from "@/lib/authPayload";
import {
  deleteConnectedRepo,
  verifyConnectAuth,
} from "@/lib/mirror/connectedRepos";

export const dynamic = "force-dynamic";

// DELETE: disconnect a repo (wallet-signed, action "disconnect-repo"). Stops
// future syncs; existing listings (the wallet's own skills) are left in place.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ pubkey: string; id: string }> }
) {
  try {
    const { pubkey, id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      auth?: AuthPayload;
    };

    const auth = verifyConnectAuth(body.auth, pubkey, "disconnect-repo");
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    await initializeDatabase();
    const deleted = await deleteConnectedRepo(id, pubkey);
    if (!deleted) {
      return NextResponse.json(
        { error: "Connected repo not found for this wallet." },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { deleted: true },
      { headers: { "Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL } }
    );
  } catch (error) {
    console.error("DELETE /api/agents/[pubkey]/repos/[id] error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
