import { createHash } from "crypto";
import { neon } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";
import { buildSkillManifest, computeTreeHash } from "@/lib/skillStorage";
import {
  auditSkillVersionTree,
  buildSweepVersionQuery,
  findTreePathProblems,
  parseTreeManifest,
  sweepRowFromVersionRecord,
  sweepTreeHashes,
  type TreeFile,
  type TreeHashAuditInput,
  type TreeHashSweepRow,
} from "@/lib/treeHashAudit";

const SKILL_MD = "---\nname: demo\ndescription: Demo skill.\n---\n\n# Demo\n";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function tree(files: Record<string, string>): TreeFile[] {
  return Object.entries(files).map(([path, text]) => ({
    path,
    bytes: Buffer.from(text, "utf8"),
  }));
}

/** A stored version whose manifest, tree_hash, and content all agree. */
function cleanVersion(files: TreeFile[]): TreeHashAuditInput {
  const manifest = buildSkillManifest(files);
  const skillMd = files.find((file) => file.path === "SKILL.md");
  return {
    storedTreeHash: computeTreeHash(manifest),
    manifest,
    content: skillMd ? skillMd.bytes.toString("utf8") : null,
    files,
  };
}

function codes(input: TreeHashAuditInput): string[] {
  return auditSkillVersionTree(input)
    .findings.map((finding) => finding.code)
    .sort();
}

const MULTI_FILE = tree({
  "SKILL.md": SKILL_MD,
  "references/api.md": "# API\n",
  "scripts/run.sh": "#!/bin/sh\necho hi\n",
});

describe("auditSkillVersionTree", () => {
  it("passes a clean single-file (inline) version", () => {
    const result = auditSkillVersionTree(
      cleanVersion(tree({ "SKILL.md": SKILL_MD }))
    );
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.treeHashFromBytes).toBe(result.treeHashFromManifest);
  });

  it("passes a clean multi-file version and accepts the manifest as JSON text", () => {
    const input = cleanVersion(MULTI_FILE);
    expect(auditSkillVersionTree(input).ok).toBe(true);
    expect(
      auditSkillVersionTree({
        ...input,
        manifest: JSON.stringify(input.manifest),
      }).ok
    ).toBe(true);
  });

  it("reports a stored tree_hash that matches neither the manifest nor the bytes", () => {
    const input = cleanVersion(MULTI_FILE);
    expect(codes({ ...input, storedTreeHash: "0".repeat(64) })).toEqual([
      "bytes_tree_hash_mismatch",
      "manifest_tree_hash_mismatch",
    ]);
  });

  it("reports missing and malformed tree hashes without other noise", () => {
    const input = cleanVersion(MULTI_FILE);
    expect(codes({ ...input, storedTreeHash: null })).toEqual([
      "missing_tree_hash",
    ]);
    expect(codes({ ...input, storedTreeHash: "ABC" })).toEqual([
      "malformed_tree_hash",
    ]);
  });

  it("reports stored bytes that changed after the manifest was written", () => {
    const input = cleanVersion(MULTI_FILE);
    const changed = MULTI_FILE.map((file) =>
      file.path === "references/api.md"
        ? { ...file, bytes: Buffer.from("# API v2\n", "utf8") }
        : file
    );
    const result = auditSkillVersionTree({ ...input, files: changed });
    expect(result.findings.map((finding) => finding.code).sort()).toEqual([
      "bytes_tree_hash_mismatch",
      "file_digest_mismatch",
      "file_size_mismatch",
    ]);
    expect(
      result.findings.find((finding) => finding.code === "file_digest_mismatch")
        ?.path
    ).toBe("references/api.md");
  });

  it("reports a manifest digest that does not match the bytes", () => {
    const input = cleanVersion(MULTI_FILE);
    const manifest = buildSkillManifest(MULTI_FILE).map((entry) =>
      entry.path === "scripts/run.sh"
        ? { ...entry, sha256: sha256(Buffer.from("other")) }
        : entry
    );
    expect(codes({ ...input, manifest })).toEqual([
      "file_digest_mismatch",
      "manifest_tree_hash_mismatch",
    ]);
  });

  it("reports a manifest size that does not match the bytes", () => {
    const input = cleanVersion(MULTI_FILE);
    const manifest = buildSkillManifest(MULTI_FILE).map((entry) =>
      entry.path === "SKILL.md" ? { ...entry, size: entry.size + 1 } : entry
    );
    expect(codes({ ...input, manifest })).toEqual(["file_size_mismatch"]);
  });

  it("reports files that are only in storage or only in the manifest", () => {
    const input = cleanVersion(MULTI_FILE);
    const extra = [
      ...MULTI_FILE,
      { path: "assets/extra.txt", bytes: Buffer.from("x") },
    ];
    expect(codes({ ...input, files: extra })).toEqual([
      "bytes_tree_hash_mismatch",
      "file_missing_from_manifest",
    ]);

    const missing = MULTI_FILE.filter((file) => file.path !== "scripts/run.sh");
    expect(codes({ ...input, files: missing })).toEqual([
      "bytes_tree_hash_mismatch",
      "file_missing_from_storage",
    ]);
  });

  it("reports when /raw content differs from SKILL.md in the stored tree", () => {
    const input = cleanVersion(MULTI_FILE);
    expect(codes({ ...input, content: `${SKILL_MD}\nextra\n` })).toEqual([
      "raw_skill_md_mismatch",
    ]);
  });

  it("still checks the manifest when stored files cannot be loaded", () => {
    const input = cleanVersion(MULTI_FILE);
    const result = auditSkillVersionTree({
      ...input,
      files: null,
      loadError: "Stored skill archive was not found",
    });
    expect(result.findings.map((finding) => finding.code)).toEqual([
      "files_unavailable",
    ]);
    expect(result.findings[0].detail).toContain(
      "Stored skill archive was not found"
    );
    expect(result.treeHashFromManifest).toBe(input.storedTreeHash);
    expect(result.treeHashFromBytes).toBeNull();
  });

  it("reports missing and invalid manifests", () => {
    const input = cleanVersion(MULTI_FILE);
    expect(codes({ ...input, manifest: null })).toEqual(["missing_manifest"]);
    expect(codes({ ...input, manifest: "{not json" })).toEqual([
      "invalid_manifest",
    ]);
    expect(codes({ ...input, manifest: { path: "SKILL.md" } })).toEqual([
      "invalid_manifest",
    ]);
  });
});

describe("parseTreeManifest", () => {
  it("rejects entries without a lowercase hex sha256 or a valid size", () => {
    const good = { path: "SKILL.md", size: 1, sha256: "a".repeat(64) };
    expect(parseTreeManifest([good]).entries).toEqual([good]);
    expect(
      parseTreeManifest([{ ...good, sha256: "A".repeat(64) }]).error
    ).toBeDefined();
    expect(parseTreeManifest([{ ...good, size: -1 }]).error).toBeDefined();
    expect(parseTreeManifest([{ ...good, size: 1.5 }]).error).toBeDefined();
    expect(parseTreeManifest(undefined)).toEqual({ entries: null });
  });
});

describe("findTreePathProblems", () => {
  it("accepts a normal tree", () => {
    expect(
      findTreePathProblems(["SKILL.md", "references/a.md", "scripts/run.sh"])
    ).toEqual([]);
  });

  it("reports a path that is both a file and a folder", () => {
    const findings = findTreePathProblems(["SKILL.md", "docs", "docs/a.md"]);
    expect(findings.map((finding) => finding.code)).toEqual(["path_conflict"]);
    expect(findings[0].path).toBe("docs");
  });

  it("reports duplicates, a missing SKILL.md, and paths not in stored form", () => {
    expect(
      findTreePathProblems(["README.md", "README.md"]).map(
        (finding) => finding.code
      )
    ).toEqual(["duplicate_path", "missing_skill_md"]);
    expect(
      findTreePathProblems(["SKILL.md", "a\\b.md", " c.md", "../d.md"]).map(
        (finding) => finding.code
      )
    ).toEqual(["invalid_path", "invalid_path", "invalid_path"]);
  });
});

describe("sweepTreeHashes", () => {
  function row(id: string, input: TreeHashAuditInput): TreeHashSweepRow {
    return {
      versionId: `${id}-version`,
      skillId: id,
      version: 1,
      label: `author/${id} v1`,
      storedTreeHash: input.storedTreeHash,
      manifest: input.manifest,
      storageBackend: "blob",
      content: input.content,
    };
  }

  it("audits every row, counts findings by code, and keeps going after load errors", async () => {
    const clean = cleanVersion(MULTI_FILE);
    const rows = [
      row("clean", clean),
      row("tampered", { ...clean, storedTreeHash: "f".repeat(64) }),
      row("unloadable", clean),
    ];
    const seen: string[] = [];
    const summary = await sweepTreeHashes(
      rows,
      async (current) => {
        if (current.skillId === "unloadable") throw new Error("blob missing");
        return MULTI_FILE;
      },
      (entry) => seen.push(`${entry.row.skillId}:${entry.result.ok}`)
    );

    expect(seen).toEqual(["clean:true", "tampered:false", "unloadable:false"]);
    expect(summary.checked).toBe(3);
    expect(summary.ok).toBe(1);
    expect(summary.withFindings).toBe(2);
    expect(summary.findingsByCode).toEqual({
      bytes_tree_hash_mismatch: 1,
      manifest_tree_hash_mismatch: 1,
      files_unavailable: 1,
    });
    expect(summary.failures.map((entry) => entry.row.skillId)).toEqual([
      "tampered",
      "unloadable",
    ]);
  });
});

describe("buildSweepVersionQuery", () => {
  // neon() builds queries lazily: nothing is sent until a query is awaited, so
  // these tests compile the exact SQL offline.
  const db = neon(
    "postgresql://user:password@ep-example.us-east-2.aws.neon.tech/db"
  );

  function compile(options: Parameters<typeof buildSweepVersionQuery>[1]) {
    const query = buildSweepVersionQuery(db, options) as unknown as {
      queryData: {
        toParameterizedQuery(): { query: string; params: unknown[] };
      };
    };
    return query.queryData.toParameterizedQuery();
  }

  it.each([
    { latestOnly: false, skillId: null, limit: null },
    { latestOnly: true, skillId: null, limit: null },
    {
      latestOnly: true,
      skillId: "11111111-2222-4333-8444-555555555555",
      limit: 25,
    },
  ])("is a single SELECT with no write statements (%o)", (options) => {
    const { query } = compile(options);
    const normalized = query.replace(/\s+/g, " ").trim();
    expect(normalized.startsWith("SELECT")).toBe(true);
    expect(normalized).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|COPY|MERGE)\b/i
    );
    expect(normalized).not.toContain(";");
  });

  it("binds the skill filter and the limit as parameters", () => {
    const skillId = "11111111-2222-4333-8444-555555555555";
    const { query, params } = compile({
      latestOnly: false,
      skillId,
      limit: 25,
    });
    expect(params).toEqual([skillId, 25]);
    expect(query).toContain("AND v.skill_id = $1::uuid");
    expect(query).toContain("LIMIT $2");
    expect(query).not.toContain(skillId);
  });

  it("selects the newest version per skill in latest-only mode", () => {
    const { query } = compile({ latestOnly: true, skillId: null, limit: null });
    expect(query).toContain("DISTINCT ON (v.skill_id)");
    expect(query).toContain("ORDER BY v.skill_id, v.version DESC");
  });
});

describe("sweepRowFromVersionRecord", () => {
  it("labels rows with the public route when it exists", () => {
    const base = {
      version_id: "v-1",
      skill_id: "s-1",
      version: 3,
      content: SKILL_MD,
      files: [],
      tree_hash: "a".repeat(64),
      storage_backend: "inline",
      public_author_slug: "anthropics",
      public_slug: "pdf",
    };
    expect(sweepRowFromVersionRecord(base).label).toBe("anthropics/pdf v3");
    expect(
      sweepRowFromVersionRecord({ ...base, public_slug: null }).label
    ).toBe("s-1 v3");
  });
});
