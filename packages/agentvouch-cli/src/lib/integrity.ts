import { createHash } from "node:crypto";
import { CliError } from "./errors.js";

// Skill tree hash, algorithm agentvouch-tree-v1 (docs/SKILL_TREE_HASH.md).
// The CLI checks every download against the published tree hash before it
// writes any file. The shared vectors in
// packages/agentvouch-protocol/test-vectors/tree-hash.json pin this code to the
// web implementation and to an independent Python reference.

export const TREE_HASH_ALGORITHM = "agentvouch-tree-v1";

export interface TreeDigestEntry {
  path: string;
  sha256: string;
}

export interface TreeFileBytes {
  path: string;
  bytes: Uint8Array;
}

export interface ExpectedTree {
  /** tree_hash from GET /api/skills/{id} */
  treeHash: string | null | undefined;
  /** files (the manifest) from GET /api/skills/{id} */
  manifest?: ReadonlyArray<TreeDigestEntry> | null;
  /** Skill id for error messages. */
  label: string;
}

/** The downloaded bytes do not match the published hashes. */
export class TreeHashMismatchError extends CliError {}

const NOTHING_WRITTEN =
  "Nothing was written. If this was a paid install, your access is kept; run the command again to retry the download.";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Steps 2-6 of the algorithm: entries, UTF-16 code unit sort, LF join, SHA-256. */
export function treeHashFromDigests(
  entries: ReadonlyArray<TreeDigestEntry>
): string {
  const lines = entries.map((entry) => `${entry.path}\0${entry.sha256}`).sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

export function treeHashFromFiles(files: ReadonlyArray<TreeFileBytes>): string {
  return treeHashFromDigests(
    files.map((file) => ({ path: file.path, sha256: sha256Hex(file.bytes) }))
  );
}

/** Pairs where one path is also a folder of another ("docs" and "docs/a.md"). */
export function findPathConflicts(
  paths: readonly string[]
): Array<{ path: string; folderOf: string }> {
  const seen = new Set(paths);
  const conflicts: Array<{ path: string; folderOf: string }> = [];
  for (const filePath of seen) {
    const parts = filePath.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const prefix = parts.slice(0, index).join("/");
      if (seen.has(prefix)) {
        conflicts.push({ path: prefix, folderOf: filePath });
      }
    }
  }
  return conflicts;
}

function requireTreeHash(expected: ExpectedTree): string {
  if (!expected.treeHash) {
    throw new CliError(
      `Skill ${expected.label} has no published tree_hash, so the CLI cannot check the download. Nothing was written.`
    );
  }
  return expected.treeHash;
}

/** Check a full tree download. Returns the verified tree hash. */
export function verifyTreeFiles(
  files: ReadonlyArray<TreeFileBytes>,
  expected: ExpectedTree
): string {
  const treeHash = requireTreeHash(expected);
  const [conflict] = findPathConflicts(files.map((file) => file.path));
  if (conflict) {
    throw new CliError(
      `Skill ${expected.label} contains "${conflict.path}" as both a file and a folder (${conflict.folderOf}), so it cannot be written to disk. Nothing was written.`
    );
  }
  const actual = treeHashFromFiles(files);
  if (actual !== treeHash) {
    throw new TreeHashMismatchError(
      `Downloaded files for skill ${expected.label} do not match the published tree hash.\n  expected ${treeHash}\n  received ${actual}\n${NOTHING_WRITTEN}`
    );
  }
  return treeHash;
}

/**
 * Check one downloaded file: its digest must match the manifest entry, and the
 * manifest must produce the published tree hash. Returns the verified tree hash.
 */
export function verifySingleFile(
  file: TreeFileBytes,
  expected: ExpectedTree
): string {
  const treeHash = requireTreeHash(expected);
  if (!expected.manifest || expected.manifest.length === 0) {
    throw new CliError(
      `Skill ${expected.label} has no published file list, so the CLI cannot check ${file.path}. Nothing was written.`
    );
  }
  const entry = expected.manifest.find(
    (candidate) => candidate.path === file.path
  );
  if (!entry) {
    throw new CliError(
      `The published file list for skill ${expected.label} has no entry for ${file.path}. Nothing was written.`
    );
  }
  const digest = sha256Hex(file.bytes);
  if (digest !== entry.sha256) {
    throw new TreeHashMismatchError(
      `Downloaded ${file.path} for skill ${expected.label} does not match the published file hash.\n  expected ${entry.sha256}\n  received ${digest}\n${NOTHING_WRITTEN}`
    );
  }
  const manifestTreeHash = treeHashFromDigests(expected.manifest);
  if (manifestTreeHash !== treeHash) {
    throw new TreeHashMismatchError(
      `The published file list for skill ${expected.label} does not match its published tree hash.\n  expected ${treeHash}\n  file list gives ${manifestTreeHash}\n${NOTHING_WRITTEN}`
    );
  }
  return treeHash;
}
