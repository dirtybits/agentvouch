import { reverificationErrorResponse } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createBuyerWalletLinkChallenge } from "@/lib/buyerWalletLinks";
import {
  getBuyerAuthStatus,
  getBuyerSession,
  hasFreshBuyerReverification,
  isSameOriginMutation,
} from "@/lib/buyerSession";
import { clientIpFromRequest, checkRateLimit } from "@/lib/rateLimit";
import { normalizeWalletLinkTarget } from "@/lib/walletLinkChallenge";

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
    `buyer-wallet-link-challenge:${session.accountId}:${clientIpFromRequest(
      request
    )}`,
    { limit: 8, windowMs: 60_000 }
  );
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many wallet link attempts. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      }
    );
  }

  let body: { chainContext?: unknown; address?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const target = normalizeWalletLinkTarget({
    chainContext:
      typeof body.chainContext === "string" ? body.chainContext : null,
    address: typeof body.address === "string" ? body.address : null,
  });
  if (!target) {
    return NextResponse.json(
      {
        error:
          "Use a valid address on the configured Solana network or Base Sepolia.",
      },
      { status: 400 }
    );
  }

  const challenge = await createBuyerWalletLinkChallenge({
    accountId: session.accountId,
    sessionId: session.sessionId,
    target,
    origin: new URL(request.url).origin,
  });
  return NextResponse.json({
    challengeId: challenge.id,
    chainContext: challenge.chainContext,
    address: challenge.normalizedAddress,
    message: challenge.message,
    expiresAt: challenge.expiresAt.toISOString(),
  });
}
