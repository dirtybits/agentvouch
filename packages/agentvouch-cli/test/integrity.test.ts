import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CliError } from "../src/lib/errors.js";
import {
  findPathConflicts,
  sha256Hex,
  TREE_HASH_ALGORITHM,
  TreeHashMismatchError,
  treeHashFromDigests,
  treeHashFromFiles,
  verifySingleFile,
  verifyTreeFiles,
} from "../src/lib/integrity.js";

// Shared vectors for agentvouch-tree-v1 (docs/SKILL_TREE_HASH.md). The web
// implementation and an independent Python reference pass the same file.

type VectorFile = {
  path: string;
  content_utf8?: string;
  content_base64?: string;
};

type Vector = {
  id: string;
  files: VectorFile[];
  expected: {
    sorted_paths: string[];
    file_sha256: Record<string, string>;
    tree_hash: string;
  };
};

const vectorsPath = fileURLToPath(
  new URL(
    "../../agentvouch-protocol/test-vectors/tree-hash.json",
    import.meta.url
  )
);
const document = JSON.parse(readFileSync(vectorsPath, "utf8")) as {
  algorithm: string;
  vectors: Vector[];
};

function filesOf(vector: Vector) {
  return vector.files.map((file) => ({
    path: file.path,
    bytes:
      file.content_base64 !== undefined
        ? Buffer.from(file.content_base64, "base64")
        : Buffer.from(file.content_utf8 ?? "", "utf8"),
  }));
}

function manifestOf(files: Array<{ path: string; bytes: Buffer }>) {
  return files.map((file) => ({
    path: file.path,
    size: file.bytes.byteLength,
    sha256: sha256Hex(file.bytes),
  }));
}

const TREE = [
  { path: "SKILL.md", bytes: Buffer.from("# Skill\n") },
  { path: "scripts/run.sh", bytes: Buffer.from("#!/bin/sh\necho hi\n") },
];
const TREE_HASH = treeHashFromFiles(TREE);

describe("tree hash shared vectors (CLI)", () => {
  it("uses the same algorithm id as the vectors", () => {
    expect(document.algorithm).toBe(TREE_HASH_ALGORITHM);
  });

  it.each(document.vectors.map((vector) => [vector.id, vector] as const))(
    "%s: file digests, tree hash from bytes, and tree hash from digests match",
    (_id, vector) => {
      const files = filesOf(vector);
      expect(
        Object.fromEntries(
          files.map((file) => [file.path, sha256Hex(file.bytes)])
        )
      ).toEqual(vector.expected.file_sha256);
      expect(treeHashFromFiles(files)).toBe(vector.expected.tree_hash);
      expect(treeHashFromDigests(manifestOf(files))).toBe(
        vector.expected.tree_hash
      );
    }
  );
});

describe("verifyTreeFiles", () => {
  it("returns the tree hash for an exact match", () => {
    expect(verifyTreeFiles(TREE, { treeHash: TREE_HASH, label: "s1" })).toBe(
      TREE_HASH
    );
  });

  it.each([
    [
      "a changed byte",
      [TREE[0], { ...TREE[1], bytes: Buffer.from("#!/bin/sh\necho HI\n") }],
    ],
    [
      "an added file",
      [...TREE, { path: "extra.md", bytes: Buffer.from("extra") }],
    ],
    ["a renamed file", [TREE[0], { ...TREE[1], path: "scripts/other.sh" }]],
    ["a missing file", [TREE[0]]],
  ])("rejects %s with a mismatch error", (_case, files) => {
    expect(() =>
      verifyTreeFiles(files, { treeHash: TREE_HASH, label: "s1" })
    ).toThrow(TreeHashMismatchError);
  });

  it("refuses to verify without a published tree hash", () => {
    const error = (() => {
      try {
        verifyTreeFiles(TREE, { treeHash: null, label: "s1" });
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(CliError);
    expect(error).not.toBeInstanceOf(TreeHashMismatchError);
    expect((error as Error).message).toContain("has no published tree_hash");
  });

  it("refuses a tree where a path is both a file and a folder", () => {
    const files = [
      { path: "SKILL.md", bytes: Buffer.from("# Skill\n") },
      { path: "docs", bytes: Buffer.from("file") },
      { path: "docs/a.md", bytes: Buffer.from("nested") },
    ];
    expect(() =>
      verifyTreeFiles(files, {
        treeHash: treeHashFromFiles(files),
        label: "s1",
      })
    ).toThrow('contains "docs" as both a file and a folder');
  });
});

describe("verifySingleFile", () => {
  const manifest = manifestOf(TREE);

  it("checks one file against the manifest and the manifest against the tree hash", () => {
    expect(
      verifySingleFile(TREE[0], { treeHash: TREE_HASH, manifest, label: "s1" })
    ).toBe(TREE_HASH);
  });

  it("rejects a file whose bytes do not match its manifest entry", () => {
    expect(() =>
      verifySingleFile(
        { path: "SKILL.md", bytes: Buffer.from("# Changed\n") },
        { treeHash: TREE_HASH, manifest, label: "s1" }
      )
    ).toThrow("does not match the published file hash");
  });

  it("rejects a manifest that does not match the tree hash", () => {
    expect(() =>
      verifySingleFile(TREE[0], {
        treeHash: "0".repeat(64),
        manifest,
        label: "s1",
      })
    ).toThrow("does not match its published tree hash");
  });

  it("refuses to verify without a manifest or a manifest entry", () => {
    expect(() =>
      verifySingleFile(TREE[0], {
        treeHash: TREE_HASH,
        manifest: null,
        label: "s1",
      })
    ).toThrow("has no published file list");
    expect(() =>
      verifySingleFile(
        { path: "README.md", bytes: Buffer.from("x") },
        { treeHash: TREE_HASH, manifest, label: "s1" }
      )
    ).toThrow("has no entry for README.md");
  });
});

describe("findPathConflicts", () => {
  it("matches the web rule", () => {
    expect(findPathConflicts(["SKILL.md", "a", "a/b", "a/b/c"])).toEqual([
      { path: "a", folderOf: "a/b" },
      { path: "a", folderOf: "a/b/c" },
      { path: "a/b", folderOf: "a/b/c" },
    ]);
    expect(findPathConflicts(["SKILL.md", "a.md", "a/b.md"])).toEqual([]);
  });
});
