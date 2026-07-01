/**
 * Phase 6 chain-identity migration (one-shot, guarded).
 *
 * The request-time schema initializers (web/lib/db.ts, web/lib/usdcPurchases.ts) only run
 * additive, race-tolerant DDL. Anything that can fail on live data — duplicate scans and the
 * partial UNIQUE indexes below — lives here, run manually by a human who reads the output.
 * See .agents/plans/base-port-chain-adapter-phase-6.plan.md (D2/D4).
 *
 * Usage:
 *   DATABASE_URL=... npm run db:phase6-chain-identity --workspace @agentvouch/web -- preflight
 *   DATABASE_URL=... npm run db:phase6-chain-identity --workspace @agentvouch/web -- migrate
 *
 *   preflight  Read-only duplicate reports for the two identity keys. Exits non-zero on duplicates.
 *   migrate    Re-runs preflight, then lowercases stored EVM contract addresses and creates the
 *              partial UNIQUE indexes. Aborts without DDL if preflight reports duplicates.
 *
 * This script intentionally does NOT touch the legacy (skill_db_id, buyer_pubkey) entitlement
 * primary key; that destructive swap is deferred to a later multi-EVM phase.
 */
import { neon } from "@neondatabase/serverless";

type Db = ReturnType<typeof neon<false, false>>;

type EvmListingDuplicateRow = {
  chain_context: string;
  evm_contract_address: string;
  evm_listing_id: string;
  skill_ids: string[];
  row_count: number;
};

type EntitlementDuplicateRow = {
  skill_db_id: string;
  buyer_chain_context: string;
  buyer_address: string;
  buyer_pubkeys: string[];
  row_count: number;
};

function getDbFromEnv(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is required. Point it at the intended Neon project (live agentvouch-postgres, not the legacy agent-reputation-oracle project) before running."
    );
  }
  return neon(url);
}

async function findEvmListingDuplicates(
  db: Db
): Promise<EvmListingDuplicateRow[]> {
  return (await db`
    SELECT
      chain_context,
      LOWER(evm_contract_address) AS evm_contract_address,
      evm_listing_id,
      ARRAY_AGG(id::text ORDER BY created_at) AS skill_ids,
      COUNT(*)::int AS row_count
    FROM skills
    WHERE evm_listing_id IS NOT NULL
      AND evm_contract_address IS NOT NULL
    GROUP BY chain_context, LOWER(evm_contract_address), evm_listing_id
    HAVING COUNT(*) > 1
  `) as EvmListingDuplicateRow[];
}

async function findEntitlementDuplicates(
  db: Db
): Promise<EntitlementDuplicateRow[]> {
  return (await db`
    SELECT
      skill_db_id::text,
      buyer_chain_context,
      buyer_address,
      ARRAY_AGG(buyer_pubkey ORDER BY last_verified_at) AS buyer_pubkeys,
      COUNT(*)::int AS row_count
    FROM usdc_purchase_entitlements
    WHERE buyer_chain_context IS NOT NULL
      AND buyer_address IS NOT NULL
    GROUP BY skill_db_id, buyer_chain_context, buyer_address
    HAVING COUNT(*) > 1
  `) as EntitlementDuplicateRow[];
}

async function preflight(db: Db): Promise<boolean> {
  const [evmDuplicates, entitlementDuplicates] = await Promise.all([
    findEvmListingDuplicates(db),
    findEntitlementDuplicates(db),
  ]);

  if (evmDuplicates.length > 0) {
    console.error(
      `FAIL: ${evmDuplicates.length} duplicate (chain_context, evm_contract_address, evm_listing_id) group(s) in skills:`
    );
    for (const row of evmDuplicates) {
      console.error(
        `  ${row.chain_context} ${row.evm_contract_address} ${
          row.evm_listing_id
        } -> skills ${row.skill_ids.join(", ")}`
      );
    }
  } else {
    console.log("OK: no duplicate EVM listing identity groups in skills.");
  }

  if (entitlementDuplicates.length > 0) {
    console.error(
      `FAIL: ${entitlementDuplicates.length} duplicate (skill_db_id, buyer_chain_context, buyer_address) group(s) in usdc_purchase_entitlements:`
    );
    for (const row of entitlementDuplicates) {
      console.error(
        `  skill=${row.skill_db_id} ${row.buyer_chain_context} ${
          row.buyer_address
        } -> buyer_pubkeys ${row.buyer_pubkeys.join(", ")}`
      );
    }
  } else {
    console.log(
      "OK: no duplicate chain-qualified buyer groups in usdc_purchase_entitlements."
    );
  }

  const clean =
    evmDuplicates.length === 0 && entitlementDuplicates.length === 0;
  if (!clean) {
    console.error(
      "Resolve the duplicate rows intentionally (do not guess a winner), then re-run preflight."
    );
  }
  return clean;
}

async function migrate(db: Db): Promise<void> {
  const clean = await preflight(db);
  if (!clean) {
    throw new Error("Preflight reported duplicates; aborting without DDL.");
  }

  const lowered = await db`
    UPDATE skills
    SET evm_contract_address = LOWER(evm_contract_address)
    WHERE evm_contract_address IS NOT NULL
      AND evm_contract_address <> LOWER(evm_contract_address)
    RETURNING id
  `;
  console.log(
    `Lowercased evm_contract_address on ${
      (lowered as unknown[]).length
    } skills row(s).`
  );

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS uidx_skills_evm_listing_identity
    ON skills(chain_context, evm_contract_address, evm_listing_id)
    WHERE evm_listing_id IS NOT NULL
      AND evm_contract_address IS NOT NULL
  `;
  console.log("Created uidx_skills_evm_listing_identity (partial unique).");

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS uidx_usdc_purchase_entitlements_chain_buyer
    ON usdc_purchase_entitlements(skill_db_id, buyer_chain_context, buyer_address)
    WHERE buyer_chain_context IS NOT NULL
      AND buyer_address IS NOT NULL
  `;
  console.log(
    "Created uidx_usdc_purchase_entitlements_chain_buyer (partial unique)."
  );

  console.log(
    "Done. The legacy (skill_db_id, buyer_pubkey) primary key was intentionally left in place."
  );
}

async function main() {
  const command = process.argv[2];
  const db = getDbFromEnv();

  if (command === "preflight") {
    const clean = await preflight(db);
    process.exit(clean ? 0 : 1);
  }

  if (command === "migrate") {
    await migrate(db);
    return;
  }

  console.error(
    "Usage: phase6-chain-identity-migration.ts <preflight|migrate>"
  );
  process.exit(2);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
