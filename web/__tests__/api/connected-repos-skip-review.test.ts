// Asserts that user-supplied `skip_review: true` in the request body is IGNORED
// by the connected-repo HTTP routes — the sync is always invoked with review
// enabled (skipReview: false), regardless of what the wallet owner sends.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockSyncConnectedRepo,
  mockInitializeDatabase,
  mockVerifyConnectAuth,
  mockGetConnectedRepo,
  mockCreateConnectedRepo,
  mockListConnectedRepos,
  mockValidateRepoCoords,
  mockVerifyRepoOwnership,
} = vi.hoisted(() => ({
  mockSyncConnectedRepo: vi.fn(),
  mockInitializeDatabase: vi.fn(),
  mockVerifyConnectAuth: vi.fn(),
  mockGetConnectedRepo: vi.fn(),
  mockCreateConnectedRepo: vi.fn(),
  mockListConnectedRepos: vi.fn(),
  mockValidateRepoCoords: vi.fn(),
  mockVerifyRepoOwnership: vi.fn(),
}));

vi.mock("@/lib/mirror/sync", () => ({
  syncConnectedRepo: mockSyncConnectedRepo,
}));

vi.mock("@/lib/db", () => ({
  initializeDatabase: mockInitializeDatabase,
  sql: vi.fn(),
}));

vi.mock("@/lib/mirror/connectedRepos", () => ({
  verifyConnectAuth: mockVerifyConnectAuth,
  getConnectedRepo: mockGetConnectedRepo,
  createConnectedRepo: mockCreateConnectedRepo,
  listConnectedRepos: mockListConnectedRepos,
  validateRepoCoords: mockValidateRepoCoords,
  verifyRepoOwnership: mockVerifyRepoOwnership,
}));

import { POST as syncPost } from "@/app/api/agents/[pubkey]/repos/[id]/sync/route";
import { POST as connectPost } from "@/app/api/agents/[pubkey]/repos/route";

const PUBKEY = "WalletPubkey1111111111111111111111111111111";
const REPO_ID = "00000000-0000-0000-0000-000000000001";

const fakeRepo = {
  id: REPO_ID,
  owner_wallet: PUBKEY,
  github_owner: "testorg",
  github_repo: "testrepo",
  branch: "main",
  include_paths: [],
  verification_method: "verify-file",
  status: "active",
  last_commit_sha: null,
  last_synced_at: null,
  last_sync_status: null,
  last_sync_detail: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function makeSyncRequest(body: Record<string, unknown>) {
  return new NextRequest(
    `http://localhost/api/agents/${PUBKEY}/repos/${REPO_ID}/sync`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

function makeConnectRequest(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/agents/${PUBKEY}/repos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/agents/[pubkey]/repos/[id]/sync — skip_review bypass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitializeDatabase.mockResolvedValue(undefined);
    mockVerifyConnectAuth.mockReturnValue({ ok: true, pubkey: PUBKEY });
    mockGetConnectedRepo.mockResolvedValue(fakeRepo);
    mockSyncConnectedRepo.mockResolvedValue([]);
  });

  it("ignores skip_review: true and always calls sync with skipReview: false", async () => {
    const res = await syncPost(
      makeSyncRequest({
        auth: { sig: "x", pubkey: PUBKEY, timestamp: 1 },
        skip_review: true,
      }),
      { params: Promise.resolve({ pubkey: PUBKEY, id: REPO_ID }) }
    );

    expect(res.status).toBe(200);
    expect(mockSyncConnectedRepo).toHaveBeenCalledOnce();
    const [, opts] = mockSyncConnectedRepo.mock.calls[0];
    expect(opts.skipReview).toBe(false);
  });

  it("also passes skipReview: false when skip_review is absent", async () => {
    const res = await syncPost(
      makeSyncRequest({ auth: { sig: "x", pubkey: PUBKEY, timestamp: 1 } }),
      { params: Promise.resolve({ pubkey: PUBKEY, id: REPO_ID }) }
    );

    expect(res.status).toBe(200);
    const [, opts] = mockSyncConnectedRepo.mock.calls[0];
    expect(opts.skipReview).toBe(false);
  });
});

describe("POST /api/agents/[pubkey]/repos — skip_review bypass on connect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitializeDatabase.mockResolvedValue(undefined);
    mockVerifyConnectAuth.mockReturnValue({ ok: true, pubkey: PUBKEY });
    mockValidateRepoCoords.mockReturnValue({ ok: true, branch: "main" });
    mockVerifyRepoOwnership.mockResolvedValue({
      verified: true,
      method: "verify-file",
    });
    mockCreateConnectedRepo.mockResolvedValue({
      ok: true,
      repo: fakeRepo,
      created: true,
    });
    mockSyncConnectedRepo.mockResolvedValue([]);
  });

  it("ignores skip_review: true and always calls sync with skipReview: false", async () => {
    const res = await connectPost(
      makeConnectRequest({
        auth: { sig: "x", pubkey: PUBKEY, timestamp: 1 },
        owner: "testorg",
        repo: "testrepo",
        skip_review: true,
      }),
      { params: Promise.resolve({ pubkey: PUBKEY }) }
    );

    expect(res.status).toBe(201);
    expect(mockSyncConnectedRepo).toHaveBeenCalledOnce();
    const [, opts] = mockSyncConnectedRepo.mock.calls[0];
    expect(opts.skipReview).toBe(false);
  });
});
