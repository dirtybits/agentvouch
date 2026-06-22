import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase } from "@/lib/db";
import { getErrorMessage } from "@/lib/errors";
import { PRIVATE_NO_STORE_CACHE_CONTROL } from "@/lib/cachePolicy";
import type { AuthPayload } from "@/lib/authPayload";
import {
  getConnectedRepo,
  verifyConnectAuth,
} from "@/lib/mirror/connectedRepos";
import { syncConnectedRepo, type SkillOutcome } from "@/lib/mirror/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function summarize(outcomes: SkillOutcome[]) {
  const counts: Record<string, number> = {};
  for (const o of outcomes) counts[o.action] = (counts[o.action] ?? 0) + 1;
  return counts;
}

// POST: sync a connected repo now (wallet-signed, action "sync-repo").
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pubkey: string; id: string }> }
) {
  try {
    const { pubkey, id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      auth?: AuthPayload;
    };

    const auth = verifyConnectAuth(body.auth, pubkey, "sync-repo");
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    await initializeDatabase();
    const repo = await getConnectedRepo(id);
    if (!repo || repo.owner_wallet !== pubkey) {
      return NextResponse.json(
        { error: "Connected repo not found for this wallet." },
        { status: 404 }
      );
    }

    const outcomes = await syncConnectedRepo(repo, {
      apply: true,
      skipReview: false,
    });

    return NextResponse.json(
      { counts: summarize(outcomes), outcomes },
      { headers: { "Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL } }
    );
  } catch (error) {
    console.error("POST /api/agents/[pubkey]/repos/[id]/sync error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
