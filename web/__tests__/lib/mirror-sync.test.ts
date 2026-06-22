import { beforeEach, describe, expect, it, vi } from "vitest";

// --- hoisted mocks ---
const {
  mockSqlFn,
  mockPutBlob,
  mockDelBlob,
  mockPinSkillContent,
  mockFetchRepoTree,
  mockFetchSkillFiles,
  mockResolveRepoRef,
  mockBuildUniquePublicSkillRoute,
  mockRunReviewSafe,
  mockVerifyAuthorTrust,
  mockListActiveConnectedRepos,
  mockUpdateConnectedRepoSyncState,
} = vi.hoisted(() => ({
  mockSqlFn: vi.fn(),
  mockPutBlob: vi.fn(),
  mockDelBlob: vi.fn(),
  mockPinSkillContent: vi.fn(),
  mockFetchRepoTree: vi.fn(),
  mockFetchSkillFiles: vi.fn(),
  mockResolveRepoRef: vi.fn(),
  mockBuildUniquePublicSkillRoute: vi.fn(),
  mockRunReviewSafe: vi.fn(),
  mockVerifyAuthorTrust: vi.fn(),
  mockListActiveConnectedRepos: vi.fn(),
  mockUpdateConnectedRepoSyncState: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  sql: () => mockSqlFn,
}));

vi.mock("@vercel/blob", () => ({
  put: mockPutBlob,
  del: mockDelBlob,
  get: vi.fn(),
}));

vi.mock("@/lib/ipfs", () => ({
  pinSkillContent: mockPinSkillContent,
}));

vi.mock("@/lib/mirror/github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mirror/github")>();
  return {
    ...actual,
    fetchRepoTree: mockFetchRepoTree,
    fetchSkillFiles: mockFetchSkillFiles,
    resolveRepoRef: mockResolveRepoRef,
  };
});

vi.mock("@/lib/skillRouteResolver", () => ({
  buildUniquePublicSkillRoute: mockBuildUniquePublicSkillRoute,
}));

vi.mock("@/lib/ai/review", () => ({
  runReviewSafe: mockRunReviewSafe,
}));

vi.mock("@/lib/trust", () => ({
  verifyAuthorTrust: mockVerifyAuthorTrust,
}));

vi.mock("@/lib/mirror/connectedRepos", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/mirror/connectedRepos")
  >();
  return {
    ...actual,
    listActiveConnectedRepos: mockListActiveConnectedRepos,
    updateConnectedRepoSyncState: mockUpdateConnectedRepoSyncState,
  };
});

vi.mock("@/lib/mirror/sources", () => ({
  getMirrorSources: vi.fn(() => [
    {
      key: "test-source",
      owner: "testowner",
      repo: "testrepo",
      branch: "main",
      includePathPrefixes: [],
      githubId: "gh-123",
      handle: "testowner",
      displayName: "Test Owner",
      tags: ["mirror"],
    },
  ]),
}));

vi.mock("@/lib/chains", () => ({
  getConfiguredSolanaChainContext: vi.fn(() => "solana:devnet"),
}));

import { syncMirrorSkills } from "@/lib/mirror/sync";

// A minimal SKILL.md file set for a single mirrored skill with an MIT license.
function makeSkillFiles(content = "# Hello\n\nA test skill.") {
  return [
    { path: "SKILL.md", content },
    {
      path: "LICENSE",
      content: "MIT License\n\nPermission is hereby granted, free of charge",
    },
  ];
}

const COMMIT_SHA = "abc123def456789012345678901234567890";

function setupCommonMocks() {
  mockResolveRepoRef.mockResolvedValue({ commitSha: COMMIT_SHA });
  mockFetchRepoTree.mockResolvedValue([
    {
      path: "skills/hello/SKILL.md",
      type: "blob",
      sha: "blobsha1",
    },
  ]);
  mockFetchSkillFiles.mockResolvedValue(makeSkillFiles());
  mockPinSkillContent.mockResolvedValue({ success: true, cid: "bafy-test" });
  mockPutBlob.mockResolvedValue({ url: "https://blob.example/test.tar" });
  mockDelBlob.mockResolvedValue(undefined);
  mockRunReviewSafe.mockResolvedValue(undefined);
  mockVerifyAuthorTrust.mockResolvedValue({ isRegistered: false });
  mockBuildUniquePublicSkillRoute.mockResolvedValue({
    publicAuthorSlug: "testowner",
    publicSlug: "hello",
  });
}

describe("syncMirrorSkills — change detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupCommonMocks();
  });

  it("creates a new listing when the skill is not yet listed", async () => {
    // findExistingListing returns no rows → create path
    mockSqlFn
      .mockResolvedValueOnce([]) // findExistingListing
      .mockResolvedValueOnce([{ id: "skill-db-id" }]); // INSERT skills + skill_versions CTE

    const result = await syncMirrorSkills({ apply: true, skipReview: true });

    expect(result.counts.create).toBe(1);
    expect(result.counts.error).toBe(0);
    // DB insert was called
    expect(mockSqlFn).toHaveBeenCalledTimes(2);
    // Blob was written (writePreparedTreeToBlob uses put)
    expect(mockPutBlob).toHaveBeenCalledOnce();
  });

  it("publishes a new version when the tree hash changed", async () => {
    const existing = {
      id: "existing-skill-id",
      current_version: 3,
      price_usdc_micros: null,
      on_chain_address: null,
    };
    mockSqlFn
      .mockResolvedValueOnce([existing]) // findExistingListing
      .mockResolvedValueOnce([{ tree_hash: "old-hash" }]) // markProvenance (no-op update, reuse)
      .mockResolvedValueOnce(undefined) // markProvenance UPDATE
      .mockResolvedValueOnce([{ tree_hash: "old-hash" }]) // latestTreeHash
      .mockResolvedValueOnce([{ version: 4 }]); // publishNewVersion CTE

    // Override latestTreeHash so hash differs from the prepared tree
    // The real prepareSkillTree computes a deterministic hash; just ensure
    // the stored hash is something different.
    mockSqlFn.mockReset();
    mockSqlFn
      .mockResolvedValueOnce([existing]) // findExistingListing
      .mockResolvedValueOnce(undefined) // markProvenance UPDATE
      .mockResolvedValueOnce([{ tree_hash: "DIFFERENT-OLD-HASH" }]) // latestTreeHash
      .mockResolvedValueOnce([{ version: 4 }]); // publishNewVersion

    const result = await syncMirrorSkills({ apply: true, skipReview: true });

    expect(result.counts.update).toBe(1);
    expect(result.counts.error).toBe(0);
  });

  it("skips when the tree hash is unchanged", async () => {
    // We need to know what hash prepareSkillTreeForMirror will produce for our
    // fixture files. Import the real storage to compute it.
    const { prepareSkillTree } = await import("@/lib/skillStorage");
    const prepared = prepareSkillTree(makeSkillFiles());
    const currentHash = prepared.treeHash;

    const existing = {
      id: "existing-skill-id",
      current_version: 2,
      price_usdc_micros: null,
      on_chain_address: null,
    };
    mockSqlFn
      .mockResolvedValueOnce([existing]) // findExistingListing
      .mockResolvedValueOnce(undefined) // markProvenance UPDATE
      .mockResolvedValueOnce([{ tree_hash: currentHash }]); // latestTreeHash → same

    const result = await syncMirrorSkills({ apply: true, skipReview: true });

    expect(result.counts.unchanged).toBe(1);
    expect(result.counts.update).toBe(0);
    // No blob write for unchanged
    expect(mockPutBlob).not.toHaveBeenCalled();
  });

  it("dry-run (apply:false) reports create without writing to DB or blob", async () => {
    mockSqlFn.mockResolvedValueOnce([]); // findExistingListing

    const result = await syncMirrorSkills({ apply: false, skipReview: true });

    expect(result.counts.create).toBe(1);
    // DB insert not called (only the findExistingListing query)
    expect(mockSqlFn).toHaveBeenCalledTimes(1);
    expect(mockPutBlob).not.toHaveBeenCalled();
  });
});
