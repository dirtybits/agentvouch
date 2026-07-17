import "server-only";

import { auth, clerkClient } from "@clerk/nextjs/server";
import {
  isBuyerAuthServerEnabled,
  type BuyerAuthConfiguration,
  getBuyerAuthConfiguration,
} from "@/lib/buyerAuthConfig";
import {
  resolveBuyerAccountForIdentity,
  type BuyerAccountIdentity,
} from "@/lib/buyerAccounts";

export type BuyerSession = {
  accountId: string;
  provider: "clerk";
  providerSubject: string;
  sessionId: string;
  issuedAt: number | null;
};

export type ClerkAuthSnapshot = {
  userId: string | null | undefined;
  sessionId: string | null | undefined;
  sessionClaims?: { iat?: number } | null;
};

type ResolveBuyerIdentity = (input: {
  provider: "clerk";
  providerSubject: string;
}) => Promise<BuyerAccountIdentity>;

export async function buildBuyerSessionFromClerkAuth(
  snapshot: ClerkAuthSnapshot,
  resolveIdentity: ResolveBuyerIdentity = resolveBuyerAccountForIdentity
): Promise<BuyerSession | null> {
  if (!snapshot.userId || !snapshot.sessionId) return null;

  const identity = await resolveIdentity({
    provider: "clerk",
    providerSubject: snapshot.userId,
  });
  if (identity.status !== "active") return null;

  return {
    accountId: identity.accountId,
    provider: "clerk",
    providerSubject: snapshot.userId,
    sessionId: snapshot.sessionId,
    issuedAt:
      typeof snapshot.sessionClaims?.iat === "number"
        ? snapshot.sessionClaims.iat
        : null,
  };
}

export function isSameOriginMutation(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function getBuyerAuthStatus(): BuyerAuthConfiguration {
  return getBuyerAuthConfiguration();
}

export async function getBuyerSession(
  request?: Request
): Promise<BuyerSession | null> {
  void request;
  if (!isBuyerAuthServerEnabled()) return null;
  const snapshot = await auth();
  return buildBuyerSessionFromClerkAuth(snapshot);
}

export async function revokeCurrentBuyerSession(): Promise<boolean> {
  if (!isBuyerAuthServerEnabled()) return false;
  const snapshot = await auth();
  if (!snapshot.sessionId) return false;
  const client = await clerkClient();
  await client.sessions.revokeSession(snapshot.sessionId);
  return true;
}
