import { NextRequest, NextResponse } from "next/server";
import { verifyWalletSignature, type AuthPayload } from "@/lib/auth";
import {
  resolveAgentIdentityByWallet,
  updateAgentUsername,
} from "@/lib/agentIdentity";
import { PRIVATE_NO_STORE_CACHE_CONTROL } from "@/lib/cachePolicy";
import { getErrorMessage } from "@/lib/errors";
import { verifyAuthorTrust } from "@/lib/trust";

async function getHasAgentProfile(pubkey: string): Promise<boolean> {
  return verifyAuthorTrust(pubkey)
    .then((trust) => trust.isRegistered)
    .catch(() => false);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ pubkey: string }> }
) {
  try {
    const { pubkey } = await params;
    const authorIdentity = await resolveAgentIdentityByWallet(pubkey, {
      hasAgentProfile: await getHasAgentProfile(pubkey),
    });

    return NextResponse.json(
      {
        pubkey,
        author_identity: authorIdentity,
      },
      {
        headers: {
          "Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL,
        },
      }
    );
  } catch (error: unknown) {
    console.error("GET /api/agents/[pubkey]/identity error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ pubkey: string }> }
) {
  try {
    const { pubkey } = await params;
    const body = (await request.json()) as {
      auth?: AuthPayload;
      username?: string;
    };

    if (!body.auth || typeof body.username !== "string") {
      return NextResponse.json(
        { error: "Missing required fields: auth, username" },
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
        { error: "Only the owner wallet can update this identity." },
        { status: 403 }
      );
    }

    const authorIdentity = await updateAgentUsername({
      walletPubkey: pubkey,
      username: body.username,
      hasAgentProfile: await getHasAgentProfile(pubkey),
    });

    return NextResponse.json(
      {
        pubkey,
        author_identity: authorIdentity,
      },
      {
        headers: {
          "Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL,
        },
      }
    );
  } catch (error: unknown) {
    console.error("PATCH /api/agents/[pubkey]/identity error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
