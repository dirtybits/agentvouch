import "server-only";

import { neon } from "@neondatabase/serverless";

export type BuyerAccountStatus = "active" | "suspended" | "deleted";

export type BuyerAccountIdentity = {
  accountId: string;
  status: BuyerAccountStatus;
};

export type DeletedBuyerAccountIdentity = {
  accountId: string | null;
  identityLinksRemoved: number;
};

type BuyerAccountIdentityRow = {
  buyer_account_id: string;
  status: BuyerAccountStatus;
};

function getBuyerAccountsDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required to resolve an authenticated buyer account."
    );
  }
  return neon(databaseUrl);
}

function validateProviderIdentity(provider: string, providerSubject: string) {
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(provider)) {
    throw new Error("Invalid buyer identity provider.");
  }
  if (!providerSubject.trim() || providerSubject.length > 255) {
    throw new Error("Invalid buyer provider subject.");
  }
}

export async function resolveBuyerAccountForIdentity(input: {
  provider: "clerk";
  providerSubject: string;
}): Promise<BuyerAccountIdentity> {
  validateProviderIdentity(input.provider, input.providerSubject);
  const db = getBuyerAccountsDb();
  const lockKey = `${input.provider}:${input.providerSubject}`;

  try {
    const results = await db.transaction((txn) => [
      txn`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      txn`
        WITH existing_identity AS (
          SELECT
            buyer_identity_links.buyer_account_id AS id,
            buyer_accounts.status
          FROM buyer_identity_links
          JOIN buyer_accounts
            ON buyer_accounts.id = buyer_identity_links.buyer_account_id
          WHERE buyer_identity_links.provider = ${input.provider}
            AND buyer_identity_links.provider_subject = ${input.providerSubject}
        ),
        created_account AS (
          INSERT INTO buyer_accounts (status)
          SELECT 'active'
          WHERE NOT EXISTS (SELECT 1 FROM existing_identity)
          RETURNING id, status
        ),
        selected_account AS (
          SELECT id, status FROM existing_identity
          UNION ALL
          SELECT id, status FROM created_account
          LIMIT 1
        ),
        linked_identity AS (
          INSERT INTO buyer_identity_links (
            buyer_account_id,
            provider,
            provider_subject,
            last_seen_at
          )
          SELECT
            id,
            ${input.provider},
            ${input.providerSubject},
            NOW()
          FROM selected_account
          ON CONFLICT (provider, provider_subject)
          DO UPDATE SET last_seen_at = NOW()
          RETURNING buyer_account_id
        )
        SELECT
          linked_identity.buyer_account_id,
          selected_account.status
        FROM linked_identity
        JOIN selected_account
          ON selected_account.id = linked_identity.buyer_account_id
      `,
    ]);

    const row = (results[1] as BuyerAccountIdentityRow[])[0];
    if (!row) {
      throw new Error("Buyer identity resolution returned no account.");
    }
    return { accountId: row.buyer_account_id, status: row.status };
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "42P01") {
      throw new Error(
        "Buyer account schema is not installed. Run the guarded walletless-buyer migration before enabling buyer auth."
      );
    }
    throw error;
  }
}

/**
 * Reconciles a provider-side identity deletion without deleting financial
 * history. The account row becomes an access-denying tombstone and provider
 * identity attributes are removed. Replays are intentionally successful even
 * after the identity link has already been removed.
 */
export async function deleteBuyerAccountForIdentity(input: {
  provider: "clerk";
  providerSubject: string;
}): Promise<DeletedBuyerAccountIdentity> {
  validateProviderIdentity(input.provider, input.providerSubject);
  const db = getBuyerAccountsDb();
  const lockKey = `${input.provider}:${input.providerSubject}`;

  try {
    const results = await db.transaction((txn) => [
      txn`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      txn`
        WITH matching_identity AS MATERIALIZED (
          SELECT buyer_account_id
          FROM buyer_identity_links
          WHERE provider = ${input.provider}
            AND provider_subject = ${input.providerSubject}
        ),
        deleted_account AS (
          UPDATE buyer_accounts
          SET
            status = 'deleted',
            deleted_at = COALESCE(deleted_at, NOW()),
            updated_at = NOW()
          WHERE id IN (SELECT buyer_account_id FROM matching_identity)
          RETURNING id
        ),
        deleted_identities AS (
          DELETE FROM buyer_identity_links
          WHERE buyer_account_id IN (SELECT id FROM deleted_account)
          RETURNING id
        )
        SELECT
          deleted_account.id AS buyer_account_id,
          (SELECT COUNT(*)::integer FROM deleted_identities)
            AS identity_links_removed
        FROM deleted_account
      `,
    ]);

    const row = (
      results[1] as {
        buyer_account_id: string;
        identity_links_removed: number;
      }[]
    )[0];
    return {
      accountId: row?.buyer_account_id ?? null,
      identityLinksRemoved: row?.identity_links_removed ?? 0,
    };
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "42P01") {
      throw new Error(
        "Buyer account schema is not installed. Run the guarded walletless-buyer migration before enabling Clerk lifecycle reconciliation."
      );
    }
    throw error;
  }
}
