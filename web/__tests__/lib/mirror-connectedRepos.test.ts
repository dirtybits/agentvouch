import { describe, expect, it, vi, beforeEach } from "vitest";
import { sanitizeSyncedRepoUrl } from "@/lib/mirror/connectedRepos";

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
