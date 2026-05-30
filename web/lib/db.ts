import { neon } from "@neondatabase/serverless";
import {
  SOLANA_DEVNET_CHAIN_CONTEXT,
  SOLANA_MAINNET_CHAIN_CONTEXT,
  SOLANA_TESTNET_CHAIN_CONTEXT,
  getConfiguredSolanaChainContext,
} from "@/lib/chains";
import {
  AGENTVOUCH_PROTOCOL_VERSION,
  getAgentVouchProgramId,
} from "@/lib/protocolMetadata";

type SqlRow = Record<string, unknown>;
type SqlQuery = {
  <TRow extends SqlRow = SqlRow>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<TRow[]>;
  unsafe(rawSQL: string): unknown;
};

let _sql: ReturnType<typeof neon> | null = null;
let _initializePromise: Promise<void> | null = null;

export function sql(): SqlQuery {
  if (!_sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL environment variable is required. Set it in web/.env.local"
      );
    }
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql as unknown as SqlQuery;
}

function sqlStringLiteral(db: SqlQuery, value: string) {
  return db.unsafe(`'${value.replace(/'/g, "''")}'`);
}

export async function initializeDatabase() {
  if (_initializePromise) {
    return _initializePromise;
  }

  _initializePromise = (async () => {
  const db = sql();
  const configuredSolanaChainContext = getConfiguredSolanaChainContext();
  const currentProgramId = getAgentVouchProgramId();
  const chainContextDefault = sqlStringLiteral(
    db,
    configuredSolanaChainContext
  );

  await db`
    CREATE TABLE IF NOT EXISTS skills (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      skill_id VARCHAR(64) NOT NULL,
      author_pubkey VARCHAR(44) NOT NULL,
      author_kind VARCHAR(24) NOT NULL DEFAULT 'wallet',
      author_external_id VARCHAR(128),
      author_handle VARCHAR(128),
      author_display_name VARCHAR(128),
      publisher_identity_key VARCHAR(192),
      publisher_tier VARCHAR(24) NOT NULL DEFAULT 'registered',
      name VARCHAR(64) NOT NULL,
      description VARCHAR(256),
      tags TEXT[] DEFAULT '{}',
      current_version INTEGER DEFAULT 1,
      ipfs_cid VARCHAR(128),
      on_chain_address VARCHAR(44),
      chain_context VARCHAR(64) DEFAULT ${chainContextDefault},
      total_installs INTEGER DEFAULT 0,
      contact VARCHAR(128),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      -- Uniqueness is per-publisher identity (wallet:<pk> or github:<id>), not the
      -- now-nullable author_pubkey (NULLs are distinct in a UNIQUE, which would let
      -- OAuth publishers duplicate skill_ids). publisher_identity_key is always set
      -- on insert. For wallet rows this also subsumes (author_pubkey, skill_id).
      UNIQUE(publisher_identity_key, skill_id)
    )
  `;

  await db`
    ALTER TABLE skills
    ALTER COLUMN author_pubkey DROP NOT NULL
  `;

  await db`
    ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS author_kind VARCHAR(24) NOT NULL DEFAULT 'wallet'
  `;

  await db`
    ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS author_external_id VARCHAR(128)
  `;

  await db`
    ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS author_handle VARCHAR(128)
  `;

  await db`
    ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS author_display_name VARCHAR(128)
  `;

  await db`
    ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS publisher_identity_key VARCHAR(192)
  `;

  await db`
    ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS publisher_tier VARCHAR(24) NOT NULL DEFAULT 'registered'
  `;

  await db`
    UPDATE skills
    SET
      author_kind = CASE
        WHEN author_pubkey IS NULL AND (author_kind IS NULL OR author_kind = '' OR author_kind = 'wallet') THEN 'unknown'
        ELSE COALESCE(NULLIF(author_kind, ''), 'wallet')
      END,
      publisher_identity_key = COALESCE(
        NULLIF(publisher_identity_key, ''),
        CASE
          WHEN author_pubkey IS NULL THEN CONCAT('unknown:', id::text)
          ELSE CONCAT('wallet:', author_pubkey)
        END
      ),
      publisher_tier = CASE
        WHEN author_pubkey IS NULL AND (publisher_tier IS NULL OR publisher_tier = '' OR publisher_tier = 'registered') THEN 'unverified'
        ELSE COALESCE(NULLIF(publisher_tier, ''), 'registered')
      END
    WHERE publisher_identity_key IS NULL
      OR publisher_identity_key = ''
      OR author_kind IS NULL
      OR author_kind = ''
      OR publisher_tier IS NULL
      OR publisher_tier = ''
      OR (
        author_pubkey IS NULL
        AND (author_kind = 'wallet' OR publisher_tier = 'registered')
      )
  `;

  // Per-identity uniqueness is enforced by the canonical partial index
  // idx_skills_publisher_identity_skill_id (created further below). Drop the
  // redundant full-index variant an earlier pass added so there is exactly one
  // source of truth for the (publisher_identity_key, skill_id) invariant.
  await db`DROP INDEX IF EXISTS idx_skills_publisher_identity_skill`;

  await db`
    ALTER TABLE skills
    ALTER COLUMN chain_context TYPE VARCHAR(64)
  `;

  await db`
    ALTER TABLE skills
    ALTER COLUMN chain_context SET DEFAULT ${chainContextDefault}
  `;

  await db`
    UPDATE skills
    SET chain_context = ${configuredSolanaChainContext}
    WHERE chain_context IS NULL OR chain_context = '' OR LOWER(chain_context) = 'solana'
  `;

  await db`
    UPDATE skills
    SET chain_context = ${SOLANA_MAINNET_CHAIN_CONTEXT}
    WHERE LOWER(chain_context) IN ('solana-mainnet', 'solana:mainnet', 'solana:mainnet-beta')
  `;

  await db`
    UPDATE skills
    SET chain_context = ${SOLANA_DEVNET_CHAIN_CONTEXT}
    WHERE LOWER(chain_context) IN ('solana-devnet', 'solana:devnet')
  `;

  await db`
    UPDATE skills
    SET chain_context = ${SOLANA_TESTNET_CHAIN_CONTEXT}
    WHERE LOWER(chain_context) IN ('solana-testnet', 'solana:testnet')
  `;

  await db`
    CREATE TABLE IF NOT EXISTS skill_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      skill_id UUID REFERENCES skills(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      content TEXT NOT NULL,
      ipfs_cid VARCHAR(128),
      changelog TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(skill_id, version)
    )
  `;

  await db`
    ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS price_usdc_micros BIGINT
  `;

  await db`
    ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS currency_mint VARCHAR(44)
  `;

  await db`
    ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS on_chain_protocol_version VARCHAR(16)
  `;

  await db`
    ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS on_chain_program_id VARCHAR(44)
  `;

  // AI-generated one-liner for the current version's content. Cache key is
  // (summary_sha256, summary_model): regenerate only when content or model change.
  await db`
    ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS summary TEXT
  `;

  await db`
    ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS summary_model VARCHAR(64)
  `;

  await db`
    ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS summary_sha256 VARCHAR(64)
  `;

  await db`
    UPDATE skills
    SET
      on_chain_protocol_version = COALESCE(on_chain_protocol_version, ${AGENTVOUCH_PROTOCOL_VERSION}),
      on_chain_program_id = COALESCE(on_chain_program_id, ${currentProgramId}),
      chain_context = COALESCE(NULLIF(chain_context, ''), ${configuredSolanaChainContext})
    WHERE on_chain_address IS NOT NULL
      AND price_usdc_micros IS NOT NULL
  `;

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_chain_program_address
    ON skills(chain_context, on_chain_program_id, on_chain_address)
    WHERE on_chain_address IS NOT NULL
      AND on_chain_program_id IS NOT NULL
  `;

  await db`
    CREATE TABLE IF NOT EXISTS usdc_purchase_receipts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      skill_db_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      buyer_pubkey VARCHAR(44) NOT NULL,
      payment_tx_signature VARCHAR(128) NOT NULL UNIQUE,
      recipient_ata VARCHAR(44) NOT NULL,
      currency_mint VARCHAR(44) NOT NULL,
      amount_micros BIGINT NOT NULL,
      verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(skill_db_id, buyer_pubkey)
    )
  `;

  await db`
    ALTER TABLE usdc_purchase_receipts
    ADD COLUMN IF NOT EXISTS payment_flow VARCHAR(64)
  `;

  await db`
    ALTER TABLE usdc_purchase_receipts
    ADD COLUMN IF NOT EXISTS protocol_version VARCHAR(16)
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
    ADD COLUMN IF NOT EXISTS purchase_pda VARCHAR(44)
  `;

  await db`
    UPDATE usdc_purchase_receipts
    SET payment_flow = COALESCE(payment_flow, 'repo-x402-usdc')
    WHERE payment_flow IS NULL
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_usdc_purchase_receipts_skill_buyer
    ON usdc_purchase_receipts(skill_db_id, buyer_pubkey)
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_skills_search ON skills
    USING GIN (to_tsvector('english', name || ' ' || COALESCE(description, '')))
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_skills_author ON skills(author_pubkey)
  `;

  // Canonical per-publisher uniqueness (wallet:<pk> / github:<id>). Partial on
  // NOT NULL so legacy null-key rows are excluded. Intentionally fail-closed: a
  // build failure here means pre-existing duplicate (publisher_identity_key,
  // skill_id) rows that must be cleaned up (see runbook) — we do not silently skip
  // it. Verified 0 duplicates at rollout; IF NOT EXISTS makes steady-state a no-op.
  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_publisher_identity_skill_id
    ON skills(publisher_identity_key, skill_id)
    WHERE publisher_identity_key IS NOT NULL
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_skills_author_handle ON skills(author_kind, author_handle)
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_skills_tags ON skills USING GIN(tags)
  `;

  await db`
    CREATE TABLE IF NOT EXISTS api_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_pubkey VARCHAR(44) NOT NULL,
      key_hash VARCHAR(128) NOT NULL,
      key_prefix VARCHAR(12) NOT NULL,
      name VARCHAR(64) NOT NULL DEFAULT 'default',
      permissions TEXT[] DEFAULT '{skills:read,skills:install}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    )
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_api_keys_owner ON api_keys(owner_pubkey)
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix)
  `;
  })().catch((error) => {
    _initializePromise = null;
    throw error;
  });

  return _initializePromise;
}
