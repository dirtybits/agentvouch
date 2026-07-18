import "server-only";

import { neon } from "@neondatabase/serverless";

export type MarketplaceAccessGrantStatus = "active" | "revoked" | "review";

type MarketplaceAccessGrantRow = {
  buyer_account_id: string;
  skill_db_id: string;
  status: MarketplaceAccessGrantStatus;
};

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for marketplace access grants.");
  }
  return neon(databaseUrl);
}

function paymentLockKey(paymentRef: string) {
  return `marketplace-access:${paymentRef}`;
}

export async function hasActiveMarketplaceAccessGrant(
  accountId: string,
  skillDbId: string
): Promise<boolean> {
  const rows = (await getDb()`
    SELECT 1 AS present
    FROM marketplace_access_grants grants
    JOIN buyer_accounts accounts
      ON accounts.id = grants.buyer_account_id
    WHERE grants.buyer_account_id = ${accountId}::uuid
      AND grants.skill_db_id = ${skillDbId}::uuid
      AND grants.status = 'active'
      AND accounts.status = 'active'
    LIMIT 1
  `) as Array<{ present: number }>;
  return rows.length > 0;
}

/**
 * Idempotently grants access for one verified Stripe payment. A revoked row is
 * deliberately never reactivated by webhook replay; only a new payment
 * reference can create a new active grant.
 */
export async function recordStripeMarketplaceAccessGrant(input: {
  accountId: string;
  skillDbId: string;
  paymentRef: string;
}): Promise<MarketplaceAccessGrantStatus> {
  const db = getDb();
  const results = await db.transaction((txn) => [
    txn`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(
      input.paymentRef
    )}, 0))`,
    txn`
      INSERT INTO marketplace_access_grants (
        buyer_account_id,
        skill_db_id,
        source,
        source_payment_reference,
        status,
        granted_at,
        revoked_at,
        revoked_reason,
        updated_at
      )
      VALUES (
        ${input.accountId}::uuid,
        ${input.skillDbId}::uuid,
        'stripe',
        ${input.paymentRef},
        'active',
        NOW(),
        NULL,
        NULL,
        NOW()
      )
      ON CONFLICT (source, source_payment_reference, skill_db_id)
      DO UPDATE SET updated_at = NOW()
      WHERE marketplace_access_grants.buyer_account_id = EXCLUDED.buyer_account_id
        AND marketplace_access_grants.status = 'active'
      RETURNING buyer_account_id::text, skill_db_id::text, status
    `,
    txn`
      SELECT buyer_account_id::text, skill_db_id::text, status
      FROM marketplace_access_grants
      WHERE source = 'stripe'
        AND source_payment_reference = ${input.paymentRef}
        AND skill_db_id = ${input.skillDbId}::uuid
      LIMIT 1
    `,
  ]);
  const row = (results[2] as MarketplaceAccessGrantRow[])[0];
  if (!row) throw new Error("Stripe marketplace access grant was not stored.");
  if (row.buyer_account_id !== input.accountId) {
    throw new Error(
      "Stripe payment reference is already owned by another buyer."
    );
  }
  return row.status;
}

/**
 * Creates a revoked tombstone when Stripe supplies account + skill metadata,
 * so refund-before-completion ordering cannot later mint access.
 */
export async function revokeStripeMarketplaceAccessGrant(input: {
  accountId: string;
  skillDbId: string;
  paymentRef: string;
  reason: "stripe-refund" | "stripe-dispute";
}): Promise<MarketplaceAccessGrantStatus> {
  const db = getDb();
  const results = await db.transaction((txn) => [
    txn`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(
      input.paymentRef
    )}, 0))`,
    txn`
      INSERT INTO marketplace_access_grants (
        buyer_account_id,
        skill_db_id,
        source,
        source_payment_reference,
        status,
        granted_at,
        revoked_at,
        revoked_reason,
        updated_at
      )
      VALUES (
        ${input.accountId}::uuid,
        ${input.skillDbId}::uuid,
        'stripe',
        ${input.paymentRef},
        'revoked',
        NOW(),
        NOW(),
        ${input.reason},
        NOW()
      )
      ON CONFLICT (source, source_payment_reference, skill_db_id)
      DO UPDATE SET
        status = 'revoked',
        revoked_at = COALESCE(marketplace_access_grants.revoked_at, NOW()),
        revoked_reason = ${input.reason},
        updated_at = NOW()
      WHERE marketplace_access_grants.buyer_account_id = EXCLUDED.buyer_account_id
      RETURNING buyer_account_id::text, skill_db_id::text, status
    `,
  ]);
  const row = (results[1] as MarketplaceAccessGrantRow[])[0];
  if (!row) {
    throw new Error(
      "Stripe payment reference is already owned by another buyer."
    );
  }
  return row.status;
}

export async function revokeStripeMarketplaceAccessGrantsByPaymentReference(
  paymentRef: string,
  reason: "stripe-refund" | "stripe-dispute"
): Promise<Array<{ accountId: string; skillDbId: string }>> {
  const rows = (await getDb()`
    UPDATE marketplace_access_grants
    SET status = 'revoked',
        revoked_at = COALESCE(revoked_at, NOW()),
        revoked_reason = ${reason},
        updated_at = NOW()
    WHERE source = 'stripe'
      AND source_payment_reference = ${paymentRef}
      AND status <> 'revoked'
    RETURNING buyer_account_id::text, skill_db_id::text
  `) as Array<{ buyer_account_id: string; skill_db_id: string }>;
  return rows.map((row) => ({
    accountId: row.buyer_account_id,
    skillDbId: row.skill_db_id,
  }));
}
