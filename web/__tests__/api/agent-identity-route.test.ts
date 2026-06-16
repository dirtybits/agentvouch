import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  verifyWalletSignature: vi.fn(),
}));

vi.mock("@/lib/agentIdentity", () => ({
  linkGithubProfileToAgent: vi.fn(),
  resolveAgentIdentityByWallet: vi.fn(),
  updateAgentUsername: vi.fn(),
}));

vi.mock("@/lib/githubOAuth", () => ({
  getGithubSessionFromRequest: vi.fn(),
}));

vi.mock("@/lib/trust", () => ({
  verifyAuthorTrust: vi.fn(),
}));

import { GET, PATCH } from "@/app/api/agents/[pubkey]/identity/route";
import { POST as POST_GITHUB } from "@/app/api/agents/[pubkey]/identity/github/route";
import { verifyWalletSignature } from "@/lib/auth";
import {
  linkGithubProfileToAgent,
  resolveAgentIdentityByWallet,
  updateAgentUsername,
} from "@/lib/agentIdentity";
import { getGithubSessionFromRequest } from "@/lib/githubOAuth";
import { verifyAuthorTrust } from "@/lib/trust";

const mockVerifyWalletSignature =
  verifyWalletSignature as unknown as ReturnType<typeof vi.fn>;
const mockResolveIdentity =
  resolveAgentIdentityByWallet as unknown as ReturnType<typeof vi.fn>;
const mockUpdateUsername = updateAgentUsername as unknown as ReturnType<
  typeof vi.fn
>;
const mockLinkGithub = linkGithubProfileToAgent as unknown as ReturnType<
  typeof vi.fn
>;
const mockGithubSession = getGithubSessionFromRequest as unknown as ReturnType<
  typeof vi.fn
>;
const mockVerifyAuthorTrust = verifyAuthorTrust as unknown as ReturnType<
  typeof vi.fn
>;

function makeRequest(
  path: string,
  method: string,
  body: Record<string, unknown> = {}
) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    body: method === "GET" ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("/api/agents/[pubkey]/identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyAuthorTrust.mockResolvedValue({ isRegistered: true });
  });

  it("resolves a wallet identity with profile status on GET", async () => {
    mockResolveIdentity.mockResolvedValue({ username: "wallet-dmt4cd" });

    const res = await GET(
      makeRequest("/api/agents/Wallet111/identity", "GET"),
      { params: Promise.resolve({ pubkey: "Wallet111" }) }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.author_identity.username).toBe("wallet-dmt4cd");
    expect(mockResolveIdentity).toHaveBeenCalledWith("Wallet111", {
      hasAgentProfile: true,
    });
  });

  it("rejects username updates signed by another wallet", async () => {
    mockVerifyWalletSignature.mockReturnValue({
      valid: true,
      pubkey: "OtherWallet",
    });

    const res = await PATCH(
      makeRequest("/api/agents/Wallet111/identity", "PATCH", {
        auth: { pubkey: "OtherWallet" },
        username: "dirtybits",
      }),
      { params: Promise.resolve({ pubkey: "Wallet111" }) }
    );

    expect(res.status).toBe(403);
    expect(mockUpdateUsername).not.toHaveBeenCalled();
  });

  it("updates a username after wallet signature verification", async () => {
    mockVerifyWalletSignature.mockReturnValue({
      valid: true,
      pubkey: "Wallet111",
    });
    mockUpdateUsername.mockResolvedValue({
      username: "dirtybits",
      usernameSource: "user",
    });

    const res = await PATCH(
      makeRequest("/api/agents/Wallet111/identity", "PATCH", {
        auth: { pubkey: "Wallet111" },
        username: "dirtybits",
      }),
      { params: Promise.resolve({ pubkey: "Wallet111" }) }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.author_identity.username).toBe("dirtybits");
    expect(mockUpdateUsername).toHaveBeenCalledWith(
      expect.objectContaining({
        walletPubkey: "Wallet111",
        username: "dirtybits",
      })
    );
  });
});

describe("/api/agents/[pubkey]/identity/github", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyAuthorTrust.mockResolvedValue({ isRegistered: false });
  });

  it("requires a GitHub OAuth session before linking", async () => {
    mockVerifyWalletSignature.mockReturnValue({
      valid: true,
      pubkey: "Wallet111",
    });
    mockGithubSession.mockReturnValue(null);

    const res = await POST_GITHUB(
      makeRequest("/api/agents/Wallet111/identity/github", "POST", {
        auth: { pubkey: "Wallet111" },
      }),
      { params: Promise.resolve({ pubkey: "Wallet111" }) }
    );

    expect(res.status).toBe(401);
    expect(mockLinkGithub).not.toHaveBeenCalled();
  });

  it("links the signed-in GitHub profile to the signed wallet", async () => {
    const githubSession = {
      provider: "github" as const,
      id: "123",
      login: "dirtybits",
      name: "Dirty Bits",
      avatarUrl: null,
      createdAt: Date.now(),
    };
    mockVerifyWalletSignature.mockReturnValue({
      valid: true,
      pubkey: "Wallet111",
    });
    mockGithubSession.mockReturnValue(githubSession);
    mockLinkGithub.mockResolvedValue({
      username: "wallet-dmt4cd",
      githubProfile: { login: "dirtybits" },
    });

    const res = await POST_GITHUB(
      makeRequest("/api/agents/Wallet111/identity/github", "POST", {
        auth: { pubkey: "Wallet111" },
      }),
      { params: Promise.resolve({ pubkey: "Wallet111" }) }
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.author_identity.githubProfile.login).toBe("dirtybits");
    expect(mockLinkGithub).toHaveBeenCalledWith(
      expect.objectContaining({
        walletPubkey: "Wallet111",
        githubSession,
      })
    );
  });
});
