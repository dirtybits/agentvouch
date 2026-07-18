import "server-only";

import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import {
  buildWalletLinkChallengeMessage,
  WALLET_LINK_CHALLENGE_TTL_MS,
  WALLET_LINK_CHALLENGE_VERSION,
  type WalletLinkChallenge,
  type WalletLinkTarget,
} from "@/lib/walletLinkChallenge";

type ChallengeRow = {
  id: string;
  buyer_account_id: string;
  chain_context: string;
  normalized_address: string;
  challenge_version: number;
  message: string;
  issued_at: string | Date;
  expires_at: string | Date;
};

type LinkResultRow = {
  consumed: boolean;
  linked_account_id: string | null;
  owner_account_id: string | null;
};

export type BuyerWalletLink = WalletLinkTarget & {
  verifiedAt: string;
};

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to manage buyer wallet links.");
  }
  return neon(databaseUrl);
}

function mapChallenge(row: ChallengeRow): WalletLinkChallenge {
  return {
    id: row.id,
    accountId: row.buyer_account_id,
    chainContext: row.chain_context,
    normalizedAddress: row.normalized_address,
    version: row.challenge_version,
    message: row.message,
    issuedAt: new Date(row.issued_at),
    expiresAt: new Date(row.expires_at),
  };
}

export async function createBuyerWalletLinkChallenge(input: {
  accountId: string;
  sessionId: string;
  target: WalletLinkTarget;
  origin: string;
  now?: Date;
}): Promise<WalletLinkChallenge> {
  const db = getDb();
  const id = randomUUID();
  const issuedAt = input.now ?? new Date();
  const expiresAt = new Date(issuedAt.getTime() + WALLET_LINK_CHALLENGE_TTL_MS);
  const message = buildWalletLinkChallengeMessage({
    id,
    accountId: input.accountId,
    chainContext: input.target.chainContext,
    normalizedAddress: input.target.normalizedAddress,
    origin: input.origin,
    issuedAt,
    expiresAt,
  });

  const results = await db.transaction((txn) => [
    txn`
      DELETE FROM buyer_wallet_link_challenges
      WHERE buyer_account_id = ${input.accountId}::uuid
        AND (expires_at <= NOW() OR consumed_at IS NOT NULL)
    `,
    txn`
      INSERT INTO buyer_wallet_link_challenges (
        id,
        buyer_account_id,
        session_id,
        chain_context,
        normalized_address,
        challenge_version,
        message,
        issued_at,
        expires_at
      ) VALUES (
        ${id}::uuid,
        ${input.accountId}::uuid,
        ${input.sessionId},
        ${input.target.chainContext},
        ${input.target.normalizedAddress},
        ${WALLET_LINK_CHALLENGE_VERSION},
        ${message},
        ${issuedAt.toISOString()}::timestamptz,
        ${expiresAt.toISOString()}::timestamptz
      )
      RETURNING
        id::text,
        buyer_account_id::text,
        chain_context,
        normalized_address,
        challenge_version,
        message,
        issued_at,
        expires_at
    `,
  ]);
  const row = (results[1] as ChallengeRow[])[0];
  if (!row) throw new Error("Wallet link challenge creation returned no row.");
  return mapChallenge(row);
}

export async function getBuyerWalletLinkChallenge(input: {
  accountId: string;
  sessionId: string;
  challengeId: string;
}): Promise<WalletLinkChallenge | null> {
  const db = getDb();
  const rows = (await db`
    SELECT
      id::text,
      buyer_account_id::text,
      chain_context,
      normalized_address,
      challenge_version,
      message,
      issued_at,
      expires_at
    FROM buyer_wallet_link_challenges
    WHERE id = ${input.challengeId}::uuid
      AND buyer_account_id = ${input.accountId}::uuid
      AND session_id = ${input.sessionId}
      AND consumed_at IS NULL
      AND expires_at > NOW()
  `) as ChallengeRow[];
  return rows[0] ? mapChallenge(rows[0]) : null;
}

export async function consumeBuyerWalletLinkChallenge(input: {
  accountId: string;
  sessionId: string;
  challenge: WalletLinkChallenge;
}): Promise<"linked" | "replayed" | "owned-by-other-account"> {
  const db = getDb();
  const rows = (await db`
    WITH consumed AS (
      UPDATE buyer_wallet_link_challenges
      SET consumed_at = NOW()
      WHERE id = ${input.challenge.id}::uuid
        AND buyer_account_id = ${input.accountId}::uuid
        AND session_id = ${input.sessionId}
        AND consumed_at IS NULL
        AND expires_at > NOW()
      RETURNING id
    ),
    linked AS (
      INSERT INTO buyer_wallet_links (
        buyer_account_id,
        chain_context,
        normalized_address,
        challenge_version,
        verified_at,
        revoked_at,
        updated_at
      )
      SELECT
        ${input.accountId}::uuid,
        ${input.challenge.chainContext},
        ${input.challenge.normalizedAddress},
        ${input.challenge.version},
        NOW(),
        NULL,
        NOW()
      FROM consumed
      ON CONFLICT (chain_context, normalized_address)
      DO UPDATE SET
        challenge_version = EXCLUDED.challenge_version,
        verified_at = NOW(),
        revoked_at = NULL,
        updated_at = NOW()
      WHERE buyer_wallet_links.buyer_account_id = EXCLUDED.buyer_account_id
      RETURNING buyer_account_id::text
    )
    SELECT
      EXISTS (SELECT 1 FROM consumed) AS consumed,
      (SELECT buyer_account_id FROM linked LIMIT 1) AS linked_account_id,
      (
        SELECT buyer_account_id::text
        FROM buyer_wallet_links
        WHERE chain_context = ${input.challenge.chainContext}
          AND normalized_address = ${input.challenge.normalizedAddress}
        LIMIT 1
      ) AS owner_account_id
  `) as LinkResultRow[];
  const row = rows[0];
  if (!row?.consumed) return "replayed";
  if (row.linked_account_id === input.accountId) return "linked";
  if (row.owner_account_id && row.owner_account_id !== input.accountId) {
    return "owned-by-other-account";
  }
  throw new Error(
    "Wallet link challenge was consumed without creating a link."
  );
}

export async function listBuyerWalletLinks(
  accountId: string
): Promise<BuyerWalletLink[]> {
  const db = getDb();
  const rows = (await db`
    SELECT chain_context, normalized_address, verified_at
    FROM buyer_wallet_links
    WHERE buyer_account_id = ${accountId}::uuid
      AND revoked_at IS NULL
    ORDER BY verified_at DESC
  `) as {
    chain_context: string;
    normalized_address: string;
    verified_at: string | Date;
  }[];
  return rows.map((row) => ({
    chainContext: row.chain_context,
    normalizedAddress: row.normalized_address,
    verifiedAt: new Date(row.verified_at).toISOString(),
  }));
}
