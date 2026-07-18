import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  session: vi.fn(),
  fresh: vi.fn(),
  sameOrigin: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  consume: vi.fn(),
  list: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  reverificationErrorResponse: (level: string) =>
    Response.json({ clerk: "reverification", level }, { status: 403 }),
}));
vi.mock("@/lib/buyerSession", () => ({
  getBuyerAuthStatus: () => mocks.status(),
  getBuyerSession: (request: Request) => mocks.session(request),
  hasFreshBuyerReverification: () => mocks.fresh(),
  isSameOriginMutation: (request: Request) => mocks.sameOrigin(request),
}));
vi.mock("@/lib/buyerWalletLinks", () => ({
  createBuyerWalletLinkChallenge: (input: unknown) => mocks.create(input),
  getBuyerWalletLinkChallenge: (input: unknown) => mocks.get(input),
  consumeBuyerWalletLinkChallenge: (input: unknown) => mocks.consume(input),
  listBuyerWalletLinks: (accountId: string) => mocks.list(accountId),
}));
vi.mock("@/lib/rateLimit", () => ({
  clientIpFromRequest: () => "127.0.0.1",
  checkRateLimit: () => ({ ok: true, remaining: 7, retryAfterSeconds: 0 }),
}));
vi.mock("@/lib/walletLinkChallenge", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/walletLinkChallenge")
  >();
  return {
    ...actual,
    verifyWalletLinkChallengeSignature: (...args: unknown[]) =>
      mocks.verify(...args),
  };
});

import { GET as listLinks } from "@/app/api/account/wallet-links/route";
import { POST as createChallenge } from "@/app/api/account/wallet-links/challenge/route";
import { POST as verifyChallenge } from "@/app/api/account/wallet-links/verify/route";

const accountId = "22222222-2222-4222-8222-222222222222";
const session = { accountId, sessionId: "sess_test" };
const challenge = {
  id: "11111111-1111-4111-8111-111111111111",
  accountId,
  chainContext: "eip155:84532",
  normalizedAddress: "0x1111111111111111111111111111111111111111",
  version: 1,
  message: "AgentVouch wallet ownership verification",
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 300_000),
};

function post(path: string, body: unknown, origin = "https://agentvouch.xyz") {
  return new Request(`https://agentvouch.xyz${path}`, {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("buyer wallet link routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status.mockReturnValue({ enabled: true });
    mocks.session.mockResolvedValue(session);
    mocks.fresh.mockResolvedValue(true);
    mocks.sameOrigin.mockReturnValue(true);
    mocks.create.mockResolvedValue(challenge);
    mocks.get.mockResolvedValue(challenge);
    mocks.consume.mockResolvedValue("linked");
    mocks.list.mockResolvedValue([]);
    mocks.verify.mockResolvedValue({ valid: true });
  });

  it("lists only the authenticated opaque account's active links", async () => {
    mocks.list.mockResolvedValue([
      {
        chainContext: challenge.chainContext,
        normalizedAddress: challenge.normalizedAddress,
        verifiedAt: new Date().toISOString(),
      },
    ]);
    const response = await listLinks(
      new Request("https://agentvouch.xyz/api/account/wallet-links")
    );
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(accountId);
    expect((await response.json()).links).toHaveLength(1);
  });

  it("requires same-origin, authentication, and strict Clerk reverification", async () => {
    mocks.sameOrigin.mockReturnValue(false);
    let response = await createChallenge(
      post("/api/account/wallet-links/challenge", {
        chainContext: challenge.chainContext,
        address: challenge.normalizedAddress,
      })
    );
    expect(response.status).toBe(403);

    mocks.sameOrigin.mockReturnValue(true);
    mocks.session.mockResolvedValue(null);
    response = await createChallenge(
      post("/api/account/wallet-links/challenge", {
        chainContext: challenge.chainContext,
        address: challenge.normalizedAddress,
      })
    );
    expect(response.status).toBe(401);

    mocks.session.mockResolvedValue(session);
    mocks.fresh.mockResolvedValue(false);
    response = await createChallenge(
      post("/api/account/wallet-links/challenge", {
        chainContext: challenge.chainContext,
        address: challenge.normalizedAddress,
      })
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      clerk: "reverification",
      level: "strict",
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects Base mainnet and creates a server-authored Base Sepolia challenge", async () => {
    let response = await createChallenge(
      post("/api/account/wallet-links/challenge", {
        chainContext: "eip155:8453",
        address: challenge.normalizedAddress,
      })
    );
    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();

    response = await createChallenge(
      post("/api/account/wallet-links/challenge", {
        chainContext: challenge.chainContext,
        address: challenge.normalizedAddress,
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId,
        sessionId: session.sessionId,
        target: {
          chainContext: challenge.chainContext,
          normalizedAddress: challenge.normalizedAddress,
        },
        origin: "https://agentvouch.xyz",
      })
    );
  });

  it("rejects missing, invalid, replayed, and cross-account proofs", async () => {
    mocks.get.mockResolvedValue(null);
    let response = await verifyChallenge(
      post("/api/account/wallet-links/verify", {
        challengeId: challenge.id,
        signature: "0x1234",
      })
    );
    expect(response.status).toBe(409);

    mocks.get.mockResolvedValue(challenge);
    mocks.verify.mockResolvedValue({
      valid: false,
      error: "Invalid signature",
    });
    response = await verifyChallenge(
      post("/api/account/wallet-links/verify", {
        challengeId: challenge.id,
        signature: "0x1234",
      })
    );
    expect(response.status).toBe(401);
    expect(mocks.consume).not.toHaveBeenCalled();

    mocks.verify.mockResolvedValue({ valid: true });
    mocks.consume.mockResolvedValue("replayed");
    response = await verifyChallenge(
      post("/api/account/wallet-links/verify", {
        challengeId: challenge.id,
        signature: "0x1234",
      })
    );
    expect(response.status).toBe(409);

    mocks.consume.mockResolvedValue("owned-by-other-account");
    response = await verifyChallenge(
      post("/api/account/wallet-links/verify", {
        challengeId: challenge.id,
        signature: "0x1234",
      })
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "This wallet is already linked to another AgentVouch account.",
    });
  });

  it("links only after the server-stored challenge signature verifies", async () => {
    const response = await verifyChallenge(
      post("/api/account/wallet-links/verify", {
        challengeId: challenge.id,
        signature: "0x1234",
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.verify).toHaveBeenCalledWith(challenge, "0x1234");
    expect(mocks.consume).toHaveBeenCalledWith({
      accountId,
      sessionId: session.sessionId,
      challenge,
    });
    expect(await response.json()).toEqual({
      linked: true,
      chainContext: challenge.chainContext,
      address: challenge.normalizedAddress,
    });
  });
});
