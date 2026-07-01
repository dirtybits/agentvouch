import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase } from "@/lib/db";
import { getErrorMessage } from "@/lib/errors";
import { PRIVATE_NO_STORE_CACHE_CONTROL } from "@/lib/cachePolicy";
import type { AuthPayload } from "@/lib/authPayload";
import {
  createConnectedRepo,
  listConnectedRepos,
  validateRepoCoords,
  verifyConnectAuth,
  verifyRepoOwnership,
} from "@/lib/mirror/connectedRepos";
import { syncConnectedRepo, type SkillOutcome } from "@/lib/mirror/sync";

// Connecting runs an initial sync inline (download + reconcile); give it room.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function summarize(outcomes: SkillOutcome[]) {
  const counts: Record<string, number> = {};
  for (const o of outcomes) counts[o.action] = (counts[o.action] ?? 0) + 1;
  return counts;
}

// GET: list a wallet's connected repos. Public — these are public repos the
// wallet chose to sync, and the synced listings are already public.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ pubkey: string }> }
) {
  try {
    const { pubkey } = await params;
    await initializeDatabase();
    const repos = await listConnectedRepos(pubkey);
    return NextResponse.json(
      { repos },
      { headers: { "Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL } }
    );
  } catch (error) {
    console.error("GET /api/agents/[pubkey]/repos error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

// POST: connect a repo (wallet-signed, action "connect-repo"), verify ownership,
// register it, and run the initial sync. This is the agent-facing entry point.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pubkey: string }> }
) {
  try {
    const { pubkey } = await params;
    const body = (await request.json()) as {
      auth?: AuthPayload;
      owner?: string;
      repo?: string;
      branch?: string;
      include_paths?: unknown;
    };

    const auth = verifyConnectAuth(body.auth, pubkey, "connect-repo");
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!body.owner || !body.repo) {
      return NextResponse.json(
        { error: "Missing required fields: owner, repo" },
        { status: 400 }
      );
    }
    const coords = validateRepoCoords({
      githubOwner: body.owner,
      githubRepo: body.repo,
      branch: body.branch,
    });
    if (!coords.ok) {
      return NextResponse.json({ error: coords.error }, { status: 400 });
    }

    await initializeDatabase();

    const ownership = await verifyRepoOwnership({
      walletPubkey: pubkey,
      githubOwner: body.owner,
      githubRepo: body.repo,
      branch: coords.branch,
    });
    if (!ownership.verified) {
      return NextResponse.json({ error: ownership.reason }, { status: 403 });
    }

    const includePaths = Array.isArray(body.include_paths)
      ? body.include_paths
          .filter((p): p is string => typeof p === "string")
          .filter((p) => p.trim() !== "")
      : [];

    const created = await createConnectedRepo({
      ownerWallet: pubkey,
      githubOwner: body.owner,
      githubRepo: body.repo,
      branch: coords.branch,
      includePaths,
      verificationMethod: ownership.method,
    });
    if (!created.ok) {
      return NextResponse.json(
        { error: created.error },
        { status: created.status }
      );
    }

    const outcomes = await syncConnectedRepo(created.repo, {
      apply: true,
      skipReview: false,
    });

    return NextResponse.json(
      {
        repo: created.repo,
        created: created.created,
        verification: ownership.method,
        sync: { counts: summarize(outcomes), outcomes },
      },
      {
        status: created.created ? 201 : 200,
        headers: { "Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL },
      }
    );
  } catch (error) {
    console.error("POST /api/agents/[pubkey]/repos error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
