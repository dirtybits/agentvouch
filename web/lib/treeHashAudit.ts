// Tree-hash audit for stored skill versions (algorithm agentvouch-tree-v1).
//
// Pure functions: callers load the stored row and the file bytes, this module
// compares them. The read-only sweep (scripts/tree-hash-sweep.ts) uses it to
// check that every stored version's bytes, manifest, and tree_hash agree, and
// that /api/skills/{id}/raw (which serves skill_versions.content for SKILL.md)
// returns the same SKILL.md bytes as the tree. Spec: docs/SKILL_TREE_HASH.md.

import { createHash } from "crypto";
import { computeTreeHash, normalizeSkillPath } from "@/lib/skillStorage";

export const TREE_HASH_ALGORITHM = "agentvouch-tree-v1";

export type TreeHashFindingCode =
  | "missing_tree_hash"
  | "malformed_tree_hash"
  | "missing_manifest"
  | "invalid_manifest"
  | "manifest_tree_hash_mismatch"
  | "files_unavailable"
  | "bytes_tree_hash_mismatch"
  | "file_digest_mismatch"
  | "file_size_mismatch"
  | "file_missing_from_manifest"
  | "file_missing_from_storage"
  | "raw_skill_md_mismatch"
  | "invalid_path"
  | "duplicate_path"
  | "missing_skill_md"
  | "path_conflict";

export interface TreeHashFinding {
  code: TreeHashFindingCode;
  detail: string;
  path?: string;
}

export interface TreeManifestEntry {
  path: string;
  size: number;
  sha256: string;
}

export interface TreeFile {
  path: string;
  bytes: Buffer;
}

export interface TreeHashAuditInput {
  /** skill_versions.tree_hash */
  storedTreeHash: string | null;
  /** skill_versions.files, as read from the database (JSONB array or JSON text). */
  manifest: unknown;
  /** skill_versions.content. /api/skills/{id}/raw serves it for SKILL.md. */
  content: string | null;
  /** Files loaded from storage, or null when they could not be loaded. */
  files: ReadonlyArray<TreeFile> | null;
  /** Why the files could not be loaded, when files is null. */
  loadError?: string | null;
}

export interface TreeHashAuditResult {
  ok: boolean;
  findings: TreeHashFinding[];
  treeHashFromManifest: string | null;
  treeHashFromBytes: string | null;
}

const HEX64 = /^[0-9a-f]{64}$/;

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function parseTreeManifest(value: unknown): {
  entries: TreeManifestEntry[] | null;
  error?: string;
} {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return { entries: null, error: "manifest is not valid JSON" };
    }
  }
  if (parsed === null || parsed === undefined) return { entries: null };
  if (!Array.isArray(parsed)) {
    return { entries: null, error: "manifest is not an array" };
  }

  const entries: TreeManifestEntry[] = [];
  for (const [index, item] of parsed.entries()) {
    const record =
      item && typeof item === "object"
        ? (item as Record<string, unknown>)
        : null;
    const path = record?.path;
    const size = record?.size;
    const sha256 = record?.sha256;
    if (
      typeof path !== "string" ||
      typeof sha256 !== "string" ||
      !HEX64.test(sha256) ||
      typeof size !== "number" ||
      !Number.isInteger(size) ||
      size < 0
    ) {
      return {
        entries: null,
        error: `manifest entry ${index} needs a path, a non-negative integer size, and a lowercase hex sha256`,
      };
    }
    entries.push({ path, size, sha256 });
  }
  return { entries };
}

/**
 * Tree-level path checks from docs/SKILL_TREE_HASH.md: stored paths are already
 * in normalized form, unique, include one top-level SKILL.md, and no path is
 * also a folder of another path (such a tree cannot be written to disk).
 */
export function findTreePathProblems(
  paths: readonly string[]
): TreeHashFinding[] {
  const findings: TreeHashFinding[] = [];
  const seen = new Set<string>();

  for (const path of paths) {
    if (seen.has(path)) {
      findings.push({
        code: "duplicate_path",
        path,
        detail: `Path appears more than once: ${JSON.stringify(path)}`,
      });
      continue;
    }
    seen.add(path);

    let normalized: string | null = null;
    try {
      normalized = normalizeSkillPath(path);
    } catch (error) {
      findings.push({
        code: "invalid_path",
        path,
        detail: (error as Error).message,
      });
      continue;
    }
    if (normalized !== path) {
      findings.push({
        code: "invalid_path",
        path,
        detail: `Stored path is not in normalized form (normalizes to ${JSON.stringify(
          normalized
        )})`,
      });
    }
  }

  if (!seen.has("SKILL.md")) {
    findings.push({
      code: "missing_skill_md",
      detail: "Tree has no top-level SKILL.md",
    });
  }

  for (const path of seen) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const prefix = parts.slice(0, index).join("/");
      if (seen.has(prefix)) {
        findings.push({
          code: "path_conflict",
          path: prefix,
          detail: `${JSON.stringify(
            prefix
          )} is a file and also a folder of ${JSON.stringify(path)}`,
        });
      }
    }
  }

  return findings;
}

export function auditSkillVersionTree(
  input: TreeHashAuditInput
): TreeHashAuditResult {
  const findings: TreeHashFinding[] = [];
  const stored = input.storedTreeHash;

  if (!stored) {
    findings.push({
      code: "missing_tree_hash",
      detail: "Version has no stored tree_hash",
    });
  } else if (!HEX64.test(stored)) {
    findings.push({
      code: "malformed_tree_hash",
      detail: "Stored tree_hash is not 64 lowercase hex characters",
    });
  }
  const comparableStored = stored && HEX64.test(stored) ? stored : null;

  const manifest = parseTreeManifest(input.manifest);
  let treeHashFromManifest: string | null = null;
  if (manifest.error) {
    findings.push({ code: "invalid_manifest", detail: manifest.error });
  } else if (!manifest.entries) {
    findings.push({
      code: "missing_manifest",
      detail: "Version has no stored file manifest",
    });
  } else {
    treeHashFromManifest = computeTreeHash(manifest.entries);
    if (comparableStored && treeHashFromManifest !== comparableStored) {
      findings.push({
        code: "manifest_tree_hash_mismatch",
        detail: `Manifest digests give ${treeHashFromManifest}, stored tree_hash is ${comparableStored}`,
      });
    }
  }

  let treeHashFromBytes: string | null = null;
  if (!input.files) {
    findings.push({
      code: "files_unavailable",
      detail: input.loadError
        ? `Could not load stored files: ${input.loadError}`
        : "Could not load stored files",
    });
    if (manifest.entries) {
      findings.push(
        ...findTreePathProblems(manifest.entries.map((entry) => entry.path))
      );
    }
  } else {
    findings.push(
      ...findTreePathProblems(input.files.map((file) => file.path))
    );

    treeHashFromBytes = computeTreeHash([...input.files]);
    if (comparableStored && treeHashFromBytes !== comparableStored) {
      findings.push({
        code: "bytes_tree_hash_mismatch",
        detail: `Stored bytes give ${treeHashFromBytes}, stored tree_hash is ${comparableStored}`,
      });
    }

    if (manifest.entries) {
      const manifestByPath = new Map(
        manifest.entries.map((entry) => [entry.path, entry])
      );
      const storedPaths = new Set<string>();
      for (const file of input.files) {
        storedPaths.add(file.path);
        const entry = manifestByPath.get(file.path);
        if (!entry) {
          findings.push({
            code: "file_missing_from_manifest",
            path: file.path,
            detail: "Stored file has no manifest entry",
          });
          continue;
        }
        const digest = sha256Hex(file.bytes);
        if (digest !== entry.sha256) {
          findings.push({
            code: "file_digest_mismatch",
            path: file.path,
            detail: `Stored bytes hash to ${digest}, manifest says ${entry.sha256}`,
          });
        }
        if (file.bytes.byteLength !== entry.size) {
          findings.push({
            code: "file_size_mismatch",
            path: file.path,
            detail: `Stored file is ${file.bytes.byteLength} bytes, manifest says ${entry.size}`,
          });
        }
      }
      for (const entry of manifest.entries) {
        if (!storedPaths.has(entry.path)) {
          findings.push({
            code: "file_missing_from_storage",
            path: entry.path,
            detail: "Manifest lists a file that storage does not have",
          });
        }
      }
    }

    if (input.content !== null) {
      const treeSkillMd = input.files.find((file) => file.path === "SKILL.md");
      if (
        treeSkillMd &&
        !Buffer.from(input.content, "utf8").equals(treeSkillMd.bytes)
      ) {
        findings.push({
          code: "raw_skill_md_mismatch",
          path: "SKILL.md",
          detail:
            "skill_versions.content (served by /raw) differs from SKILL.md in the stored tree",
        });
      }
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    treeHashFromManifest,
    treeHashFromBytes,
  };
}

export interface TreeHashSweepRow {
  versionId: string;
  skillId: string;
  version: number;
  label: string;
  storedTreeHash: string | null;
  manifest: unknown;
  storageBackend: string | null;
  content: string | null;
}

export interface TreeHashSweepQueryOptions {
  latestOnly: boolean;
  skillId: string | null;
  limit: number | null;
}

/** Column shape returned by buildSweepVersionQuery. */
export interface TreeHashSweepVersionRecord {
  version_id: string;
  skill_id: string;
  version: number;
  content: string | null;
  files: unknown;
  tree_hash: string | null;
  storage_backend: string | null;
  public_author_slug: string | null;
  public_slug: string | null;
}

type SqlTemplateTag<Q> = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Q;

/**
 * The sweep's only query. SELECT-only on purpose: the sweep must not change data.
 * `sql` is a tagged-template client such as neon(DATABASE_URL); fragments compose.
 */
export function buildSweepVersionQuery<Q>(
  sql: SqlTemplateTag<Q>,
  options: TreeHashSweepQueryOptions
): Q {
  const skillFilter = options.skillId
    ? sql`AND v.skill_id = ${options.skillId}::uuid`
    : sql``;
  const limitClause = options.limit ? sql`LIMIT ${options.limit}` : sql``;

  if (options.latestOnly) {
    return sql`
      SELECT * FROM (
        SELECT DISTINCT ON (v.skill_id)
          v.id AS version_id, v.skill_id, v.version, v.content, v.files,
          v.tree_hash, v.storage_backend, s.public_author_slug, s.public_slug
        FROM skill_versions v
        JOIN skills s ON s.id = v.skill_id
        WHERE true ${skillFilter}
        ORDER BY v.skill_id, v.version DESC
      ) latest
      ORDER BY latest.skill_id
      ${limitClause}
    `;
  }
  return sql`
    SELECT
      v.id AS version_id, v.skill_id, v.version, v.content, v.files,
      v.tree_hash, v.storage_backend, s.public_author_slug, s.public_slug
    FROM skill_versions v
    JOIN skills s ON s.id = v.skill_id
    WHERE true ${skillFilter}
    ORDER BY v.skill_id, v.version
    ${limitClause}
  `;
}

export function sweepRowFromVersionRecord(
  record: TreeHashSweepVersionRecord
): TreeHashSweepRow {
  const route =
    record.public_author_slug && record.public_slug
      ? `${record.public_author_slug}/${record.public_slug}`
      : record.skill_id;
  return {
    versionId: record.version_id,
    skillId: record.skill_id,
    version: record.version,
    label: `${route} v${record.version}`,
    storedTreeHash: record.tree_hash,
    manifest: record.files,
    storageBackend: record.storage_backend,
    content: record.content,
  };
}

export interface TreeHashSweepEntry {
  row: TreeHashSweepRow;
  result: TreeHashAuditResult;
}

export interface TreeHashSweepSummary {
  checked: number;
  ok: number;
  withFindings: number;
  findingsByCode: Partial<Record<TreeHashFindingCode, number>>;
  failures: TreeHashSweepEntry[];
}

/**
 * Audit each row in order. loadFiles reads the stored bytes; a thrown error is
 * reported as files_unavailable for that row and the sweep continues.
 */
export async function sweepTreeHashes(
  rows: Iterable<TreeHashSweepRow> | AsyncIterable<TreeHashSweepRow>,
  loadFiles: (row: TreeHashSweepRow) => Promise<TreeFile[]>,
  onResult?: (entry: TreeHashSweepEntry) => void
): Promise<TreeHashSweepSummary> {
  const summary: TreeHashSweepSummary = {
    checked: 0,
    ok: 0,
    withFindings: 0,
    findingsByCode: {},
    failures: [],
  };

  for await (const row of rows) {
    let files: TreeFile[] | null = null;
    let loadError: string | null = null;
    try {
      files = await loadFiles(row);
    } catch (error) {
      loadError = (error as Error)?.message ?? String(error);
    }

    const result = auditSkillVersionTree({
      storedTreeHash: row.storedTreeHash,
      manifest: row.manifest,
      content: row.content,
      files,
      loadError,
    });
    const entry = { row, result };
    summary.checked += 1;
    if (result.ok) {
      summary.ok += 1;
    } else {
      summary.withFindings += 1;
      summary.failures.push(entry);
      for (const finding of result.findings) {
        summary.findingsByCode[finding.code] =
          (summary.findingsByCode[finding.code] ?? 0) + 1;
      }
    }
    onResult?.(entry);
  }

  return summary;
}
