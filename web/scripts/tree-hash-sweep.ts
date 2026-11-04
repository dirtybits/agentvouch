/**
 * Read-only tree-hash sweep (Phase 1 of .agents/plans/skill-evals-and-packages.plan.md).
 *
 * Recomputes the tree hash (agentvouch-tree-v1, docs/SKILL_TREE_HASH.md) of stored
 * skill versions from their bytes, and compares it with skill_versions.tree_hash and
 * the stored file manifest. It also checks that skill_versions.content, which
 * /api/skills/{id}/raw serves for SKILL.md, equals SKILL.md in the stored tree.
 * Run it before the CLI starts to stop installs on a hash mismatch.
 *
 * Read-only by design:
 *   - SELECT queries only, through a direct neon client. It never calls
 *     initializeDatabase(), because that runs schema DDL and backfills.
 *   - Blob reads only (get). No put or delete.
 *   - It does not call the public download routes, because those routes record
 *     download events and change public install counts.
 *
 * Usage (from web/):
 *   npx tsx --env-file=.env.local ./scripts/tree-hash-sweep.ts [options]
 *   DATABASE_URL=... BLOB_READ_WRITE_TOKEN=... \
 *     npm run db:tree-hash-sweep --workspace @agentvouch/web -- [options]
 *
 * Options:
 *   --latest-only     Check only the newest version of each skill (default: all versions).
 *   --skill <uuid>    Check one skill (DB UUID).
 *   --limit <n>       Check at most n versions.
 *   --json <file>     Write every result, with findings and recomputed hashes, to a file.
 *   --verbose         Print one line per version, not only the failures.
 *
 * Env:
 *   DATABASE_URL            Required. The target host is printed before any query.
 *   EXPECTED_DATABASE_HOST  Optional. When set, the sweep stops unless it matches.
 *   BLOB_READ_WRITE_TOKEN   Required to read blob-backed (multi-file) versions.
 *
 * Exit codes: 0 every version matches; 1 one or more versions have findings;
 * 2 setup or usage error.
 */
import { writeFileSync } from "fs";
import { neon } from "@neondatabase/serverless";
import { buildArchiveForVersion, ingestTarArchive } from "@/lib/skillStorage";
import {
  buildSweepVersionQuery,
  sweepRowFromVersionRecord,
  sweepTreeHashes,
  TREE_HASH_ALGORITHM,
  type TreeFile,
  type TreeHashSweepEntry,
  type TreeHashSweepQueryOptions,
  type TreeHashSweepRow,
  type TreeHashSweepVersionRecord,
} from "@/lib/treeHashAudit";

type SweepOptions = TreeHashSweepQueryOptions & {
  jsonPath: string | null;
  verbose: boolean;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class UsageError extends Error {}

function parseArgs(argv: string[]): SweepOptions {
  const options: SweepOptions = {
    latestOnly: false,
    skillId: null,
    limit: null,
    jsonPath: null,
    verbose: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError(`${arg} needs a value`);
      }
      index += 1;
      return value;
    };
    if (arg === "--latest-only") options.latestOnly = true;
    else if (arg === "--verbose") options.verbose = true;
    else if (arg === "--skill") {
      const value = next();
      if (!UUID_PATTERN.test(value)) {
        throw new UsageError("--skill must be a skill DB UUID");
      }
      options.skillId = value.toLowerCase();
    } else if (arg === "--limit") {
      const value = Number(next());
      if (!Number.isInteger(value) || value <= 0) {
        throw new UsageError("--limit must be a positive integer");
      }
      options.limit = value;
    } else if (arg === "--json") options.jsonPath = next();
    else throw new UsageError(`Unknown option: ${arg}`);
  }
  return options;
}

function getDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new UsageError(
      "DATABASE_URL is required. Point it at the intended Neon project (live agentvouch-postgres, not the legacy agent-reputation-oracle project)."
    );
  }
  const host = new URL(url).hostname;
  const expected = process.env.EXPECTED_DATABASE_HOST?.trim();
  if (expected && expected !== host) {
    throw new UsageError(
      `EXPECTED_DATABASE_HOST (${expected}) does not match the DATABASE_URL host (${host}). Nothing was read.`
    );
  }
  return { db: neon(url), host };
}

/** Same sources the download routes use: inline content, or the blob tar by tree_hash. */
async function loadStoredFiles(row: TreeHashSweepRow): Promise<TreeFile[]> {
  if (row.storageBackend !== "blob") {
    if (row.content === null) {
      throw new Error("Inline version has no content");
    }
    return [{ path: "SKILL.md", bytes: Buffer.from(row.content, "utf8") }];
  }
  if (!row.storedTreeHash) {
    throw new Error(
      "Blob-backed version has no tree_hash to locate its archive"
    );
  }
  const archive = await buildArchiveForVersion({
    content: row.content ?? "",
    files: null,
    tree_hash: row.storedTreeHash,
    storage_backend: row.storageBackend,
  });
  return ingestTarArchive(archive).map((file) => ({
    path: file.path,
    bytes: Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(file.content),
  }));
}

function describeEntry({ row, result }: TreeHashSweepEntry): string {
  if (result.ok) return `ok    ${row.label}`;
  const codes = Array.from(new Set(result.findings.map((f) => f.code)));
  return `FAIL  ${row.label} (${row.skillId}): ${codes.join(", ")}`;
}

async function main(): Promise<number> {
  let options: SweepOptions;
  let database: ReturnType<typeof getDatabase>;
  try {
    options = parseArgs(process.argv.slice(2));
    database = getDatabase();
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }

  console.log(`Tree-hash sweep (${TREE_HASH_ALGORITHM}), read-only`);
  console.log(`Database host: ${database.host}`);
  console.log(
    `Scope: ${
      options.latestOnly ? "latest version of each skill" : "all versions"
    }${options.skillId ? `, skill ${options.skillId}` : ""}${
      options.limit ? `, limit ${options.limit}` : ""
    }`
  );
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.warn(
      "BLOB_READ_WRITE_TOKEN is not set: blob-backed versions will report files_unavailable."
    );
  }

  const records = (await buildSweepVersionQuery(
    database.db,
    options
  )) as TreeHashSweepVersionRecord[];
  const rows = records.map(sweepRowFromVersionRecord);
  console.log(`Versions to check: ${rows.length}`);

  const results: TreeHashSweepEntry[] = [];
  const summary = await sweepTreeHashes(rows, loadStoredFiles, (entry) => {
    results.push(entry);
    if (options.verbose || !entry.result.ok) {
      console.log(describeEntry(entry));
    }
  });

  console.log("");
  console.log(
    `Checked ${summary.checked}: ${summary.ok} match, ${summary.withFindings} with findings.`
  );
  for (const [code, count] of Object.entries(summary.findingsByCode)) {
    console.log(`  ${code}: ${count}`);
  }

  if (options.jsonPath) {
    writeFileSync(
      options.jsonPath,
      `${JSON.stringify(
        {
          algorithm: TREE_HASH_ALGORITHM,
          database_host: database.host,
          generated_at: new Date().toISOString(),
          options,
          summary: {
            checked: summary.checked,
            ok: summary.ok,
            with_findings: summary.withFindings,
            findings_by_code: summary.findingsByCode,
          },
          results: results.map(({ row, result }) => ({
            skill_id: row.skillId,
            version_id: row.versionId,
            version: row.version,
            label: row.label,
            storage_backend: row.storageBackend,
            stored_tree_hash: row.storedTreeHash,
            tree_hash_from_manifest: result.treeHashFromManifest,
            tree_hash_from_bytes: result.treeHashFromBytes,
            ok: result.ok,
            findings: result.findings,
          })),
        },
        null,
        2
      )}\n`
    );
    console.log(`Wrote ${options.jsonPath}`);
  }

  return summary.withFindings > 0 ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 2;
  });
