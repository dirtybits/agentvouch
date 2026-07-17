/**
 * Walletless buyer account migration (one-shot, guarded).
 *
 * This script owns the additive buyer-account tables. It is intentionally not imported by
 * request-time database initializers: auth stays flag-disabled until this exact migration has
 * been rehearsed on a disposable branch of the live agentvouch-postgres project.
 *
 * Usage:
 *   DATABASE_URL=... npm run db:walletless-buyers --workspace @agentvouch/web -- preflight
 *   DATABASE_URL=... EXPECTED_DATABASE_HOST=ep-....neon.tech \
 *     npm run db:walletless-buyers --workspace @agentvouch/web -- migrate
 */
import { neon } from "@neondatabase/serverless";

type Db = ReturnType<typeof neon<false, false>>;

const EXPECTED_COLUMNS: Record<string, string[]> = {
  buyer_accounts: ["id", "status", "created_at", "updated_at", "deleted_at"],
  buyer_identity_links: [
    "id",
    "buyer_account_id",
    "provider",
    "provider_subject",
    "email_verified",
    "email_verified_at",
    "created_at",
    "last_seen_at",
  ],
  buyer_wallet_links: [
    "id",
    "buyer_account_id",
    "chain_context",
    "normalized_address",
    "challenge_version",
    "verified_at",
    "revoked_at",
    "created_at",
    "updated_at",
  ],
  marketplace_access_grants: [
    "id",
    "buyer_account_id",
    "skill_db_id",
    "source",
    "source_payment_reference",
    "status",
    "granted_at",
    "revoked_at",
    "revoked_reason",
    "created_at",
    "updated_at",
  ],
};

const EXPECTED_CONSTRAINTS: Record<string, string[]> = {
  buyer_accounts: ["buyer_accounts_pkey", "buyer_accounts_status_check"],
  buyer_identity_links: [
    "buyer_identity_links_pkey",
    "buyer_identity_links_account_fkey",
    "buyer_identity_links_provider_subject_unique",
  ],
  buyer_wallet_links: [
    "buyer_wallet_links_pkey",
    "buyer_wallet_links_account_fkey",
    "buyer_wallet_links_chain_address_unique",
  ],
  marketplace_access_grants: [
    "marketplace_access_grants_pkey",
    "marketplace_access_grants_account_fkey",
    "marketplace_access_grants_skill_fkey",
    "marketplace_access_grants_source_payment_unique",
    "marketplace_access_grants_status_check",
  ],
};

function getDbFromEnv(): { db: Db; host: string } {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is required. Confirm the target is the live agentvouch-postgres project, not the legacy project."
    );
  }
  return { db: neon(url), host: new URL(url).hostname };
}

function assertExpectedDatabaseHost(host: string): void {
  const expected = process.env.EXPECTED_DATABASE_HOST?.trim();
  if (!expected) {
    throw new Error(
      `migrate requires EXPECTED_DATABASE_HOST to match the DATABASE_URL host (currently "${host}").`
    );
  }
  if (expected !== host) {
    throw new Error(
      `EXPECTED_DATABASE_HOST ("${expected}") does not match the DATABASE_URL host ("${host}"); refusing to migrate the wrong database.`
    );
  }
}

type SchemaRow = {
  table_name: string;
  column_name: string | null;
  constraint_name: string | null;
};

async function inspectSchema(db: Db) {
  const rows = (await db`
    SELECT
      tables.table_name,
      columns.column_name,
      constraints.constraint_name
    FROM (
      VALUES
        ('buyer_accounts'),
        ('buyer_identity_links'),
        ('buyer_wallet_links'),
        ('marketplace_access_grants')
    ) AS tables(table_name)
    LEFT JOIN information_schema.columns AS columns
      ON columns.table_schema = 'public'
      AND columns.table_name = tables.table_name
    LEFT JOIN information_schema.table_constraints AS constraints
      ON constraints.table_schema = 'public'
      AND constraints.table_name = tables.table_name
    ORDER BY tables.table_name
  `) as SchemaRow[];

  const observed = new Map<
    string,
    { columns: Set<string>; constraints: Set<string> }
  >();
  for (const table of Object.keys(EXPECTED_COLUMNS)) {
    observed.set(table, { columns: new Set(), constraints: new Set() });
  }
  for (const row of rows) {
    if (row.column_name)
      observed.get(row.table_name)?.columns.add(row.column_name);
    if (row.constraint_name)
      observed.get(row.table_name)?.constraints.add(row.constraint_name);
  }
  return observed;
}

async function findDuplicateCounts(
  db: Db,
  observed: Map<string, { columns: Set<string>; constraints: Set<string> }>
) {
  const identity = observed.get("buyer_identity_links")?.columns.size
    ? (
        (await db`
        SELECT COUNT(*)::int AS count FROM (
          SELECT provider, provider_subject
          FROM buyer_identity_links
          GROUP BY provider, provider_subject
          HAVING COUNT(*) > 1
        ) duplicates
      `) as { count: number }[]
      )[0]
    : undefined;
  const wallet = observed.get("buyer_wallet_links")?.columns.size
    ? (
        (await db`
        SELECT COUNT(*)::int AS count FROM (
          SELECT chain_context, normalized_address
          FROM buyer_wallet_links
          GROUP BY chain_context, normalized_address
          HAVING COUNT(*) > 1
        ) duplicates
      `) as { count: number }[]
      )[0]
    : undefined;
  const grant = observed.get("marketplace_access_grants")?.columns.size
    ? (
        (await db`
        SELECT COUNT(*)::int AS count FROM (
          SELECT source, source_payment_reference, skill_db_id
          FROM marketplace_access_grants
          GROUP BY source, source_payment_reference, skill_db_id
          HAVING COUNT(*) > 1
        ) duplicates
      `) as { count: number }[]
      )[0]
    : undefined;
  return {
    identity: identity?.count ?? 0,
    wallet: wallet?.count ?? 0,
    grant: grant?.count ?? 0,
  };
}

async function preflight(db: Db): Promise<boolean> {
  const observed = await inspectSchema(db);
  let clean = true;

  for (const [table, expectedColumns] of Object.entries(EXPECTED_COLUMNS)) {
    const actual = observed.get(table);
    const tableAbsent = actual?.columns.size === 0;
    if (tableAbsent) {
      console.log(`OK: ${table} is absent and can be created additively.`);
      continue;
    }

    const missingColumns = expectedColumns.filter(
      (column) => !actual?.columns.has(column)
    );
    const missingConstraints = EXPECTED_CONSTRAINTS[table].filter(
      (constraint) => !actual?.constraints.has(constraint)
    );
    if (missingColumns.length || missingConstraints.length) {
      clean = false;
      console.error(
        `FAIL: ${table} is partially installed; missing columns=[${missingColumns.join(
          ", "
        )}] constraints=[${missingConstraints.join(", ")}].`
      );
    } else {
      console.log(`OK: ${table} already has the expected additive shape.`);
    }
  }

  if (!clean) return false;

  const duplicates = await findDuplicateCounts(db, observed);
  for (const [kind, count] of Object.entries(duplicates)) {
    if (count > 0) {
      clean = false;
      console.error(`FAIL: ${count} duplicate ${kind} identity group(s).`);
    }
  }
  if (clean)
    console.log("OK: no duplicate buyer identity, wallet, or grant groups.");
  return clean;
}

async function migrate(db: Db): Promise<void> {
  if (!(await preflight(db))) {
    throw new Error("Preflight failed; aborting without DDL.");
  }

  await db.transaction((txn) => [
    txn`
      CREATE TABLE IF NOT EXISTS buyer_accounts (
        id UUID CONSTRAINT buyer_accounts_pkey PRIMARY KEY DEFAULT gen_random_uuid(),
        status VARCHAR(24) NOT NULL DEFAULT 'active'
          CONSTRAINT buyer_accounts_status_check
          CHECK (status IN ('active', 'suspended', 'deleted')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `,
    txn`
      CREATE TABLE IF NOT EXISTS buyer_identity_links (
        id UUID CONSTRAINT buyer_identity_links_pkey PRIMARY KEY DEFAULT gen_random_uuid(),
        buyer_account_id UUID NOT NULL
          CONSTRAINT buyer_identity_links_account_fkey
          REFERENCES buyer_accounts(id) ON DELETE RESTRICT,
        provider VARCHAR(32) NOT NULL,
        provider_subject VARCHAR(255) NOT NULL,
        email_verified BOOLEAN NOT NULL DEFAULT FALSE,
        email_verified_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT buyer_identity_links_provider_subject_unique
          UNIQUE (provider, provider_subject)
      )
    `,
    txn`
      CREATE TABLE IF NOT EXISTS buyer_wallet_links (
        id UUID CONSTRAINT buyer_wallet_links_pkey PRIMARY KEY DEFAULT gen_random_uuid(),
        buyer_account_id UUID NOT NULL
          CONSTRAINT buyer_wallet_links_account_fkey
          REFERENCES buyer_accounts(id) ON DELETE RESTRICT,
        chain_context VARCHAR(64) NOT NULL,
        normalized_address VARCHAR(128) NOT NULL,
        challenge_version INTEGER NOT NULL DEFAULT 1,
        verified_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT buyer_wallet_links_chain_address_unique
          UNIQUE (chain_context, normalized_address)
      )
    `,
    txn`
      CREATE TABLE IF NOT EXISTS marketplace_access_grants (
        id UUID CONSTRAINT marketplace_access_grants_pkey PRIMARY KEY DEFAULT gen_random_uuid(),
        buyer_account_id UUID NOT NULL
          CONSTRAINT marketplace_access_grants_account_fkey
          REFERENCES buyer_accounts(id) ON DELETE RESTRICT,
        skill_db_id UUID NOT NULL
          CONSTRAINT marketplace_access_grants_skill_fkey
          REFERENCES skills(id) ON DELETE RESTRICT,
        source VARCHAR(32) NOT NULL,
        source_payment_reference VARCHAR(255) NOT NULL,
        status VARCHAR(24) NOT NULL DEFAULT 'active'
          CONSTRAINT marketplace_access_grants_status_check
          CHECK (status IN ('active', 'revoked', 'review')),
        granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ,
        revoked_reason VARCHAR(64),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT marketplace_access_grants_source_payment_unique
          UNIQUE (source, source_payment_reference, skill_db_id)
      )
    `,
    txn`
      CREATE INDEX IF NOT EXISTS idx_buyer_identity_links_account
      ON buyer_identity_links(buyer_account_id)
    `,
    txn`
      CREATE INDEX IF NOT EXISTS idx_buyer_wallet_links_account
      ON buyer_wallet_links(buyer_account_id)
    `,
    txn`
      CREATE INDEX IF NOT EXISTS idx_marketplace_access_grants_active_account_skill
      ON marketplace_access_grants(buyer_account_id, skill_db_id)
      WHERE status = 'active'
    `,
  ]);

  if (!(await preflight(db))) {
    throw new Error("Post-migration schema verification failed.");
  }
  console.log("Done: walletless buyer tables and indexes verified.");
}

async function main() {
  const command = process.argv[2];
  if (command !== "preflight" && command !== "migrate") {
    console.error("Usage: walletless-buyer-migration.ts <preflight|migrate>");
    process.exit(2);
  }

  const { db, host } = getDbFromEnv();
  if (command === "migrate") assertExpectedDatabaseHost(host);

  const [identity] = (await db`
    SELECT current_database() AS database
  `) as { database: string }[];
  console.log(`Target: host=${host} database=${identity?.database}`);

  if (command === "preflight") {
    process.exit((await preflight(db)) ? 0 : 1);
  }
  if (command === "migrate") {
    await migrate(db);
    return;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
