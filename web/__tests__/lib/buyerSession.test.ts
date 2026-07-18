import { afterEach, describe, expect, it, vi } from "vitest";
import { auth } from "@clerk/nextjs/server";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  clerkClient: vi.fn(),
}));
vi.mock("@/lib/buyerAccounts", () => ({
  resolveBuyerAccountForIdentity: vi.fn(),
}));

import {
  buildBuyerSessionFromClerkAuth,
  hasFreshBuyerReverification,
  isSameOriginMutation,
} from "@/lib/buyerSession";

afterEach(() => vi.unstubAllEnvs());

describe("buyer session boundary", () => {
  it("maps the stable provider subject to an opaque active account", async () => {
    const resolveIdentity = vi.fn().mockResolvedValue({
      accountId: "57ab388b-9564-49de-8027-dfd35f822fa4",
      status: "active",
    });

    await expect(
      buildBuyerSessionFromClerkAuth(
        {
          userId: "user_2abc",
          sessionId: "sess_2abc",
          sessionClaims: { iat: 1_784_000_000 },
        },
        resolveIdentity
      )
    ).resolves.toEqual({
      accountId: "57ab388b-9564-49de-8027-dfd35f822fa4",
      provider: "clerk",
      providerSubject: "user_2abc",
      sessionId: "sess_2abc",
      issuedAt: 1_784_000_000,
    });
    expect(resolveIdentity).toHaveBeenCalledWith({
      provider: "clerk",
      providerSubject: "user_2abc",
    });
  });

  it("rejects signed-out and non-active identities", async () => {
    const resolveIdentity = vi.fn();
    await expect(
      buildBuyerSessionFromClerkAuth(
        { userId: null, sessionId: null },
        resolveIdentity
      )
    ).resolves.toBeNull();
    expect(resolveIdentity).not.toHaveBeenCalled();

    resolveIdentity.mockResolvedValue({
      accountId: "57ab388b-9564-49de-8027-dfd35f822fa4",
      status: "deleted",
    });
    await expect(
      buildBuyerSessionFromClerkAuth(
        { userId: "user_2abc", sessionId: "sess_2abc" },
        resolveIdentity
      )
    ).resolves.toBeNull();
  });

  it("requires an exact same-origin Origin header for mutations", () => {
    expect(
      isSameOriginMutation(
        new Request("https://agentvouch.xyz/api/auth/buyer/logout", {
          headers: { origin: "https://agentvouch.xyz" },
        })
      )
    ).toBe(true);
    expect(
      isSameOriginMutation(
        new Request("https://agentvouch.xyz/api/auth/buyer/logout", {
          headers: { origin: "https://attacker.example" },
        })
      )
    ).toBe(false);
    expect(
      isSameOriginMutation(
        new Request("https://agentvouch.xyz/api/auth/buyer/logout")
      )
    ).toBe(false);
  });

  it("uses Clerk's strict factor-verification age for sensitive mutations", async () => {
    vi.stubEnv("AGENTVOUCH_BUYER_AUTH_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_AGENTVOUCH_BUYER_AUTH_ENABLED", "true");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_example");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_example");
    const has = vi.fn().mockReturnValue(true);
    vi.mocked(auth).mockResolvedValue({
      userId: "user_2abc",
      sessionId: "sess_2abc",
      has,
    } as never);
    await expect(hasFreshBuyerReverification()).resolves.toBe(true);
    expect(has).toHaveBeenCalledWith({ reverification: "strict" });
  });
});
