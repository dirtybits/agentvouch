import { NextRequest, NextResponse } from "next/server";
import { listGithubLinkedWallets } from "@/lib/agentIdentity";
import { PRIVATE_NO_STORE_CACHE_CONTROL } from "@/lib/cachePolicy";
import { getErrorMessage } from "@/lib/errors";
import { getGithubSessionFromRequest } from "@/lib/githubOAuth";

export async function GET(request: NextRequest) {
  try {
    const session = getGithubSessionFromRequest(request);
    if (!session) {
      return NextResponse.json(
        { error: "Sign in with GitHub to view linked wallets." },
        { status: 401 }
      );
    }

    const wallets = await listGithubLinkedWallets(session);
    return NextResponse.json(
      { wallets },
      {
        headers: {
          "Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL,
        },
      }
    );
  } catch (error: unknown) {
    console.error("GET /api/auth/github/linked-wallets error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
