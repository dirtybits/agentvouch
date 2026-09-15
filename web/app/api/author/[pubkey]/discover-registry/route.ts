import { NextRequest, NextResponse } from "next/server";
import { verifyAuthorTrust } from "@/lib/trust";
import { verifyWalletSignature, type AuthPayload } from "@/lib/auth";
import { discoverSolanaRegistryCandidatesByWallet } from "@/lib/solanaAgentRegistry";
import { getErrorMessage } from "@/lib/errors";
import { isValidChainAddress } from "@/lib/chainAddress";
import { getConfiguredSolanaChainContext } from "@/lib/chains";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pubkey: string }> }
) {
  try {
    const { pubkey } = await params;
    if (
      !isValidChainAddress({
        chainContext: getConfiguredSolanaChainContext(),
        value: pubkey,
      })
    ) {
      return NextResponse.json(
        { error: "Solana author routes require a valid Solana address" },
        { status: 400 }
      );
    }
    const body = (await request.json().catch(() => null)) ?? {};
    const { auth } = body as { auth: AuthPayload };

    if (!auth) {
      return NextResponse.json(
        { error: "Missing auth payload" },
        { status: 400 }
      );
    }

    const verification = verifyWalletSignature(auth);
    if (!verification.valid || !verification.pubkey) {
      return NextResponse.json(
        { error: verification.error || "Invalid signature" },
        { status: 401 }
      );
    }

    if (verification.pubkey !== pubkey) {
      return NextResponse.json(
        {
          error:
            "Only the author wallet can discover registry identities for linking",
        },
        { status: 403 }
      );
    }

    const authorTrust = await verifyAuthorTrust(pubkey);
    if (!authorTrust.isRegistered) {
      return NextResponse.json(
        {
          error:
            "You must register an on-chain AgentProfile before linking registry identity.",
        },
        { status: 403 }
      );
    }

    const candidates = await discoverSolanaRegistryCandidatesByWallet(pubkey);
    return NextResponse.json({
      pubkey,
      candidates,
    });
  } catch (error: unknown) {
    console.error("POST /api/author/[pubkey]/discover-registry error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
