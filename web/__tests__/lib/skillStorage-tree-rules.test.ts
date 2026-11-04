import { beforeEach, describe, expect, it, vi } from "vitest";

// Blob reads are mocked so getFilesForVersion can read a stored tree offline.
vi.mock("@vercel/blob", () => ({
  get: vi.fn(),
  put: vi.fn(),
}));

import { get, put } from "@vercel/blob";
import {
  assertNoTreePathConflicts,
  buildTarArchive,
  findTreePathConflicts,
  getFileForVersion,
  getFilesForVersion,
  ingestTarArchive,
  prepareSkillTreeForMirror,
  putSkillTree,
  STORED_TREE_READ_CAPS,
} from "@/lib/skillStorage";
import {
  MIRROR_MAX_SKILL_TREE_BYTES,
  MIRROR_MAX_SKILL_TREE_FILES,
} from "@/lib/skillDraft";

const mockGet = get as unknown as ReturnType<typeof vi.fn>;
const mockPut = put as unknown as ReturnType<typeof vi.fn>;

function manyFiles(count: number) {
  const files = [{ path: "SKILL.md", bytes: Buffer.from("# Big skill\n") }];
  for (let index = 1; index < count; index += 1) {
    files.push({
      path: `references/part-${String(index).padStart(3, "0")}.md`,
      bytes: Buffer.from(`Part ${index}\n`),
    });
  }
  return files;
}

function streamOf(bytes: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

describe("tree path conflicts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("finds a path that is also a folder of another path", () => {
    expect(findTreePathConflicts(["SKILL.md", "docs", "docs/a.md"])).toEqual([
      { path: "docs", folderOf: "docs/a.md" },
    ]);
    expect(findTreePathConflicts(["SKILL.md", "docs.md", "docs/a.md"])).toEqual(
      []
    );
  });

  it("names the conflicting path in the error", () => {
    expect(() =>
      assertNoTreePathConflicts(["SKILL.md", "a/b", "a/b/c.md"])
    ).toThrow('Skill tree path "a/b" is both a file and a folder (a/b/c.md)');
  });

  it("rejects a conflicting tree on the mirror write path", () => {
    expect(() =>
      prepareSkillTreeForMirror([
        { path: "SKILL.md", content: "# Skill" },
        { path: "docs", content: "file" },
        { path: "docs/a.md", content: "nested" },
      ])
    ).toThrow("is both a file and a folder");
  });

  it("rejects a conflicting tree before it writes to Blob storage", async () => {
    await expect(
      putSkillTree([
        { path: "SKILL.md", content: "# Skill" },
        { path: "docs", content: "file" },
        { path: "docs/a.md", content: "nested" },
      ])
    ).rejects.toThrow("is both a file and a folder");
    expect(mockPut).not.toHaveBeenCalled();
  });
});

describe("stored tree read limits", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the mirror limits for stored trees", () => {
    expect(STORED_TREE_READ_CAPS).toEqual({
      maxFiles: MIRROR_MAX_SKILL_TREE_FILES,
      maxBytes: MIRROR_MAX_SKILL_TREE_BYTES,
    });
  });

  it("keeps the upload limit by default, and accepts larger stored trees with read caps", () => {
    const archive = buildTarArchive(manyFiles(250));
    expect(() => ingestTarArchive(archive)).toThrow(
      "Skill tree exceeds cap of 200 files"
    );
    expect(ingestTarArchive(archive, STORED_TREE_READ_CAPS)).toHaveLength(250);
  });

  it("serves files and per-file reads from a mirrored tree above the upload limits", async () => {
    const archive = buildTarArchive(manyFiles(250));
    mockGet.mockImplementation(async () => ({
      statusCode: 200,
      stream: streamOf(archive),
    }));
    const version = {
      content: "# Big skill\n",
      files: null,
      tree_hash: "a".repeat(64),
      storage_backend: "blob",
    };

    const files = await getFilesForVersion(version);
    expect(files).toHaveLength(250);

    const part = await getFileForVersion(version, "references/part-249.md");
    expect(part.bytes.toString("utf8")).toBe("Part 249\n");
  });
});
