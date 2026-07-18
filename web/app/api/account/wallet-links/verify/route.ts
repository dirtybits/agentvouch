import { reverificationErrorResponse } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  consumeBuyerWalletLinkChallenge,
  getBuyerWalletLinkChallenge,
} from "@/lib/buyerWalletLinks";
import {
  getBuyerAuthStatus,
  getBuyerSession,
  hasFreshBuyerReverification,
  isSameOriginMutation,
} from "@/lib/buyerSession";
import { clientIpFromRequest, checkRateLimit } from "@/lib/rateLimit";
import { verifyWalletLinkChallengeSignature } from "@/lib/walletLinkChallenge";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const session = await getBuyerSession(request);
  if (!session) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 }
    );
  }
  if (!(await hasFreshBuyerReverification())) {
    return reverificationErrorResponse("strict");
  }
  const limit = checkRateLimit(
    `buyer-wallet-link-verify:${session.accountId}:${clientIpFromRequest(
      request
    )}`,
    { limit: 12, windowMs: 60_000 }
  );
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many wallet verification attempts. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      }
    );
  }

  let body: { challengeId?: unknown; signature?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const challengeId =
    typeof body.challengeId === "string" ? body.challengeId : "";
  const signature = typeof body.signature === "string" ? body.signature : "";
  if (
    !UUID_PATTERN.test(challengeId) ||
    !signature ||
    signature.length > 8_192
  ) {
    return NextResponse.json(
      { error: "Invalid wallet link proof." },
      { status: 400 }
    );
  }

  const challenge = await getBuyerWalletLinkChallenge({
    accountId: session.accountId,
    sessionId: session.sessionId,
    challengeId,
  });
  if (!challenge) {
    return NextResponse.json(
      { error: "Wallet link challenge is invalid, expired, or already used." },
      { status: 409 }
    );
  }
  const verification = await verifyWalletLinkChallengeSignature(
    challenge,
    signature
  );
  if (!verification.valid) {
    return NextResponse.json(
      { error: verification.error ?? "Invalid wallet signature." },
      { status: 401 }
    );
  }

  const result = await consumeBuyerWalletLinkChallenge({
    accountId: session.accountId,
    sessionId: session.sessionId,
    challenge,
  });
  if (result === "replayed") {
    return NextResponse.json(
      { error: "Wallet link challenge is invalid, expired, or already used." },
      { status: 409 }
    );
  }
  if (result === "owned-by-other-account") {
    return NextResponse.json(
      { error: "This wallet is already linked to another AgentVouch account." },
      { status: 409 }
    );
  }
  return NextResponse.json({
    linked: true,
    chainContext: challenge.chainContext,
    address: challenge.normalizedAddress,
  });
}
