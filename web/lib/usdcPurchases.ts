import { sql } from "@/lib/db";
import { normalizeInputChainContext } from "@/lib/chains";

let schemaReady: Promise<void> | null = null;

export const REPO_X402_PAYMENT_FLOW = "repo-x402-usdc";
export const DIRECT_PURCHASE_PAYMENT_FLOW = "direct-purchase-skill";
export const X402_BRIDGE_PURCHASE_PAYMENT_FLOW = "x402-bridge-purchase-skill";

export type ChainQualifiedBuyer = {
  buyerChainContext: string;
  buyerAddress: string;
};

export type X402SettlementAttemptClaim =
  | { claimed: true }
  | {
      claimed: false;
      status: "pending" | "complete" | "failed";
      transaction: string | null;
      updatedAt: string | null;
    };

export type X402SettlementEntitlement = {
  transaction: string;
  payer: string;
  chainContext: string | null;
  evmListingId: string | null;
  evmPurchaseId: string | null;
  listingRevision: string | null;
};

function normalizeChainContextForStorage(
  chainContext: string | null | undefined
): string | null {
  if (!chainContext) return null;
  return normalizeInputChainContext(chainContext) ?? chainContext;
}

function normalizeChainAddress(
  chainContext: string | null,
  value: string | null | undefined
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return chainContext?.startsWith("eip155:") ? trimmed.toLowerCase() : trimmed;
}

export async function ensureUsdcPurchaseSchema() {
  if (schemaReady) {
    return schemaReady;
  }

  schemaReady = (async () => {
    const db = sql();

    await db`
      CREATE TABLE IF NOT EXISTS usdc_purchase_receipts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        skill_db_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        buyer_pubkey VARCHAR(44) NOT NULL,
        buyer_chain_context VARCHAR(64),
        buyer_address VARCHAR(128),
        payment_tx_signature VARCHAR(128) NOT NULL UNIQUE,
        recipient_ata VARCHAR(44) NOT NULL,
        recipient_chain_context VARCHAR(64),
        recipient_address VARCHAR(128),
        currency_mint VARCHAR(44) NOT NULL,
        asset_chain_context VARCHAR(64),
        asset_address VARCHAR(128),
        amount_micros BIGINT NOT NULL,
        payment_flow VARCHAR(64),
        protocol_version VARCHAR(64),
        on_chain_program_id VARCHAR(44),
        chain_context VARCHAR(64),
        on_chain_address VARCHAR(44),
        evm_listing_id VARCHAR(66),
        evm_purchase_id VARCHAR(66),
        purchase_pda VARCHAR(44),
        listing_revision BIGINT,
        settlement_pda VARCHAR(44),
        author_proceeds_vault VARCHAR(44),
        x402_payment_ref_hash VARCHAR(64),
        x402_settlement_signature_hash VARCHAR(64),
        x402_settlement_receipt_pda VARCHAR(44),
        x402_settlement_vault VARCHAR(44),
        refund_status VARCHAR(32) DEFAULT 'none',
        legacy_refund_eligible BOOLEAN DEFAULT FALSE,
        verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await db`
      ALTER TABLE usdc_purchase_receipts
      ADD COLUMN IF NOT EXISTS buyer_chain_context VARCHAR(64)
    `;

    await db`
      ALTER TABLE usdc_purchase_receipts
      ADD COLUMN IF NOT EXISTS buyer_address VARCHAR(128)
    `;

    await db`
      ALTER TABLE usdc_purchase_receipts
      ADD COLUMN IF NOT EXISTS recipient_chain_context VARCHAR(64)
    `;

    await db`
      ALTER TABLE usdc_purchase_receipts
      ADD COLUMN IF NOT EXISTS recipient_address VARCHAR(128)
    `;

    await db`
      ALTER TABLE usdc_purchase_receipts
      ADD COLUMN IF NOT EXISTS asset_chain_context VARCHAR(64)
    `;

    await db`
      ALTER TABLE usdc_purchase_receipts
      ADD COLUMN IF NOT EXISTS asset_address VARCHAR(128)
    `;

    await db`
      ALTER TABLE usdc_purchase_receipts
      ADD COLUMN IF NOT EXISTS payment_flow VARCHAR(64)
    `;

    await db`
      ALTER TABLE usdc_purchase_receipts
      ADD COLUMN IF NOT EXISTS protocol_version VARCHAR(64)
    `;

    await db`
      ALTER TABLE usdc_purchase_receipts
      ADD COLUMN IF NOT EXISTS on_chain_program_id VARCHAR(44)
    `;

    await db`
      ALTER TABLE usdc_purchase_receipts
      ADD COLUMN IF NOT EXISTS chain_context VARCHAR(64)
    `;

    await db`
      ALTER TABLE usdc_purchase_receipts
      ADD COLUMN IF NOT EXISTS on_chain_address VARCHAR(44)
    `;

    await db`
      ALTER TABLE usdc_purchase_receipts
      ADD COLUMN IF NOT EXISTS evm_listing_id VARCHAR(66)
    `;

    await db`
      ALTER TABLE usdc_purchase_receipts
      ADD COLUMN IF NOT EXISTS evm_purchase_id VARCHAR(66)
    `;

    await db`
      ALTER TABLE usdc_purchase_receipts
      ADD COLUMN IF NOT EXISTS purchase_pda VARCHAR(44)
    `;

    await db`
      ALTER TABLE usdc_purchase_receipts
      ADD COLUMN IF NOT EXISTS listing_revision BIGINT
    `;

    await db`
      ALTER TABLE usdc_purchase_receipts
      ADD COLUMN IF NOT EXISTS settlement_pda VARCHAR(44)
    `;

    await db`
      ALTER TABLE usdc_purchase_receipts
      ADD COLUMN IF NOT EXISTS author_proceeds_vault VARCHAR(44)
    `;

    await db`
      ALTER TABLE usdc_purchase_receipts
      ADD COLUMN IF NOT EXISTS x402_payment_ref_hash VARCHAR(64)
    `;

    await db`
      ALTER TABLE usdc_purchase_receipts
      ADD COLUMN IF NOT EXISTS x402_settlement_signature_hash VARCHAR(64)
    `;

    await db`
      ALTER TABLE usdc_purchase_receipts
      ADD COLUMN IF NOT EXISTS x402_settlement_receipt_pda VARCHAR(44)
    `;

    await db`
      ALTER TABLE usdc_purchase_receipts
      ADD COLUMN IF NOT EXISTS x402_settlement_vault VARCHAR(44)
    `;

    await db`
      ALTER TABLE usdc_purchase_receipts
      ADD COLUMN IF NOT EXISTS refund_status VARCHAR(32) DEFAULT 'none'
    `;

    await db`
      ALTER TABLE usdc_purchase_receipts
      ADD COLUMN IF NOT EXISTS legacy_refund_eligible BOOLEAN DEFAULT FALSE
    `;

    await db`
      UPDATE usdc_purchase_receipts
      SET payment_flow = COALESCE(payment_flow, ${REPO_X402_PAYMENT_FLOW})
      WHERE payment_flow IS NULL
    `;

    await db`
      UPDATE usdc_purchase_receipts
      SET
        buyer_chain_context = COALESCE(buyer_chain_context, chain_context),
        buyer_address = COALESCE(buyer_address, buyer_pubkey),
        recipient_chain_context = COALESCE(recipient_chain_context, chain_context),
        recipient_address = COALESCE(recipient_address, recipient_ata),
        asset_chain_context = COALESCE(asset_chain_context, chain_context),
        asset_address = COALESCE(asset_address, currency_mint)
      WHERE buyer_chain_context IS NULL
         OR buyer_address IS NULL
         OR recipient_chain_context IS NULL
         OR recipient_address IS NULL
         OR asset_chain_context IS NULL
         OR asset_address IS NULL
    `;

    await db`
      ALTER TABLE usdc_purchase_receipts
      DROP CONSTRAINT IF EXISTS usdc_purchase_receipts_skill_db_id_buyer_pubkey_key
    `;

    await db`
      CREATE INDEX IF NOT EXISTS idx_usdc_purchase_receipts_skill_buyer
      ON usdc_purchase_receipts(skill_db_id, buyer_pubkey)
    `;

    await db`
      CREATE TABLE IF NOT EXISTS usdc_purchase_entitlements (
        skill_db_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        buyer_pubkey VARCHAR(44) NOT NULL,
        buyer_chain_context VARCHAR(64),
        buyer_address VARCHAR(128),
        latest_receipt_id UUID NOT NULL REFERENCES usdc_purchase_receipts(id) ON DELETE CASCADE,
        payment_tx_signature VARCHAR(128) NOT NULL,
        recipient_ata VARCHAR(44) NOT NULL,
        recipient_chain_context VARCHAR(64),
        recipient_address VARCHAR(128),
        currency_mint VARCHAR(44) NOT NULL,
        asset_chain_context VARCHAR(64),
        asset_address VARCHAR(128),
        amount_micros BIGINT NOT NULL,
        payment_flow VARCHAR(64),
        protocol_version VARCHAR(64),
        on_chain_program_id VARCHAR(44),
        chain_context VARCHAR(64),
        on_chain_address VARCHAR(44),
        evm_listing_id VARCHAR(66),
        evm_purchase_id VARCHAR(66),
        purchase_pda VARCHAR(44),
        listing_revision BIGINT,
        settlement_pda VARCHAR(44),
        author_proceeds_vault VARCHAR(44),
        x402_payment_ref_hash VARCHAR(64),
        x402_settlement_signature_hash VARCHAR(64),
        x402_settlement_receipt_pda VARCHAR(44),
        x402_settlement_vault VARCHAR(44),
        refund_status VARCHAR(32) DEFAULT 'none',
        legacy_refund_eligible BOOLEAN DEFAULT FALSE,
        first_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (skill_db_id, buyer_pubkey)
      )
    `;

    await db`
      ALTER TABLE usdc_purchase_entitlements
      ADD COLUMN IF NOT EXISTS buyer_chain_context VARCHAR(64)
    `;

    await db`
      ALTER TABLE usdc_purchase_entitlements
      ADD COLUMN IF NOT EXISTS buyer_address VARCHAR(128)
    `;

    await db`
      ALTER TABLE usdc_purchase_entitlements
      ADD COLUMN IF NOT EXISTS recipient_chain_context VARCHAR(64)
    `;

    await db`
      ALTER TABLE usdc_purchase_entitlements
      ADD COLUMN IF NOT EXISTS recipient_address VARCHAR(128)
    `;

    await db`
      ALTER TABLE usdc_purchase_entitlements
      ADD COLUMN IF NOT EXISTS asset_chain_context VARCHAR(64)
    `;

    await db`
      ALTER TABLE usdc_purchase_entitlements
      ADD COLUMN IF NOT EXISTS asset_address VARCHAR(128)
    `;

    await db`
      ALTER TABLE usdc_purchase_entitlements
      ADD COLUMN IF NOT EXISTS payment_flow VARCHAR(64)
    `;

    await db`
      ALTER TABLE usdc_purchase_entitlements
      ADD COLUMN IF NOT EXISTS protocol_version VARCHAR(64)
    `;

    await db`
      ALTER TABLE usdc_purchase_entitlements
      ADD COLUMN IF NOT EXISTS on_chain_program_id VARCHAR(44)
    `;

    await db`
      ALTER TABLE usdc_purchase_entitlements
      ADD COLUMN IF NOT EXISTS chain_context VARCHAR(64)
    `;

    await db`
      ALTER TABLE usdc_purchase_entitlements
      ADD COLUMN IF NOT EXISTS on_chain_address VARCHAR(44)
    `;

    await db`
      ALTER TABLE usdc_purchase_entitlements
      ADD COLUMN IF NOT EXISTS evm_listing_id VARCHAR(66)
    `;

    await db`
      ALTER TABLE usdc_purchase_entitlements
      ADD COLUMN IF NOT EXISTS evm_purchase_id VARCHAR(66)
    `;

    await db`
      ALTER TABLE usdc_purchase_entitlements
      ADD COLUMN IF NOT EXISTS purchase_pda VARCHAR(44)
    `;

    await db`
      ALTER TABLE usdc_purchase_entitlements
      ADD COLUMN IF NOT EXISTS listing_revision BIGINT
    `;

    await db`
      ALTER TABLE usdc_purchase_entitlements
      ADD COLUMN IF NOT EXISTS settlement_pda VARCHAR(44)
    `;

    await db`
      ALTER TABLE usdc_purchase_entitlements
      ADD COLUMN IF NOT EXISTS author_proceeds_vault VARCHAR(44)
    `;

    await db`
      ALTER TABLE usdc_purchase_entitlements
      ADD COLUMN IF NOT EXISTS x402_payment_ref_hash VARCHAR(64)
    `;

    await db`
      ALTER TABLE usdc_purchase_entitlements
      ADD COLUMN IF NOT EXISTS x402_settlement_signature_hash VARCHAR(64)
    `;

    await db`
      ALTER TABLE usdc_purchase_entitlements
      ADD COLUMN IF NOT EXISTS x402_settlement_receipt_pda VARCHAR(44)
    `;

    await db`
      ALTER TABLE usdc_purchase_entitlements
      ADD COLUMN IF NOT EXISTS x402_settlement_vault VARCHAR(44)
    `;

    await db`
      ALTER TABLE usdc_purchase_entitlements
      ADD COLUMN IF NOT EXISTS refund_status VARCHAR(32) DEFAULT 'none'
    `;

    await db`
      ALTER TABLE usdc_purchase_entitlements
      ADD COLUMN IF NOT EXISTS legacy_refund_eligible BOOLEAN DEFAULT FALSE
    `;

    // Off-chain revocation (e.g. Stripe refund/chargeback): a revoked
    // entitlement no longer grants downloads. A genuinely new receipt for the
    // same buyer+skill reinstates it (see the upsert in
    // recordUsdcPurchaseReceipt).
    await db`
      ALTER TABLE usdc_purchase_entitlements
      ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ
    `;

    await db`
      ALTER TABLE usdc_purchase_entitlements
      ADD COLUMN IF NOT EXISTS revoked_reason TEXT
    `;

    await db`
      UPDATE usdc_purchase_entitlements
      SET
        buyer_chain_context = COALESCE(buyer_chain_context, chain_context),
        buyer_address = COALESCE(buyer_address, buyer_pubkey),
        recipient_chain_context = COALESCE(recipient_chain_context, chain_context),
        recipient_address = COALESCE(recipient_address, recipient_ata),
        asset_chain_context = COALESCE(asset_chain_context, chain_context),
        asset_address = COALESCE(asset_address, currency_mint)
      WHERE buyer_chain_context IS NULL
         OR buyer_address IS NULL
         OR recipient_chain_context IS NULL
         OR recipient_address IS NULL
         OR asset_chain_context IS NULL
         OR asset_address IS NULL
    `;

    await db`
      CREATE INDEX IF NOT EXISTS idx_usdc_purchase_entitlements_buyer
      ON usdc_purchase_entitlements(buyer_pubkey)
    `;

    await db`
      CREATE INDEX IF NOT EXISTS idx_usdc_purchase_entitlements_chain_buyer
      ON usdc_purchase_entitlements(skill_db_id, buyer_chain_context, buyer_address)
      WHERE buyer_chain_context IS NOT NULL
        AND buyer_address IS NOT NULL
    `;

    // The row is a per-payment terminal-state gate: fulfillment can reuse a
    // fulfilled row, while refund/dispute atomically promotes it to revoked.
    await db`
      CREATE TABLE IF NOT EXISTS usdc_payment_revocations (
        payment_tx_signature VARCHAR(128) PRIMARY KEY,
        status VARCHAR(16) NOT NULL DEFAULT 'revoked',
        reason TEXT NOT NULL,
        revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await db`
      ALTER TABLE usdc_payment_revocations
      ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'revoked'
    `;

    await db`
      CREATE INDEX IF NOT EXISTS idx_usdc_purchase_receipts_chain_buyer
      ON usdc_purchase_receipts(skill_db_id, buyer_chain_context, buyer_address)
      WHERE buyer_chain_context IS NOT NULL
        AND buyer_address IS NOT NULL
    `;

    await db`
      CREATE TABLE IF NOT EXISTS usdc_x402_settlement_attempts (
        payment_ref_hash VARCHAR(64) PRIMARY KEY,
        skill_db_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        buyer_chain_context VARCHAR(64) NOT NULL,
        buyer_address VARCHAR(128) NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        settlement_tx_signature VARCHAR(128),
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await db`
      CREATE INDEX IF NOT EXISTS idx_usdc_x402_settlement_attempts_skill_buyer
      ON usdc_x402_settlement_attempts(skill_db_id, buyer_chain_context, buyer_address)
    `;

    await db`
      CREATE TABLE IF NOT EXISTS usdc_refund_claims (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        skill_db_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        buyer_pubkey VARCHAR(44) NOT NULL,
        purchase_pda VARCHAR(44) NOT NULL,
        refund_pool_pda VARCHAR(44) NOT NULL,
        refund_claim_pda VARCHAR(44) NOT NULL UNIQUE,
        claim_tx_signature VARCHAR(128) UNIQUE,
        currency_mint VARCHAR(44) NOT NULL,
        amount_micros BIGINT NOT NULL,
        claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (purchase_pda, refund_pool_pda)
      )
    `;

    await db`
      CREATE INDEX IF NOT EXISTS idx_usdc_refund_claims_skill_buyer
      ON usdc_refund_claims(skill_db_id, buyer_pubkey)
    `;

    await db`
      INSERT INTO usdc_purchase_entitlements (
        skill_db_id,
        buyer_pubkey,
        buyer_chain_context,
        buyer_address,
        latest_receipt_id,
        payment_tx_signature,
        recipient_ata,
        recipient_chain_context,
        recipient_address,
        currency_mint,
        asset_chain_context,
        asset_address,
        amount_micros,
        payment_flow,
        protocol_version,
        on_chain_program_id,
        chain_context,
        on_chain_address,
        evm_listing_id,
        evm_purchase_id,
        purchase_pda,
        listing_revision,
        settlement_pda,
        author_proceeds_vault,
        x402_payment_ref_hash,
        x402_settlement_signature_hash,
        x402_settlement_receipt_pda,
        x402_settlement_vault,
        refund_status,
        legacy_refund_eligible,
        first_verified_at,
        last_verified_at,
        created_at,
        updated_at
      )
      SELECT DISTINCT ON (r.skill_db_id, r.buyer_pubkey)
        r.skill_db_id,
        r.buyer_pubkey,
        COALESCE(r.buyer_chain_context, r.chain_context),
        COALESCE(r.buyer_address, r.buyer_pubkey),
        r.id,
        r.payment_tx_signature,
        r.recipient_ata,
        COALESCE(r.recipient_chain_context, r.chain_context),
        COALESCE(r.recipient_address, r.recipient_ata),
        r.currency_mint,
        COALESCE(r.asset_chain_context, r.chain_context),
        COALESCE(r.asset_address, r.currency_mint),
        r.amount_micros,
        r.payment_flow,
        r.protocol_version,
        r.on_chain_program_id,
        r.chain_context,
        r.on_chain_address,
        r.evm_listing_id,
        r.evm_purchase_id,
        r.purchase_pda,
        r.listing_revision,
        r.settlement_pda,
        r.author_proceeds_vault,
        r.x402_payment_ref_hash,
        r.x402_settlement_signature_hash,
        r.x402_settlement_receipt_pda,
        r.x402_settlement_vault,
        COALESCE(r.refund_status, 'none'),
        COALESCE(r.legacy_refund_eligible, FALSE),
        r.verified_at,
        r.verified_at,
        NOW(),
        NOW()
      FROM usdc_purchase_receipts r
      ORDER BY
        r.skill_db_id,
        r.buyer_pubkey,
        r.verified_at DESC,
        r.created_at DESC,
        r.id DESC
      ON CONFLICT (skill_db_id, buyer_pubkey)
      DO UPDATE SET
        latest_receipt_id = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.latest_receipt_id
          ELSE usdc_purchase_entitlements.latest_receipt_id
        END,
        buyer_chain_context = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.buyer_chain_context
          ELSE usdc_purchase_entitlements.buyer_chain_context
        END,
        buyer_address = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.buyer_address
          ELSE usdc_purchase_entitlements.buyer_address
        END,
        payment_tx_signature = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.payment_tx_signature
          ELSE usdc_purchase_entitlements.payment_tx_signature
        END,
        recipient_ata = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.recipient_ata
          ELSE usdc_purchase_entitlements.recipient_ata
        END,
        recipient_chain_context = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.recipient_chain_context
          ELSE usdc_purchase_entitlements.recipient_chain_context
        END,
        recipient_address = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.recipient_address
          ELSE usdc_purchase_entitlements.recipient_address
        END,
        currency_mint = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.currency_mint
          ELSE usdc_purchase_entitlements.currency_mint
        END,
        asset_chain_context = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.asset_chain_context
          ELSE usdc_purchase_entitlements.asset_chain_context
        END,
        asset_address = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.asset_address
          ELSE usdc_purchase_entitlements.asset_address
        END,
        amount_micros = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.amount_micros
          ELSE usdc_purchase_entitlements.amount_micros
        END,
        payment_flow = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.payment_flow
          ELSE usdc_purchase_entitlements.payment_flow
        END,
        protocol_version = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.protocol_version
          ELSE usdc_purchase_entitlements.protocol_version
        END,
        on_chain_program_id = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.on_chain_program_id
          ELSE usdc_purchase_entitlements.on_chain_program_id
        END,
        chain_context = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.chain_context
          ELSE usdc_purchase_entitlements.chain_context
        END,
        on_chain_address = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.on_chain_address
          ELSE usdc_purchase_entitlements.on_chain_address
        END,
        evm_listing_id = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.evm_listing_id
          ELSE usdc_purchase_entitlements.evm_listing_id
        END,
        evm_purchase_id = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.evm_purchase_id
          ELSE usdc_purchase_entitlements.evm_purchase_id
        END,
        purchase_pda = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.purchase_pda
          ELSE usdc_purchase_entitlements.purchase_pda
        END,
        listing_revision = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.listing_revision
          ELSE usdc_purchase_entitlements.listing_revision
        END,
        settlement_pda = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.settlement_pda
          ELSE usdc_purchase_entitlements.settlement_pda
        END,
        author_proceeds_vault = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.author_proceeds_vault
          ELSE usdc_purchase_entitlements.author_proceeds_vault
        END,
        x402_payment_ref_hash = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.x402_payment_ref_hash
          ELSE usdc_purchase_entitlements.x402_payment_ref_hash
        END,
        x402_settlement_signature_hash = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.x402_settlement_signature_hash
          ELSE usdc_purchase_entitlements.x402_settlement_signature_hash
        END,
        x402_settlement_receipt_pda = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.x402_settlement_receipt_pda
          ELSE usdc_purchase_entitlements.x402_settlement_receipt_pda
        END,
        x402_settlement_vault = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.x402_settlement_vault
          ELSE usdc_purchase_entitlements.x402_settlement_vault
        END,
        refund_status = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.refund_status
          ELSE usdc_purchase_entitlements.refund_status
        END,
        legacy_refund_eligible = CASE
          WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
            THEN EXCLUDED.legacy_refund_eligible
          ELSE usdc_purchase_entitlements.legacy_refund_eligible
        END,
        first_verified_at = LEAST(
          usdc_purchase_entitlements.first_verified_at,
          EXCLUDED.first_verified_at
        ),
        last_verified_at = GREATEST(
          usdc_purchase_entitlements.last_verified_at,
          EXCLUDED.last_verified_at
        ),
        updated_at = NOW()
    `;
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });

  return schemaReady;
}

export async function hasUsdcPurchaseEntitlement(
  skillDbId: string,
  buyerPubkey: string
): Promise<boolean> {
  await ensureUsdcPurchaseSchema();

  const rows = await sql()<{
    has_entitlement: boolean;
  }>`
    SELECT EXISTS (
      SELECT 1
      FROM usdc_purchase_entitlements
      WHERE skill_db_id = ${skillDbId}::uuid
        AND buyer_pubkey = ${buyerPubkey}
        AND revoked_at IS NULL
    ) AS has_entitlement
  `;

  return rows[0]?.has_entitlement ?? false;
}

export async function hasChainUsdcPurchaseEntitlement(
  skillDbId: string,
  buyer: ChainQualifiedBuyer
): Promise<boolean> {
  await ensureUsdcPurchaseSchema();

  const buyerChainContext = normalizeChainContextForStorage(
    buyer.buyerChainContext
  );
  const buyerAddress = normalizeChainAddress(
    buyerChainContext,
    buyer.buyerAddress
  );
  if (!buyerChainContext || !buyerAddress) return false;

  const rows = await sql()<{
    has_entitlement: boolean;
  }>`
    SELECT EXISTS (
      SELECT 1
      FROM usdc_purchase_entitlements
      WHERE skill_db_id = ${skillDbId}::uuid
        AND buyer_chain_context = ${buyerChainContext}
        AND buyer_address = ${buyerAddress}
        AND revoked_at IS NULL
    ) AS has_entitlement
  `;

  return rows[0]?.has_entitlement ?? false;
}

export async function getUsdcPurchaseEntitlementStatus(
  skillDbId: string,
  buyerPubkey: string
): Promise<{ exists: boolean; revoked: boolean }> {
  await ensureUsdcPurchaseSchema();

  const rows = await sql()<{
    revoked_at: string | null;
  }>`
    SELECT revoked_at::text
    FROM usdc_purchase_entitlements
    WHERE skill_db_id = ${skillDbId}::uuid
      AND buyer_pubkey = ${buyerPubkey}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return { exists: false, revoked: false };
  return { exists: true, revoked: row.revoked_at !== null };
}

export async function hasUsdcPurchaseReceiptForPaymentRef(
  paymentTxSignature: string
): Promise<boolean> {
  await ensureUsdcPurchaseSchema();

  const rows = await sql()<{ has_receipt: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM usdc_purchase_receipts
      WHERE payment_tx_signature = ${paymentTxSignature}
    ) AS has_receipt
  `;

  return rows[0]?.has_receipt ?? false;
}

export async function recordRevocableUsdcPurchaseReceipt(input: {
  skillDbId: string;
  buyerPubkey: string;
  paymentTxSignature: string;
  recipientAta: string;
  currencyMint: string;
  amountMicros: string;
  paymentFlow: string;
}): Promise<{
  receiptRecorded: boolean;
  entitlementUpdated: boolean;
  revoked: boolean;
}> {
  await ensureUsdcPurchaseSchema();

  const [result] = await sql()<{
    receipt_recorded: boolean;
    entitlement_updated: boolean;
    revoked: boolean;
  }>`
    WITH payment_state AS (
      INSERT INTO usdc_payment_revocations (
        payment_tx_signature,
        status,
        reason,
        updated_at
      )
      VALUES (
        ${input.paymentTxSignature},
        'fulfilled',
        'stripe-fulfillment',
        NOW()
      )
      ON CONFLICT (payment_tx_signature)
      DO UPDATE SET updated_at = NOW()
      WHERE usdc_payment_revocations.status = 'fulfilled'
      RETURNING status
    ),
    receipt AS (
      INSERT INTO usdc_purchase_receipts (
        skill_db_id,
        buyer_pubkey,
        payment_tx_signature,
        recipient_ata,
        currency_mint,
        amount_micros,
        payment_flow,
        verified_at,
        updated_at
      )
      SELECT
        ${input.skillDbId}::uuid,
        ${input.buyerPubkey},
        ${input.paymentTxSignature},
        ${input.recipientAta},
        ${input.currencyMint},
        ${input.amountMicros},
        ${input.paymentFlow},
        NOW(),
        NOW()
      FROM payment_state
      WHERE payment_state.status = 'fulfilled'
      ON CONFLICT (payment_tx_signature)
      DO UPDATE SET
        recipient_ata = EXCLUDED.recipient_ata,
        currency_mint = EXCLUDED.currency_mint,
        amount_micros = EXCLUDED.amount_micros,
        payment_flow = EXCLUDED.payment_flow,
        verified_at = GREATEST(
          usdc_purchase_receipts.verified_at,
          EXCLUDED.verified_at
        ),
        updated_at = NOW()
      WHERE usdc_purchase_receipts.skill_db_id = EXCLUDED.skill_db_id
        AND usdc_purchase_receipts.buyer_pubkey = EXCLUDED.buyer_pubkey
      RETURNING id, verified_at
    ),
    entitlement AS (
      INSERT INTO usdc_purchase_entitlements (
        skill_db_id,
        buyer_pubkey,
        latest_receipt_id,
        payment_tx_signature,
        recipient_ata,
        currency_mint,
        amount_micros,
        payment_flow,
        first_verified_at,
        last_verified_at,
        created_at,
        updated_at
      )
      SELECT
        ${input.skillDbId}::uuid,
        ${input.buyerPubkey},
        receipt.id,
        ${input.paymentTxSignature},
        ${input.recipientAta},
        ${input.currencyMint},
        ${input.amountMicros},
        ${input.paymentFlow},
        receipt.verified_at,
        receipt.verified_at,
        NOW(),
        NOW()
      FROM receipt
      WHERE NOT EXISTS (
        SELECT 1
        FROM usdc_purchase_entitlements live
        WHERE live.skill_db_id = ${input.skillDbId}::uuid
          AND live.buyer_pubkey = ${input.buyerPubkey}
          AND live.revoked_at IS NULL
      )
      ON CONFLICT (skill_db_id, buyer_pubkey)
      DO UPDATE SET
        latest_receipt_id = EXCLUDED.latest_receipt_id,
        buyer_chain_context = NULL,
        buyer_address = NULL,
        payment_tx_signature = EXCLUDED.payment_tx_signature,
        recipient_ata = EXCLUDED.recipient_ata,
        recipient_chain_context = NULL,
        recipient_address = NULL,
        currency_mint = EXCLUDED.currency_mint,
        asset_chain_context = NULL,
        asset_address = NULL,
        amount_micros = EXCLUDED.amount_micros,
        payment_flow = EXCLUDED.payment_flow,
        protocol_version = NULL,
        on_chain_program_id = NULL,
        chain_context = NULL,
        on_chain_address = NULL,
        evm_listing_id = NULL,
        evm_purchase_id = NULL,
        purchase_pda = NULL,
        listing_revision = NULL,
        settlement_pda = NULL,
        author_proceeds_vault = NULL,
        x402_payment_ref_hash = NULL,
        x402_settlement_signature_hash = NULL,
        x402_settlement_receipt_pda = NULL,
        x402_settlement_vault = NULL,
        refund_status = 'none',
        legacy_refund_eligible = FALSE,
        last_verified_at = EXCLUDED.last_verified_at,
        updated_at = NOW(),
        revoked_at = NULL,
        revoked_reason = NULL
      WHERE usdc_purchase_entitlements.revoked_at IS NOT NULL
      RETURNING 1
    )
    SELECT
      EXISTS (SELECT 1 FROM receipt) AS receipt_recorded,
      EXISTS (SELECT 1 FROM entitlement) AS entitlement_updated,
      NOT EXISTS (SELECT 1 FROM payment_state) AS revoked
  `;

  if (!result) {
    throw new Error("Failed to record revocable purchase receipt");
  }
  if (!result.receipt_recorded && !result.revoked) {
    throw new Error(
      "Payment transaction signature is already recorded for another skill or buyer"
    );
  }
  return {
    receiptRecorded: result.receipt_recorded,
    entitlementUpdated: result.entitlement_updated,
    revoked: result.revoked,
  };
}

export async function recordAndApplyUsdcPaymentRevocation(
  paymentTxSignature: string,
  reason: string
): Promise<Array<{ skill_db_id: string; buyer_pubkey: string }>> {
  await ensureUsdcPurchaseSchema();

  return await sql()<{
    skill_db_id: string;
    buyer_pubkey: string;
  }>`
    WITH marker AS (
      INSERT INTO usdc_payment_revocations (
        payment_tx_signature,
        status,
        reason,
        updated_at
      )
      VALUES (${paymentTxSignature}, 'revoked', ${reason}, NOW())
      ON CONFLICT (payment_tx_signature)
      DO UPDATE SET
        status = 'revoked',
        reason = EXCLUDED.reason,
        updated_at = NOW()
      RETURNING payment_tx_signature
    )
    UPDATE usdc_purchase_entitlements
    SET
      revoked_at = NOW(),
      revoked_reason = ${reason},
      updated_at = NOW()
    FROM marker
    WHERE usdc_purchase_entitlements.payment_tx_signature = marker.payment_tx_signature
      AND usdc_purchase_entitlements.revoked_at IS NULL
    RETURNING
      usdc_purchase_entitlements.skill_db_id::text AS skill_db_id,
      usdc_purchase_entitlements.buyer_pubkey
  `;
}

// Revokes entitlements whose CURRENT backing receipt is this payment (e.g. a
// Stripe refund or chargeback). If the buyer has since re-purchased through
// any rail, the entitlement's payment_tx_signature no longer matches and it
// is deliberately left untouched.
export async function revokeUsdcEntitlementsByPaymentRef(
  paymentTxSignature: string,
  reason: string
): Promise<Array<{ skill_db_id: string; buyer_pubkey: string }>> {
  await ensureUsdcPurchaseSchema();

  return await sql()<{
    skill_db_id: string;
    buyer_pubkey: string;
  }>`
    UPDATE usdc_purchase_entitlements
    SET
      revoked_at = NOW(),
      revoked_reason = ${reason},
      updated_at = NOW()
    WHERE payment_tx_signature = ${paymentTxSignature}
      AND revoked_at IS NULL
    RETURNING skill_db_id::text AS skill_db_id, buyer_pubkey
  `;
}

export async function getX402SettlementEntitlement(
  skillDbId: string,
  paymentRefHash: string
): Promise<X402SettlementEntitlement | null> {
  await ensureUsdcPurchaseSchema();

  const rows = await sql()<{
    transaction: string;
    payer: string | null;
    chain_context: string | null;
    evm_listing_id: string | null;
    evm_purchase_id: string | null;
    listing_revision: string | null;
  }>`
    SELECT
      payment_tx_signature AS transaction,
      buyer_address AS payer,
      buyer_chain_context AS chain_context,
      evm_listing_id,
      evm_purchase_id,
      listing_revision::text
    FROM usdc_purchase_entitlements
    WHERE skill_db_id = ${skillDbId}::uuid
      AND x402_payment_ref_hash = ${paymentRefHash}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;
  return {
    transaction: row.transaction,
    payer: row.payer ?? "",
    chainContext: row.chain_context,
    evmListingId: row.evm_listing_id,
    evmPurchaseId: row.evm_purchase_id,
    listingRevision: row.listing_revision,
  };
}

export async function claimX402SettlementAttempt(input: {
  skillDbId: string;
  paymentRefHash: string;
  buyerChainContext: string;
  buyerAddress: string;
}): Promise<X402SettlementAttemptClaim> {
  await ensureUsdcPurchaseSchema();

  const buyerChainContext = normalizeChainContextForStorage(
    input.buyerChainContext
  );
  const buyerAddress = normalizeChainAddress(
    buyerChainContext,
    input.buyerAddress
  );
  if (!buyerChainContext || !buyerAddress) {
    throw new Error("x402 settlement attempt requires a chain-qualified buyer");
  }

  const [claimed] = await sql()<{
    payment_ref_hash: string;
  }>`
    INSERT INTO usdc_x402_settlement_attempts (
      payment_ref_hash,
      skill_db_id,
      buyer_chain_context,
      buyer_address,
      status,
      updated_at
    )
    VALUES (
      ${input.paymentRefHash},
      ${input.skillDbId}::uuid,
      ${buyerChainContext},
      ${buyerAddress},
      'pending',
      NOW()
    )
    ON CONFLICT (payment_ref_hash)
    DO UPDATE SET
      status = 'pending',
      last_error = NULL,
      updated_at = NOW()
    WHERE usdc_x402_settlement_attempts.skill_db_id = EXCLUDED.skill_db_id
      AND usdc_x402_settlement_attempts.buyer_chain_context = EXCLUDED.buyer_chain_context
      AND usdc_x402_settlement_attempts.buyer_address = EXCLUDED.buyer_address
      AND (
        usdc_x402_settlement_attempts.status = 'failed'
        OR usdc_x402_settlement_attempts.updated_at < NOW() - INTERVAL '10 minutes'
      )
    RETURNING payment_ref_hash
  `;

  if (claimed) return { claimed: true };

  const rows = await sql()<{
    skill_db_id: string;
    buyer_chain_context: string;
    buyer_address: string;
    status: "pending" | "complete" | "failed";
    settlement_tx_signature: string | null;
    updated_at: string | null;
  }>`
    SELECT
      skill_db_id::text,
      buyer_chain_context,
      buyer_address,
      status,
      settlement_tx_signature,
      updated_at::text
    FROM usdc_x402_settlement_attempts
    WHERE payment_ref_hash = ${input.paymentRefHash}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return { claimed: true };
  if (
    row.skill_db_id !== input.skillDbId ||
    row.buyer_chain_context !== buyerChainContext ||
    row.buyer_address !== buyerAddress
  ) {
    throw new Error("x402 payment reference is already claimed");
  }

  return {
    claimed: false,
    status: row.status,
    transaction: row.settlement_tx_signature,
    updatedAt: row.updated_at,
  };
}

export async function completeX402SettlementAttempt(input: {
  paymentRefHash: string;
  settlementTxSignature: string;
}): Promise<void> {
  await ensureUsdcPurchaseSchema();

  await sql()`
    UPDATE usdc_x402_settlement_attempts
    SET
      status = 'complete',
      settlement_tx_signature = ${input.settlementTxSignature},
      last_error = NULL,
      updated_at = NOW()
    WHERE payment_ref_hash = ${input.paymentRefHash}
  `;
}

export async function failX402SettlementAttempt(input: {
  paymentRefHash: string;
  error: string;
}): Promise<void> {
  await ensureUsdcPurchaseSchema();

  await sql()`
    UPDATE usdc_x402_settlement_attempts
    SET
      status = 'failed',
      last_error = ${input.error.slice(0, 2000)},
      updated_at = NOW()
    WHERE payment_ref_hash = ${input.paymentRefHash}
      AND status = 'pending'
  `;
}

export async function getUsdcPurchaseEntitlementSummary(
  skillDbId: string,
  buyerPubkey: string
): Promise<{
  purchasePda: string | null;
  listingRevision: string | null;
  settlementPda: string | null;
  refundStatus: string;
  legacyRefundEligible: boolean;
} | null> {
  await ensureUsdcPurchaseSchema();

  const rows = await sql()<{
    purchase_pda: string | null;
    listing_revision: string | null;
    settlement_pda: string | null;
    refund_status: string | null;
    legacy_refund_eligible: boolean | null;
  }>`
    SELECT
      purchase_pda,
      listing_revision::text,
      settlement_pda,
      refund_status,
      legacy_refund_eligible
    FROM usdc_purchase_entitlements
    WHERE skill_db_id = ${skillDbId}::uuid
      AND buyer_pubkey = ${buyerPubkey}
      AND revoked_at IS NULL
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;
  return {
    purchasePda: row.purchase_pda,
    listingRevision: row.listing_revision,
    settlementPda: row.settlement_pda,
    refundStatus: row.refund_status ?? "none",
    legacyRefundEligible: row.legacy_refund_eligible ?? false,
  };
}

export async function recordUsdcPurchaseReceipt(input: {
  skillDbId: string;
  buyerPubkey: string;
  buyerChainContext?: string | null;
  buyerAddress?: string | null;
  paymentTxSignature: string;
  recipientAta: string;
  recipientChainContext?: string | null;
  recipientAddress?: string | null;
  currencyMint: string;
  assetChainContext?: string | null;
  assetAddress?: string | null;
  amountMicros: string;
  paymentFlow?: string;
  protocolVersion?: string | null;
  onChainProgramId?: string | null;
  chainContext?: string | null;
  onChainAddress?: string | null;
  evmListingId?: string | null;
  evmPurchaseId?: string | null;
  purchasePda?: string | null;
  listingRevision?: string | null;
  settlementPda?: string | null;
  authorProceedsVault?: string | null;
  x402PaymentRefHash?: string | null;
  x402SettlementSignatureHash?: string | null;
  x402SettlementReceiptPda?: string | null;
  x402SettlementVault?: string | null;
  refundStatus?: string | null;
  legacyRefundEligible?: boolean;
}) {
  await ensureUsdcPurchaseSchema();

  const db = sql();
  const paymentFlow = input.paymentFlow ?? REPO_X402_PAYMENT_FLOW;
  const protocolVersion = input.protocolVersion ?? null;
  const onChainProgramId = input.onChainProgramId ?? null;
  const chainContext = normalizeChainContextForStorage(input.chainContext);
  const onChainAddress = input.onChainAddress ?? null;
  // Chain-qualified address columns are only meaningful alongside a chain
  // context: chain-aware lookups require both, and off-chain rails (e.g.
  // Stripe) would otherwise leak sentinels like "USD" / "stripe-offchain"
  // into address columns that chain-aware grouping and explorers consume.
  const buyerChainContext = normalizeChainContextForStorage(
    input.buyerChainContext ?? chainContext
  );
  const buyerAddress = buyerChainContext
    ? normalizeChainAddress(
        buyerChainContext,
        input.buyerAddress ?? input.buyerPubkey
      )
    : null;
  const recipientChainContext = normalizeChainContextForStorage(
    input.recipientChainContext ?? chainContext
  );
  const recipientAddress = recipientChainContext
    ? normalizeChainAddress(
        recipientChainContext,
        input.recipientAddress ?? input.recipientAta
      )
    : null;
  const assetChainContext = normalizeChainContextForStorage(
    input.assetChainContext ?? chainContext
  );
  const assetAddress = assetChainContext
    ? normalizeChainAddress(
        assetChainContext,
        input.assetAddress ?? input.currencyMint
      )
    : null;
  const evmListingId = input.evmListingId ?? null;
  const evmPurchaseId = input.evmPurchaseId ?? null;
  const purchasePda = input.purchasePda ?? null;
  const listingRevision = input.listingRevision ?? null;
  const settlementPda = input.settlementPda ?? null;
  const authorProceedsVault = input.authorProceedsVault ?? null;
  const x402PaymentRefHash = input.x402PaymentRefHash ?? null;
  const x402SettlementSignatureHash = input.x402SettlementSignatureHash ?? null;
  const x402SettlementReceiptPda = input.x402SettlementReceiptPda ?? null;
  const x402SettlementVault = input.x402SettlementVault ?? null;
  const refundStatus = input.refundStatus ?? "none";
  const legacyRefundEligible = input.legacyRefundEligible ?? false;
  const [receipt] = await db<{
    id: string;
    verified_at: string;
  }>`
    INSERT INTO usdc_purchase_receipts (
      skill_db_id,
      buyer_pubkey,
      buyer_chain_context,
      buyer_address,
      payment_tx_signature,
      recipient_ata,
      recipient_chain_context,
      recipient_address,
      currency_mint,
      asset_chain_context,
      asset_address,
      amount_micros,
      payment_flow,
      protocol_version,
      on_chain_program_id,
      chain_context,
      on_chain_address,
      evm_listing_id,
      evm_purchase_id,
      purchase_pda,
      listing_revision,
      settlement_pda,
      author_proceeds_vault,
      x402_payment_ref_hash,
      x402_settlement_signature_hash,
      x402_settlement_receipt_pda,
      x402_settlement_vault,
      refund_status,
      legacy_refund_eligible,
      verified_at,
      updated_at
    )
    VALUES (
      ${input.skillDbId}::uuid,
      ${input.buyerPubkey},
      ${buyerChainContext},
      ${buyerAddress},
      ${input.paymentTxSignature},
      ${input.recipientAta},
      ${recipientChainContext},
      ${recipientAddress},
      ${input.currencyMint},
      ${assetChainContext},
      ${assetAddress},
      ${input.amountMicros},
      ${paymentFlow},
      ${protocolVersion},
      ${onChainProgramId},
      ${chainContext},
      ${onChainAddress},
      ${evmListingId},
      ${evmPurchaseId},
      ${purchasePda},
      ${listingRevision},
      ${settlementPda},
      ${authorProceedsVault},
      ${x402PaymentRefHash},
      ${x402SettlementSignatureHash},
      ${x402SettlementReceiptPda},
      ${x402SettlementVault},
      ${refundStatus},
      ${legacyRefundEligible},
      NOW(),
      NOW()
    )
    ON CONFLICT (payment_tx_signature)
    DO UPDATE SET
      recipient_ata = EXCLUDED.recipient_ata,
      buyer_chain_context = EXCLUDED.buyer_chain_context,
      buyer_address = EXCLUDED.buyer_address,
      recipient_chain_context = EXCLUDED.recipient_chain_context,
      recipient_address = EXCLUDED.recipient_address,
      currency_mint = EXCLUDED.currency_mint,
      asset_chain_context = EXCLUDED.asset_chain_context,
      asset_address = EXCLUDED.asset_address,
      amount_micros = EXCLUDED.amount_micros,
      payment_flow = EXCLUDED.payment_flow,
      protocol_version = EXCLUDED.protocol_version,
      on_chain_program_id = EXCLUDED.on_chain_program_id,
      chain_context = EXCLUDED.chain_context,
      on_chain_address = EXCLUDED.on_chain_address,
      evm_listing_id = EXCLUDED.evm_listing_id,
      evm_purchase_id = EXCLUDED.evm_purchase_id,
      purchase_pda = EXCLUDED.purchase_pda,
      listing_revision = EXCLUDED.listing_revision,
      settlement_pda = EXCLUDED.settlement_pda,
      author_proceeds_vault = EXCLUDED.author_proceeds_vault,
      x402_payment_ref_hash = EXCLUDED.x402_payment_ref_hash,
      x402_settlement_signature_hash = EXCLUDED.x402_settlement_signature_hash,
      x402_settlement_receipt_pda = EXCLUDED.x402_settlement_receipt_pda,
      x402_settlement_vault = EXCLUDED.x402_settlement_vault,
      refund_status = EXCLUDED.refund_status,
      legacy_refund_eligible = EXCLUDED.legacy_refund_eligible,
      verified_at = GREATEST(
        usdc_purchase_receipts.verified_at,
        EXCLUDED.verified_at
      ),
      updated_at = NOW()
    WHERE usdc_purchase_receipts.skill_db_id = EXCLUDED.skill_db_id
      AND usdc_purchase_receipts.buyer_pubkey = EXCLUDED.buyer_pubkey
      AND (
        usdc_purchase_receipts.buyer_chain_context IS NULL
        OR EXCLUDED.buyer_chain_context IS NULL
        OR usdc_purchase_receipts.buyer_chain_context = EXCLUDED.buyer_chain_context
      )
      AND (
        usdc_purchase_receipts.buyer_address IS NULL
        OR EXCLUDED.buyer_address IS NULL
        OR usdc_purchase_receipts.buyer_address = EXCLUDED.buyer_address
      )
    RETURNING id, verified_at::text
  `;

  if (!receipt) {
    throw new Error(
      "Payment transaction signature is already recorded for another skill or buyer"
    );
  }

  await db`
    INSERT INTO usdc_purchase_entitlements (
      skill_db_id,
      buyer_pubkey,
      buyer_chain_context,
      buyer_address,
      latest_receipt_id,
      payment_tx_signature,
      recipient_ata,
      recipient_chain_context,
      recipient_address,
      currency_mint,
      asset_chain_context,
      asset_address,
      amount_micros,
      payment_flow,
      protocol_version,
      on_chain_program_id,
      chain_context,
      on_chain_address,
      evm_listing_id,
      evm_purchase_id,
      purchase_pda,
      listing_revision,
      settlement_pda,
      author_proceeds_vault,
      x402_payment_ref_hash,
      x402_settlement_signature_hash,
      x402_settlement_receipt_pda,
      x402_settlement_vault,
      refund_status,
      legacy_refund_eligible,
      first_verified_at,
      last_verified_at,
      created_at,
      updated_at
    )
    VALUES (
      ${input.skillDbId}::uuid,
      ${input.buyerPubkey},
      ${buyerChainContext},
      ${buyerAddress},
      ${receipt.id}::uuid,
      ${input.paymentTxSignature},
      ${input.recipientAta},
      ${recipientChainContext},
      ${recipientAddress},
      ${input.currencyMint},
      ${assetChainContext},
      ${assetAddress},
      ${input.amountMicros},
      ${paymentFlow},
      ${protocolVersion},
      ${onChainProgramId},
      ${chainContext},
      ${onChainAddress},
      ${evmListingId},
      ${evmPurchaseId},
      ${purchasePda},
      ${listingRevision},
      ${settlementPda},
      ${authorProceedsVault},
      ${x402PaymentRefHash},
      ${x402SettlementSignatureHash},
      ${x402SettlementReceiptPda},
      ${x402SettlementVault},
      ${refundStatus},
      ${legacyRefundEligible},
      ${receipt.verified_at}::timestamptz,
      ${receipt.verified_at}::timestamptz,
      NOW(),
      NOW()
    )
    ON CONFLICT (skill_db_id, buyer_pubkey)
    DO UPDATE SET
      latest_receipt_id = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.latest_receipt_id
        ELSE usdc_purchase_entitlements.latest_receipt_id
      END,
      buyer_chain_context = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.buyer_chain_context
        ELSE usdc_purchase_entitlements.buyer_chain_context
      END,
      buyer_address = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.buyer_address
        ELSE usdc_purchase_entitlements.buyer_address
      END,
      payment_tx_signature = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.payment_tx_signature
        ELSE usdc_purchase_entitlements.payment_tx_signature
      END,
      recipient_ata = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.recipient_ata
        ELSE usdc_purchase_entitlements.recipient_ata
      END,
      recipient_chain_context = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.recipient_chain_context
        ELSE usdc_purchase_entitlements.recipient_chain_context
      END,
      recipient_address = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.recipient_address
        ELSE usdc_purchase_entitlements.recipient_address
      END,
      currency_mint = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.currency_mint
        ELSE usdc_purchase_entitlements.currency_mint
      END,
      asset_chain_context = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.asset_chain_context
        ELSE usdc_purchase_entitlements.asset_chain_context
      END,
      asset_address = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.asset_address
        ELSE usdc_purchase_entitlements.asset_address
      END,
      amount_micros = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.amount_micros
        ELSE usdc_purchase_entitlements.amount_micros
      END,
      payment_flow = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.payment_flow
        ELSE usdc_purchase_entitlements.payment_flow
      END,
      protocol_version = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.protocol_version
        ELSE usdc_purchase_entitlements.protocol_version
      END,
      on_chain_program_id = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.on_chain_program_id
        ELSE usdc_purchase_entitlements.on_chain_program_id
      END,
      chain_context = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.chain_context
        ELSE usdc_purchase_entitlements.chain_context
      END,
      on_chain_address = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.on_chain_address
        ELSE usdc_purchase_entitlements.on_chain_address
      END,
      evm_listing_id = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.evm_listing_id
        ELSE usdc_purchase_entitlements.evm_listing_id
      END,
      evm_purchase_id = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.evm_purchase_id
        ELSE usdc_purchase_entitlements.evm_purchase_id
      END,
      purchase_pda = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.purchase_pda
        ELSE usdc_purchase_entitlements.purchase_pda
      END,
      listing_revision = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.listing_revision
        ELSE usdc_purchase_entitlements.listing_revision
      END,
      settlement_pda = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.settlement_pda
        ELSE usdc_purchase_entitlements.settlement_pda
      END,
      author_proceeds_vault = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.author_proceeds_vault
        ELSE usdc_purchase_entitlements.author_proceeds_vault
      END,
      x402_payment_ref_hash = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.x402_payment_ref_hash
        ELSE usdc_purchase_entitlements.x402_payment_ref_hash
      END,
      x402_settlement_signature_hash = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.x402_settlement_signature_hash
        ELSE usdc_purchase_entitlements.x402_settlement_signature_hash
      END,
      x402_settlement_receipt_pda = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.x402_settlement_receipt_pda
        ELSE usdc_purchase_entitlements.x402_settlement_receipt_pda
      END,
      x402_settlement_vault = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.x402_settlement_vault
        ELSE usdc_purchase_entitlements.x402_settlement_vault
      END,
      refund_status = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.refund_status
        ELSE usdc_purchase_entitlements.refund_status
      END,
      legacy_refund_eligible = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN EXCLUDED.legacy_refund_eligible
        ELSE usdc_purchase_entitlements.legacy_refund_eligible
      END,
      revoked_at = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN NULL
        ELSE usdc_purchase_entitlements.revoked_at
      END,
      revoked_reason = CASE
        WHEN EXCLUDED.last_verified_at >= usdc_purchase_entitlements.last_verified_at
          THEN NULL
        ELSE usdc_purchase_entitlements.revoked_reason
      END,
      first_verified_at = LEAST(
        usdc_purchase_entitlements.first_verified_at,
        EXCLUDED.first_verified_at
      ),
      last_verified_at = GREATEST(
        usdc_purchase_entitlements.last_verified_at,
        EXCLUDED.last_verified_at
      ),
      updated_at = NOW()
  `;
}
