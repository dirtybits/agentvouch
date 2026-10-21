import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolveAgentIdentityByWallet } = vi.hoisted(() => ({
  mockResolveAgentIdentityByWallet: vi.fn(),
}));

vi.mock("@/lib/agentIdentity", () => ({
  resolveAgentIdentityByWallet: mockResolveAgentIdentityByWallet,
}));

import {
  sanitizeSyncedRepoUrl,
  validateRepoCoords,
  verifyRepoOwnership,
} from "@/lib/mirror/connectedRepos";

describe("sanitizeSyncedRepoUrl", () => {
  it("accepts a well-formed github.com https URL", () => {
    const url = "https://github.com/dirtybits/agentvouch";
    expect(sanitizeSyncedRepoUrl(url)).toBe(url);
  });

  it("accepts a URL with a repo path and branch fragment", () => {
    const url = "https://github.com/owner/repo/tree/main/skills";
    expect(sanitizeSyncedRepoUrl(url)).toBe(url);
  });

  it("rejects a javascript: URI", () => {
    expect(sanitizeSyncedRepoUrl("javascript:alert(1)")).toBe(null);
  });

  it("rejects a data: URI", () => {
    expect(
      sanitizeSyncedRepoUrl("data:text/html,<script>alert(1)</script>")
    ).toBe(null);
  });

  it("rejects an http:// (non-TLS) github URL", () => {
    expect(sanitizeSyncedRepoUrl("http://github.com/owner/repo")).toBe(null);
  });

  it("rejects a non-github https URL", () => {
    expect(sanitizeSyncedRepoUrl("https://evil.com/owner/repo")).toBe(null);
  });

  it("rejects a URL that starts with https://github.com. (look-alike)", () => {
    expect(
      sanitizeSyncedRepoUrl("https://github.com.evil.com/owner/repo")
    ).toBe(null);
  });

  it("returns null for null input", () => {
    expect(sanitizeSyncedRepoUrl(null)).toBe(null);
  });

  it("returns null for undefined input", () => {
    expect(sanitizeSyncedRepoUrl(undefined)).toBe(null);
  });

  it("returns null for empty string", () => {
    expect(sanitizeSyncedRepoUrl("")).toBe(null);
  });
});

describe("validateRepoCoords", () => {
  const repo = { githubOwner: "owner", githubRepo: "repo" };

  it.each(["main", "release/v1.0", "feature/fix-123"])(
    "accepts the safe branch %s",
    (branch) => {
      expect(validateRepoCoords({ ...repo, branch })).toEqual({
        ok: true,
        branch,
      });
    }
  );

  it.each([
    "../victim/repo/main",
    "main/../x",
    "/absolute",
    "main//x",
    "main/.",
    ".",
    "..",
  ])("rejects the unsafe branch %s", (branch) => {
    expect(validateRepoCoords({ ...repo, branch })).toEqual({
      ok: false,
      error: "Invalid branch",
    });
  });

  it.each([42, {}, []])(
    "rejects a non-string branch without throwing",
    (branch) => {
      expect(validateRepoCoords({ ...repo, branch })).toEqual({
        ok: false,
        error: "Invalid branch",
      });
    }
  );

  it.each([42, {}, []])(
    "rejects a non-string GitHub owner without coercing it",
    (githubOwner) => {
      expect(validateRepoCoords({ ...repo, githubOwner })).toEqual({
        ok: false,
        error: "Invalid GitHub owner",
      });
    }
  );

  it.each([42, {}, []])(
    "rejects a non-string GitHub repo without coercing it",
    (githubRepo) => {
      expect(validateRepoCoords({ ...repo, githubRepo })).toEqual({
        ok: false,
        error: "Invalid GitHub repo",
      });
    }
  );
});

describe("verifyRepoOwnership — linked-login public visibility", () => {
  const repo = {
    walletPubkey: "WalletA111111111111111111111111111111111111",
    githubOwner: "someorg",
    githubRepo: "somerepo",
    branch: "main",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAgentIdentityByWallet.mockResolvedValue({
      githubProfile: { login: "SomeOrg" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts a linked owner only after unauthenticated GitHub metadata confirms the repo is public", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ private: false }), { status: 200 })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyRepoOwnership(repo)).resolves.toEqual({
      verified: true,
      method: "linked-login",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/someorg/somerepo",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/vnd.github+json",
          "User-Agent": "agentvouch-connect",
        }),
      })
    );
    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty(
      "Authorization"
    );
  });

  it.each([
    [
      "private",
      new Response(JSON.stringify({ private: true }), { status: 200 }),
    ],
    ["unavailable", new Response(null, { status: 404 })],
    ["malformed", new Response(JSON.stringify({}), { status: 200 })],
  ])("rejects a %s linked repository", async (_kind, response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(verifyRepoOwnership(repo)).resolves.toEqual(
      expect.objectContaining({
        verified: false,
        reason: expect.stringContaining("must be public"),
      })
    );
  });

  it("rejects a linked repository when GitHub visibility lookup fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );

    await expect(verifyRepoOwnership(repo)).resolves.toEqual(
      expect.objectContaining({
        verified: false,
        reason: expect.stringContaining("must be public"),
      })
    );
  });
});

// ---- createConnectedRepo conflict path (INSERT ... ON CONFLICT) ----

const { mockSqlFn } = vi.hoisted(() => ({ mockSqlFn: vi.fn() }));

vi.mock("@/lib/db", () => ({
  sql: () => mockSqlFn,
}));

import { createConnectedRepo } from "@/lib/mirror/connectedRepos";

const baseInput = {
  ownerWallet: "WalletA111111111111111111111111111111111111",
  githubOwner: "someorg",
  githubRepo: "somerepo",
  branch: "main",
  includePaths: [],
  verificationMethod: "verify-file",
};

describe("createConnectedRepo — ON CONFLICT behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 409 when another wallet owns the repo (RETURNING 0 rows)", async () => {
    // Simulate INSERT ... ON CONFLICT DO UPDATE WHERE owner_wallet = EXCLUDED.owner_wallet
    // not matching (different wallet) → RETURNING returns empty array.
    mockSqlFn.mockResolvedValue([]);

    const result = await createConnectedRepo(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toMatch(/another wallet/);
    }
  });

  it("returns ok with created: true on a fresh insert (xmax = 0)", async () => {
    const fakeRow = {
      ...baseInput,
      id: "uuid-new",
      owner_wallet: baseInput.ownerWallet,
      github_owner: baseInput.githubOwner,
      github_repo: baseInput.githubRepo,
      include_paths: [],
      verification_method: "verify-file",
      status: "active",
      last_commit_sha: null,
      last_synced_at: null,
      last_sync_status: null,
      last_sync_detail: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      inserted: true, // xmax = 0 means new insert
    };
    mockSqlFn.mockResolvedValue([fakeRow]);

    const result = await createConnectedRepo(baseInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.created).toBe(true);
      // The `inserted` field from the DB should be stripped from the returned repo.
      expect((result.repo as Record<string, unknown>).inserted).toBeUndefined();
    }
  });

  it("returns ok with created: false on an idempotent re-connect (xmax != 0)", async () => {
    const fakeRow = {
      id: "uuid-existing",
      owner_wallet: baseInput.ownerWallet,
      github_owner: baseInput.githubOwner,
      github_repo: baseInput.githubRepo,
      branch: baseInput.branch,
      include_paths: [],
      verification_method: "verify-file",
      status: "active",
      last_commit_sha: null,
      last_synced_at: null,
      last_sync_status: null,
      last_sync_detail: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      inserted: false, // xmax != 0 means updated row
    };
    mockSqlFn.mockResolvedValue([fakeRow]);

    const result = await createConnectedRepo(baseInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.created).toBe(false);
    }
  });
});
