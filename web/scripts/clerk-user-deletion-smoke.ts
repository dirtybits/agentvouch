import { randomUUID } from "node:crypto";
import { createClerkClient } from "@clerk/backend";
import { neon } from "@neondatabase/serverless";

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const databaseUrl = requireEnv("DATABASE_URL");
const clerkSecretKey = requireEnv("CLERK_SECRET_KEY");

async function main() {
  const db = neon(databaseUrl);
  const clerk = createClerkClient({ secretKey: clerkSecretKey });
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const email = `agentvouch+clerk_test_delete_${suffix}@example.com`;
  const sourcePaymentReference = `clerk-delete-smoke:${suffix}`;
  const user = await clerk.users.createUser({ emailAddress: [email] });
  let accountId: string | null = null;

  try {
    const skillRows = (await db`
    SELECT id::text AS id
    FROM skills
    ORDER BY created_at ASC
    LIMIT 1
  `) as { id: string }[];
    const skillDbId = skillRows[0]?.id;
    if (!skillDbId) throw new Error("Deletion smoke requires one skill row.");

    accountId = randomUUID();
    await db.transaction((txn) => [
      txn`
      INSERT INTO buyer_accounts (id, status)
      VALUES (${accountId}, 'active')
    `,
      txn`
      INSERT INTO buyer_identity_links (
        buyer_account_id,
        provider,
        provider_subject,
        email_verified,
        email_verified_at
      ) VALUES (
        ${accountId},
        'clerk',
        ${user.id},
        TRUE,
        NOW()
      )
    `,
      txn`
      INSERT INTO marketplace_access_grants (
        buyer_account_id,
        skill_db_id,
        source,
        source_payment_reference,
        status
      ) VALUES (
        ${accountId},
        ${skillDbId},
        'clerk-deletion-smoke',
        ${sourcePaymentReference},
        'active'
      )
    `,
    ]);

    console.log(
      JSON.stringify({
        phase: "prepared",
        userId: user.id,
        accountId,
        skillDbId,
        sourcePaymentReference,
      })
    );

    await clerk.users.deleteUser(user.id);
    console.log(
      JSON.stringify({ phase: "provider-user-deleted", userId: user.id })
    );

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const rows = (await db`
      SELECT
        accounts.status,
        accounts.deleted_at,
        (
          SELECT COUNT(*)::integer
          FROM buyer_identity_links identities
          WHERE identities.buyer_account_id = accounts.id
        ) AS identity_count,
        (
          SELECT COUNT(*)::integer
          FROM marketplace_access_grants grants
          WHERE grants.buyer_account_id = accounts.id
            AND grants.source_payment_reference = ${sourcePaymentReference}
        ) AS retained_grant_count,
        (
          SELECT COUNT(*)::integer
          FROM marketplace_access_grants grants
          JOIN buyer_accounts active_accounts
            ON active_accounts.id = grants.buyer_account_id
          WHERE grants.buyer_account_id = accounts.id
            AND grants.source_payment_reference = ${sourcePaymentReference}
            AND grants.status = 'active'
            AND active_accounts.status = 'active'
        ) AS active_access_count
      FROM buyer_accounts accounts
      WHERE accounts.id = ${accountId}
    `) as {
        status: string;
        deleted_at: string | null;
        identity_count: number;
        retained_grant_count: number;
        active_access_count: number;
      }[];
      const row = rows[0];
      if (
        row?.status === "deleted" &&
        row.deleted_at &&
        row.identity_count === 0 &&
        row.retained_grant_count === 1 &&
        row.active_access_count === 0
      ) {
        console.log(
          JSON.stringify({
            phase: "verified",
            userId: user.id,
            accountId,
            ...row,
          })
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }

    throw new Error(
      `Timed out waiting for user.deleted reconciliation for account ${accountId}.`
    );
  } catch (error) {
    await clerk.users.deleteUser(user.id).catch(() => undefined);
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
