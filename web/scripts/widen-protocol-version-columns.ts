/**
 * Protocol-version column widening (one-shot, guarded).
 *
 * The three protocol-version columns were created as VARCHAR(16), but the live Base Sepolia
 * v1 candidate reports PROTOCOL_VERSION = "base-v1-candidate" (17 chars), which PR #90 stamps
 * into fresh rows via the live contract read. Postgres rejects over-length varchar inserts, so
 * new Base listing links / receipts / entitlements against the v1 candidate fail AFTER the
 * on-chain transaction succeeds. This widens the columns to VARCHAR(64).
 *
 * Widening a varchar is metadata-only in Postgres (no table rewrite, no data that can fail),
 * but ALTER COLUMN TYPE does not belong in the request-time initializers (AGENTS.md §3.15), so
 * it lives here, run manually by a human who reads the output. Rehearse on a disposable Neon
 * branch copied from the live agentvouch-postgres project before running against production.
 *
 * Usage:
 *   DATABASE_URL=... npm run db:widen-protocol-version --workspace @agentvouch/web -- preflight
 *   DATABASE_URL=... EXPECTED_DATABASE_HOST=ep-....neon.tech \
 *     npm run db:widen-protocol-version --workspace @agentvouch/web -- migrate
 *
 *   preflight  Read-only: reports each target column's current declared varchar length and
 *              whether it needs widening. Prints the target host/database. Widening a varchar
 *              is metadata-only, so there is no stored-data check to fail.
 *   migrate    Requires EXPECTED_DATABASE_HOST to match the DATABASE_URL host. Re-runs the
 *              preflight report, widens each column still narrower than 64 to VARCHAR(64)
 *              (idempotent: already-widened columns are skipped), then re-reports.
 */
import { neon } from "@neondatabase/serverless";

type Db = ReturnType<typeof neon<false, false>>;

type TargetColumn = {
  table: string;
  column: string;
};

const TARGET_COLUMNS: TargetColumn[] = [
  { table: "skills", column: "on_chain_protocol_version" },
  { table: "usdc_purchase_receipts", column: "protocol_version" },
  { table: "usdc_purchase_entitlements", column: "protocol_version" },
];

const TARGET_LENGTH = 64;

type ColumnReport = {
  table: string;
  column: string;
  declaredLength: number | null;
  exists: boolean;
};

function getDbFromEnv(): { db: Db; host: string } {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is required. Point it at the intended Neon project (live agentvouch-postgres, not the legacy agent-reputation-oracle project) before running."
    );
  }
  return { db: neon(url), host: new URL(url).hostname };
}

// migrate refuses to run unless EXPECTED_DATABASE_HOST matches the DATABASE_URL host, so a
// stale shell env can't alter columns on the wrong Neon project ([[neon-db-two-projects]]).
function assertExpectedDatabaseHost(host: string): void {
  const expected = process.env.EXPECTED_DATABASE_HOST?.trim();
  if (!expected) {
    throw new Error(
      `migrate requires EXPECTED_DATABASE_HOST to match the DATABASE_URL host (currently "${host}"). Set EXPECTED_DATABASE_HOST=${host} after confirming this is the intended Neon project.`
    );
  }
  if (expected !== host) {
    throw new Error(
      `EXPECTED_DATABASE_HOST ("${expected}") does not match the DATABASE_URL host ("${host}"); refusing to run migrate against a possibly wrong Neon project.`
    );
  }
}

async function reportColumn(
  db: Db,
  target: TargetColumn
): Promise<ColumnReport> {
  // table_name / column_name are bound VALUES in a WHERE clause (not identifiers), so this is a
  // safe tagged-template query. `character_maximum_length` is null for non-varchar/unbounded.
  const [meta] = (await db`
    SELECT character_maximum_length AS declared_length
    FROM information_schema.columns
    WHERE table_name = ${target.table}
      AND column_name = ${target.column}
  `) as { declared_length: number | null }[];

  return {
    table: target.table,
    column: target.column,
    declaredLength: meta ? meta.declared_length : null,
    exists: Boolean(meta),
  };
}

async function preflight(db: Db): Promise<ColumnReport[]> {
  const reports: ColumnReport[] = [];
  for (const target of TARGET_COLUMNS) {
    const report = await reportColumn(db, target);
    reports.push(report);
    if (!report.exists) {
      console.log(
        `- ${target.table}.${target.column}: MISSING (initializer has not created it yet; nothing to widen)`
      );
      continue;
    }
    const declared =
      report.declaredLength === null
        ? "unbounded/non-varchar"
        : `VARCHAR(${report.declaredLength})`;
    const needsWidening =
      report.declaredLength !== null && report.declaredLength < TARGET_LENGTH;
    console.log(
      `- ${target.table}.${target.column}: declared=${declared} ${
        needsWidening
          ? `-> widen to VARCHAR(${TARGET_LENGTH})`
          : "(already wide enough; skip)"
      }`
    );
  }
  return reports;
}

async function migrate(db: Db): Promise<void> {
  console.log("Pre-migration state:");
  const reports = await preflight(db);

  for (const report of reports) {
    if (!report.exists) continue;
    if (
      report.declaredLength === null ||
      report.declaredLength >= TARGET_LENGTH
    ) {
      continue;
    }
    console.log(
      `Widening ${report.table}.${report.column} to VARCHAR(${TARGET_LENGTH})...`
    );
    // Identifiers cannot be bound parameters, so this is raw SQL via .query(). Safe: table
    // and column come only from the hardcoded TARGET_COLUMNS allowlist, never user input.
    await db.query(
      `ALTER TABLE ${report.table} ALTER COLUMN ${report.column} TYPE VARCHAR(${TARGET_LENGTH})`
    );
  }

  console.log("Post-migration state:");
  const after = await preflight(db);
  const stillNarrow = after.filter(
    (r) =>
      r.exists && r.declaredLength !== null && r.declaredLength < TARGET_LENGTH
  );
  if (stillNarrow.length > 0) {
    throw new Error(
      `Post-migration verification failed; still narrower than ${TARGET_LENGTH}: ${stillNarrow
        .map((r) => `${r.table}.${r.column}`)
        .join(", ")}`
    );
  }
  console.log("All protocol-version columns are at least VARCHAR(64).");
}

async function main() {
  const command = process.argv[2];
  const { db, host } = getDbFromEnv();

  const [identity] = (await db`
    SELECT current_database() AS database
  `) as { database: string }[];
  console.log(`Target: host=${host} database=${identity?.database}`);

  if (command === "preflight") {
    await preflight(db);
    return;
  }

  if (command === "migrate") {
    assertExpectedDatabaseHost(host);
    await migrate(db);
    return;
  }

  console.error("Usage: widen-protocol-version-columns.ts <preflight|migrate>");
  process.exit(2);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
