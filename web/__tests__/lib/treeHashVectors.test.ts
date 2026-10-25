import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  buildSkillManifest,
  computeTreeHash,
  normalizeSkillPath,
  prepareSkillTree,
} from "@/lib/skillStorage";

// Shared vectors for agentvouch-tree-v1 (docs/SKILL_TREE_HASH.md). The expected
// values come from an independent stdlib Python implementation
// (packages/agentvouch-protocol/test-vectors/tree_hash_reference.py), so this
// test checks the production code against a second implementation.

type VectorFile = {
  path: string;
  content_utf8?: string;
  content_base64?: string;
};

type Vector = {
  id: string;
  description: string;
  files: VectorFile[];
  expected: {
    sorted_paths: string[];
    file_sha256: Record<string, string>;
    tree_hash: string;
  };
};

type VectorDocument = {
  schema: string;
  algorithm: string;
  vectors: Vector[];
  invalid_paths: Array<{ path: string; reason: string }>;
};

const VECTORS_PATH = path.resolve(
  __dirname,
  "../../../packages/agentvouch-protocol/test-vectors/tree-hash.json"
);
const document: VectorDocument = JSON.parse(readFileSync(VECTORS_PATH, "utf8"));

function fileBytes(file: VectorFile): Buffer {
  if (file.content_base64 !== undefined) {
    return Buffer.from(file.content_base64, "base64");
  }
  if (file.content_utf8 !== undefined) {
    return Buffer.from(file.content_utf8, "utf8");
  }
  throw new Error(`Vector file ${file.path} has no content`);
}

function filesOf(vector: Vector) {
  return vector.files.map((file) => ({
    path: file.path,
    bytes: fileBytes(file),
  }));
}

function vectorById(id: string): Vector {
  const vector = document.vectors.find((candidate) => candidate.id === id);
  if (!vector) throw new Error(`Missing vector ${id}`);
  return vector;
}

describe("tree hash shared vectors (agentvouch-tree-v1)", () => {
  it("uses the documented schema and algorithm id", () => {
    expect(document.schema).toBe("agentvouch.tree-hash-vectors/v1");
    expect(document.algorithm).toBe("agentvouch-tree-v1");
    expect(document.vectors.length).toBeGreaterThanOrEqual(10);
    expect(new Set(document.vectors.map((vector) => vector.id)).size).toBe(
      document.vectors.length
    );
  });

  describe.each(document.vectors.map((vector) => [vector.id, vector] as const))(
    "%s",
    (_id, vector) => {
      it("matches every file digest", () => {
        const manifest = buildSkillManifest(filesOf(vector));
        expect(
          Object.fromEntries(
            manifest.map((entry) => [entry.path, entry.sha256])
          )
        ).toEqual(vector.expected.file_sha256);
      });

      it("matches the tree hash computed from file bytes", () => {
        expect(computeTreeHash(filesOf(vector))).toBe(
          vector.expected.tree_hash
        );
      });

      it("matches the tree hash computed from manifest digests alone", () => {
        const digestsOnly = Object.entries(vector.expected.file_sha256).map(
          ([filePath, sha256]) => ({ path: filePath, sha256 })
        );
        expect(computeTreeHash(digestsOnly)).toBe(vector.expected.tree_hash);
      });

      it("orders paths by UTF-16 code units (JavaScript default sort)", () => {
        expect(vector.files.map((file) => file.path).sort()).toEqual(
          vector.expected.sorted_paths
        );
      });

      it("keeps the paths and the tree hash through the publish path", () => {
        const tree = prepareSkillTree(
          filesOf(vector).map((file) => ({
            path: file.path,
            content: file.bytes,
          }))
        );
        expect(tree.treeHash).toBe(vector.expected.tree_hash);
        expect(tree.manifest.map((entry) => entry.path).sort()).toEqual(
          vector.expected.sorted_paths
        );
      });
    }
  );

  it("matches the single-file SQL backfill formula in web/lib/db.ts", () => {
    const single = vectorById("single-skill-md");
    const digest = single.expected.file_sha256["SKILL.md"];
    // db.ts: digest('SKILL.md' || '\x00' || <hex digest of content>, 'sha256')
    const sqlEquivalent = createHash("sha256")
      .update(
        Buffer.concat([
          Buffer.from("SKILL.md", "utf8"),
          Buffer.from([0]),
          Buffer.from(digest, "utf8"),
        ])
      )
      .digest("hex");
    expect(sqlEquivalent).toBe(single.expected.tree_hash);
  });

  it("hashes bytes exactly: CRLF and LF versions differ", () => {
    expect(vectorById("crlf-line-endings").expected.tree_hash).not.toBe(
      vectorById("single-skill-md").expected.tree_hash
    );
  });

  it("applies no Unicode normalization to paths", () => {
    const nfc = vectorById("unicode-nfc-path");
    const nfd = vectorById("unicode-nfd-path");
    expect(nfc.files[1].path.normalize("NFC")).toBe(
      nfd.files[1].path.normalize("NFC")
    );
    expect(nfc.files[1].path).not.toBe(nfd.files[1].path);
    expect(nfc.expected.tree_hash).not.toBe(nfd.expected.tree_hash);
  });

  it("does not use locale-aware ordering", () => {
    const vector = vectorById("ascii-case-order");
    const localeOrder = vector.files
      .map((file) => file.path)
      .sort((a, b) => a.localeCompare(b));
    expect(localeOrder).not.toEqual(vector.expected.sorted_paths);
  });

  it.each(document.invalid_paths.map((entry) => [entry.path, entry.reason]))(
    "rejects invalid path %j (%s)",
    (invalidPath) => {
      expect(() => normalizeSkillPath(invalidPath)).toThrow();
    }
  );
});
