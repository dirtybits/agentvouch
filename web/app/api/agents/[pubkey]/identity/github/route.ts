import { NextRequest, NextResponse } from "next/server";
import { verifyWalletSignature, type AuthPayload } from "@/lib/auth";
import { linkGithubProfileToAgent } from "@/lib/agentIdentity";
import { PRIVATE_NO_STORE_CACHE_CONTROL } from "@/lib/cachePolicy";
import { getErrorMessage } from "@/lib/errors";
import { getGithubSessionFromRequest } from "@/lib/githubOAuth";
import { verifyAuthorTrust } from "@/lib/trust";

async function getHasAgentProfile(pubkey: string): Promise<boolean> {
  return verifyAuthorTrust(pubkey)
    .then((trust) => trust.isRegistered)
    .catch(() => false);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pubkey: string }> }
) {
  try {
    const { pubkey } = await params;
    const body = (await request.json()) as { auth?: AuthPayload };

    if (!body.auth) {
      return NextResponse.json(
        { error: "Missing required field: auth" },
        { status: 400 }
      );
    }

    const verification = verifyWalletSignature(body.auth);
    if (!verification.valid || !verification.pubkey) {
      return NextResponse.json(
        { error: verification.error || "Invalid signature" },
        { status: 401 }
      );
    }

    if (verification.pubkey !== pubkey) {
      return NextResponse.json(
        { error: "Only the owner wallet can link GitHub to this identity." },
        { status: 403 }
      );
    }

    const githubSession = getGithubSessionFromRequest(request);
    if (!githubSession) {
      return NextResponse.json(
        { error: "Sign in with GitHub before linking your wallet." },
        { status: 401 }
      );
    }

    const authorIdentity = await linkGithubProfileToAgent({
      walletPubkey: pubkey,
      githubSession,
      hasAgentProfile: await getHasAgentProfile(pubkey),
    });

    return NextResponse.json(
      {
        pubkey,
        author_identity: authorIdentity,
      },
      {
        status: 201,
        headers: {
          "Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL,
        },
      }
    );
  } catch (error: unknown) {
    console.error("POST /api/agents/[pubkey]/identity/github error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
