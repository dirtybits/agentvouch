import { createHash } from "node:crypto";
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
export type SqlQuery = {
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

// Concurrent cold starts can each run this idempotent bootstrap at once. Postgres
// then throws "tuple concurrently updated" (XX000) when two sessions CREATE OR
// REPLACE the same function, or deadlocks. Those are transient: the DDL is
// idempotent, so a short retry converges instead of failing the request.
function isTransientInitError(error: unknown): boolean {
  const message = ((error as Error)?.message ?? "").toLowerCase();
  const code = (error as { code?: string })?.code;
  return (
    message.includes("tuple concurrently updated") ||
    message.includes("tuple concurrently deleted") ||
    code === "40P01" // deadlock_detected
  );
}

async function initWithRetry(run: () => Promise<void>): Promise<void> {
  const maxAttempts = 5;
  for (let attempt = 1; ; attempt++) {
    try {
      await run();
      return;
    } catch (error) {
      if (attempt >= maxAttempts || !isTransientInitError(error)) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, 40 * attempt + Math.floor(Math.random() * 60))
      );
    }
  }
}

// --- Schema version gate ---
// Replaying the full idempotent DDL (~75 statements) on every cold start costs
// seconds of sequential round trips before the first real query. Each schema
// component instead records a fingerprint in db_schema_version: when it
// matches, bootstrap is a single SELECT. The fingerprint hashes the DDL
// function's own source plus the env-derived values baked into the DDL, so
// editing the schema code (or changing chain context / program id) re-runs it
// automatically  -  no manual version bump. To force a re-run by hand, delete
// the component's row from db_schema_version.
export function computeSchemaFingerprint(
  ddlSource: string,
  extras: string[] = []
): string {
  return createHash("sha256")
    .update(ddlSource)
    .update("\0")
    .update(extras.join("\0"))
    .digest("hex");
}

export async function runSchemaDdlOnce(
  db: SqlQuery,
  component: string,
  fingerprint: string,
  run: () => Promise<void>
): Promise<void> {
  try {
    const rows = await db`
      SELECT version FROM db_schema_version WHERE component = ${component}
    `;
    if (rows.length > 0 && rows[0].version === fingerprint) {
      return;
    }
  } catch {
    // db_schema_version doesn't exist yet  -  first boot on this database.
  }

  await run();

  await db`
    CREATE TABLE IF NOT EXISTS db_schema_version (
      component TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await db`
    INSERT INTO db_schema_version (component, version, updated_at)
    VALUES (${component}, ${fingerprint}, NOW())
    ON CONFLICT (component)
    DO UPDATE SET version = EXCLUDED.version, updated_at = NOW()
  `;
}

async function runCoreSchemaDdl() {
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
    ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS mirror_source_key VARCHAR(64)
  `;

  await db`
    ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS synced_repo_url VARCHAR(256)
  `;

  await db`
    ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS public_slug VARCHAR(96)
  `;

  await db`
    ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS public_author_slug VARCHAR(96)
  `;

  // Base/EVM listing identity (Phase 3b). Additive + nullable — existing Solana rows keep
  // these NULL. The Base bytes32 listing id is carried HERE, not in on_chain_address (which is
  // a Solana PDA the purchase path interprets via @solana/kit). See
  // .agents/plans/base-port-chain-adapter-phase-3b.plan.md (D1/D4).
  await db`
    ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS evm_listing_id VARCHAR(66)
  `;

  await db`
    ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS evm_contract_address VARCHAR(42)
  `;

  await db`
    ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS evm_tx_hash VARCHAR(66)
  `;

  await db`DROP INDEX IF EXISTS idx_skills_public_slug`;

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

  await db`
    WITH normalized AS (
      SELECT
        id,
        COALESCE(
          NULLIF(
            trim(
              BOTH '-' FROM substring(
                regexp_replace(
                  regexp_replace(lower(skill_id), '[^a-z0-9-]+', '-', 'g'),
                  '-{2,}',
                  '-',
                  'g'
                )
                FROM 1 FOR 64
              )
            ),
            ''
          ),
          left(replace(id::text, '-', ''), 8)
        ) AS base_skill_slug,
        COALESCE(
          NULLIF(
            CASE
              WHEN author_handle IS NOT NULL AND author_handle <> '' THEN trim(
                BOTH '-' FROM substring(
                  regexp_replace(
                    regexp_replace(lower(author_handle), '[^a-z0-9-]+', '-', 'g'),
                    '-{2,}',
                    '-',
                    'g'
                  )
                  FROM 1 FOR 64
                )
              )
              WHEN author_pubkey IS NOT NULL AND author_pubkey <> '' THEN 'wallet-' || lower(left(author_pubkey, 8))
              WHEN publisher_identity_key IS NOT NULL AND publisher_identity_key <> '' THEN trim(
                BOTH '-' FROM substring(
                  regexp_replace(
                    regexp_replace(lower(replace(publisher_identity_key, ':', '-')), '[^a-z0-9-]+', '-', 'g'),
                    '-{2,}',
                    '-',
                    'g'
                  )
                  FROM 1 FOR 64
                )
              )
              ELSE NULL
            END,
            ''
          ),
          'publisher-' || left(replace(id::text, '-', ''), 8)
        ) AS base_author_slug
      FROM skills
      WHERE public_slug IS NULL
        OR public_slug = ''
        OR public_author_slug IS NULL
        OR public_author_slug = ''
    )
    UPDATE skills s
    SET
      public_slug = COALESCE(NULLIF(s.public_slug, ''), normalized.base_skill_slug),
      public_author_slug = COALESCE(NULLIF(s.public_author_slug, ''), normalized.base_author_slug)
    FROM normalized
    WHERE s.id = normalized.id
  `;

  await db`
    WITH ranked AS (
      SELECT
        id,
        public_slug,
        public_author_slug,
        ROW_NUMBER() OVER (
          PARTITION BY public_author_slug, public_slug
          ORDER BY id
        ) AS route_rank
      FROM skills
    )
    UPDATE skills s
    SET public_slug = left(ranked.public_slug, 84) || '-' || left(replace(s.id::text, '-', ''), 8)
    FROM ranked
    WHERE s.id = ranked.id
      AND ranked.route_rank > 1
  `;

  await db`
    ALTER TABLE skills
    ALTER COLUMN public_slug SET NOT NULL
  `;

  await db`
    ALTER TABLE skills
    ALTER COLUMN public_author_slug SET NOT NULL
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

  await db`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

  await db`
    ALTER TABLE skill_versions
    ADD COLUMN IF NOT EXISTS files JSONB
  `;

  await db`
    ALTER TABLE skill_versions
    ADD COLUMN IF NOT EXISTS tree_hash VARCHAR(64)
  `;

  await db`
    ALTER TABLE skill_versions
    ADD COLUMN IF NOT EXISTS storage_backend VARCHAR(16)
  `;

  await db`
    ALTER TABLE skill_versions
    ADD COLUMN IF NOT EXISTS has_executable BOOLEAN NOT NULL DEFAULT false
  `;

  await db`
    UPDATE skill_versions
    SET
      files = jsonb_build_array(
        jsonb_build_object(
          'path', 'SKILL.md',
          'size', octet_length(content),
          'sha256', encode(digest(convert_to(content, 'UTF8'), 'sha256'), 'hex'),
          'contentType', 'text/markdown; charset=utf-8',
          'executable', false
        )
      ),
      tree_hash = encode(
        digest(
          convert_to('SKILL.md', 'UTF8')
            || decode('00', 'hex')
            || convert_to(encode(digest(convert_to(content, 'UTF8'), 'sha256'), 'hex'), 'UTF8'),
          'sha256'
        ),
        'hex'
      ),
      storage_backend = COALESCE(storage_backend, 'inline'),
      has_executable = COALESCE(has_executable, false)
    WHERE files IS NULL
      OR tree_hash IS NULL
      OR storage_backend IS NULL
  `;

  await db`
    CREATE TABLE IF NOT EXISTS skill_scans (
      tree_hash VARCHAR(64) NOT NULL,
      rubric_version VARCHAR(16) NOT NULL,
      model VARCHAR(64) NOT NULL,
      verdict VARCHAR(16) NOT NULL,
      risk VARCHAR(16),
      findings JSONB NOT NULL,
      truncated BOOLEAN NOT NULL DEFAULT false,
      scan_source VARCHAR(32) NOT NULL DEFAULT 'model',
      generated_by_model BOOLEAN NOT NULL DEFAULT true,
      scanned_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (tree_hash, rubric_version, model)
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS skill_download_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      skill_db_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      skill_version_id UUID REFERENCES skill_versions(id) ON DELETE SET NULL,
      skill_version INTEGER,
      event_kind VARCHAR(24) NOT NULL,
      requested_path TEXT,
      wallet_pubkey VARCHAR(44),
      auth_present BOOLEAN NOT NULL DEFAULT false,
      user_agent TEXT,
      referrer TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_skill_download_events_skill_created
    ON skill_download_events(skill_db_id, created_at DESC)
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_skill_download_events_wallet_created
    ON skill_download_events(wallet_pubkey, created_at DESC)
    WHERE wallet_pubkey IS NOT NULL
  `;

  await db`
    ALTER TABLE skill_scans
    ADD COLUMN IF NOT EXISTS scan_source VARCHAR(32) NOT NULL DEFAULT 'model'
  `;

  await db`
    ALTER TABLE skill_scans
    ADD COLUMN IF NOT EXISTS generated_by_model BOOLEAN NOT NULL DEFAULT true
  `;

  await db`
    CREATE TABLE IF NOT EXISTS ai_scan_budget_counters (
      bucket VARCHAR(16) NOT NULL,
      period_start DATE NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (bucket, period_start)
    )
  `;

  await db`
    CREATE OR REPLACE FUNCTION reserve_ai_scan_budget(
      daily_limit INTEGER,
      monthly_limit INTEGER
    )
    RETURNS TABLE (
      ok BOOLEAN,
      reason TEXT,
      daily_used INTEGER,
      monthly_used INTEGER
    )
    LANGUAGE plpgsql
    AS $$
    DECLARE
      day_start DATE := CURRENT_DATE;
      month_start DATE := date_trunc('month', NOW())::date;
      current_daily INTEGER;
      current_monthly INTEGER;
    BEGIN
      IF daily_limit IS NULL OR daily_limit <= 0 THEN
        RETURN QUERY SELECT false, 'daily_scan_budget_exhausted'::text, 0, 0;
        RETURN;
      END IF;

      IF monthly_limit IS NULL OR monthly_limit <= 0 THEN
        RETURN QUERY SELECT false, 'monthly_scan_budget_exhausted'::text, 0, 0;
        RETURN;
      END IF;

      PERFORM pg_advisory_xact_lock(hashtext('agentvouch:ai_scan_budget')::bigint);

      INSERT INTO ai_scan_budget_counters (bucket, period_start, used)
      VALUES ('day', day_start, 0)
      ON CONFLICT (bucket, period_start) DO NOTHING;

      INSERT INTO ai_scan_budget_counters (bucket, period_start, used)
      VALUES ('month', month_start, 0)
      ON CONFLICT (bucket, period_start) DO NOTHING;

      SELECT used
      INTO current_daily
      FROM ai_scan_budget_counters
      WHERE bucket = 'day'
        AND period_start = day_start
      FOR UPDATE;

      SELECT used
      INTO current_monthly
      FROM ai_scan_budget_counters
      WHERE bucket = 'month'
        AND period_start = month_start
      FOR UPDATE;

      IF current_daily >= daily_limit THEN
        RETURN QUERY SELECT false, 'daily_scan_budget_exhausted'::text, current_daily, current_monthly;
        RETURN;
      END IF;

      IF current_monthly >= monthly_limit THEN
        RETURN QUERY SELECT false, 'monthly_scan_budget_exhausted'::text, current_daily, current_monthly;
        RETURN;
      END IF;

      UPDATE ai_scan_budget_counters
      SET used = used + 1,
          updated_at = NOW()
      WHERE bucket = 'day'
        AND period_start = day_start;

      UPDATE ai_scan_budget_counters
      SET used = used + 1,
          updated_at = NOW()
      WHERE bucket = 'month'
        AND period_start = month_start;

      RETURN QUERY SELECT true, NULL::text, current_daily + 1, current_monthly + 1;
    END;
    $$;
  `;

  await db`
    CREATE OR REPLACE FUNCTION release_ai_scan_budget()
    RETURNS void
    LANGUAGE plpgsql
    AS $$
    DECLARE
      day_start DATE := CURRENT_DATE;
      month_start DATE := date_trunc('month', NOW())::date;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('agentvouch:ai_scan_budget')::bigint);

      UPDATE ai_scan_budget_counters
      SET used = GREATEST(used - 1, 0),
          updated_at = NOW()
      WHERE bucket = 'day'
        AND period_start = day_start;

      UPDATE ai_scan_budget_counters
      SET used = GREATEST(used - 1, 0),
          updated_at = NOW()
      WHERE bucket = 'month'
        AND period_start = month_start;
    END;
    $$;
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_skill_versions_tree_hash
    ON skill_versions(tree_hash)
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
    ADD COLUMN IF NOT EXISTS on_chain_protocol_version VARCHAR(64)
  `;

  await db`
    ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS on_chain_program_id VARCHAR(44)
  `;

  // AI-generated one-liner for the current version's content. Cache key is
  // (summary_sha256, summary_model, summary_rubric_version): regenerate when
  // content, model, or summary rubric changes.
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
    ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS summary_rubric_version VARCHAR(16)
  `;

  // Structured "what it does" capability phrases generated alongside the summary
  // one-liner. NULL means never generated (pre-feature rows re-summarize once).
  await db`
    ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS summary_capabilities JSONB
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

  // EVM addresses that feed indexes are stored lowercase at the write boundary; checksum
  // formatting is a display concern. Data normalization of existing rows and the UNIQUE
  // variant of this index both live in the standalone Phase 6 migration
  // (web/scripts/phase6-chain-identity-migration.ts) — only additive, race-tolerant DDL
  // belongs in this request-time initializer.
  await db`
    CREATE INDEX IF NOT EXISTS idx_skills_evm_listing
    ON skills(chain_context, evm_contract_address, evm_listing_id)
    WHERE evm_listing_id IS NOT NULL
      AND evm_contract_address IS NOT NULL
  `;

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
      verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(skill_db_id, buyer_pubkey)
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
    UPDATE usdc_purchase_receipts
    SET payment_flow = COALESCE(payment_flow, 'repo-x402-usdc')
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
    CREATE EXTENSION IF NOT EXISTS pg_trgm
  `;

  await db`
    CREATE OR REPLACE FUNCTION agentvouch_skill_search_tsvector(
      skill_name text,
      skill_id text,
      public_slug text,
      tags text[],
      description text,
      author_handle text,
      author_display_name text,
      agent_username text,
      linked_github_login text
    )
    RETURNS tsvector
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    AS $$
      SELECT
        setweight(to_tsvector('english', COALESCE(skill_name, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(skill_id, '') || ' ' || COALESCE(public_slug, '')), 'A') ||
        setweight(to_tsvector('english', array_to_string(COALESCE(tags, ARRAY[]::text[]), ' ')), 'B') ||
        setweight(to_tsvector('english', COALESCE(agent_username, '') || ' ' || COALESCE(linked_github_login, '') || ' ' || COALESCE(author_handle, '') || ' ' || COALESCE(author_display_name, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(description, '')), 'C')
    $$
  `;

  await db`
    CREATE OR REPLACE FUNCTION agentvouch_skill_search_text(
      skill_name text,
      skill_id text,
      public_slug text,
      tags text[],
      description text,
      author_handle text,
      author_display_name text,
      agent_username text,
      linked_github_login text
    )
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    AS $$
      SELECT lower(
        COALESCE(skill_name, '') || ' ' ||
        COALESCE(skill_id, '') || ' ' ||
        COALESCE(public_slug, '') || ' ' ||
        COALESCE(description, '') || ' ' ||
        array_to_string(COALESCE(tags, ARRAY[]::text[]), ' ') || ' ' ||
        COALESCE(author_handle, '') || ' ' ||
        COALESCE(author_display_name, '') || ' ' ||
        COALESCE(agent_username, '') || ' ' ||
        COALESCE(linked_github_login, '')
      )
    $$
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_usdc_purchase_receipts_skill_buyer
    ON usdc_purchase_receipts(skill_db_id, buyer_pubkey)
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_usdc_purchase_receipts_chain_buyer
    ON usdc_purchase_receipts(skill_db_id, buyer_chain_context, buyer_address)
    WHERE buyer_chain_context IS NOT NULL
      AND buyer_address IS NOT NULL
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_skills_search ON skills
    USING GIN (to_tsvector('english', name || ' ' || COALESCE(description, '')))
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_skills_search_v2 ON skills
    USING GIN (
      agentvouch_skill_search_tsvector(
        name,
        skill_id,
        public_slug,
        tags,
        description,
        author_handle,
        author_display_name,
        NULL::text,
        NULL::text
      )
    )
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_skills_search_trgm ON skills
    USING GIN (
      agentvouch_skill_search_text(
        name,
        skill_id,
        public_slug,
        tags,
        description,
        author_handle,
        author_display_name,
        NULL::text,
        NULL::text
      ) gin_trgm_ops
    )
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_skills_author ON skills(author_pubkey)
  `;

  // Canonical per-publisher uniqueness (wallet:<pk> / github:<id>). Partial on
  // NOT NULL so legacy null-key rows are excluded. Intentionally fail-closed: a
  // build failure here means pre-existing duplicate (publisher_identity_key,
  // skill_id) rows that must be cleaned up (see runbook)  -  we do not silently skip
  // it. Verified 0 duplicates at rollout; IF NOT EXISTS makes steady-state a no-op.
  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_publisher_identity_skill_id
    ON skills(publisher_identity_key, skill_id)
    WHERE publisher_identity_key IS NOT NULL
  `;

  await db`DROP INDEX IF EXISTS idx_skills_public_slug`;

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_public_route
    ON skills(public_author_slug, public_slug)
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_skills_author_handle ON skills(author_kind, author_handle)
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_skills_tags ON skills USING GIN(tags)
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_skills_mirror_source_key
    ON skills(mirror_source_key)
    WHERE mirror_source_key IS NOT NULL
  `;

  await db`
    CREATE TABLE IF NOT EXISTS author_trust_snapshots (
      wallet_pubkey VARCHAR(44) NOT NULL,
      chain_context VARCHAR(64) NOT NULL,
      reputation_score INTEGER NOT NULL DEFAULT 0,
      author_trust JSONB NOT NULL,
      author_trust_summary JSONB,
      refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (wallet_pubkey, chain_context)
    )
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_author_trust_snapshots_score
    ON author_trust_snapshots(chain_context, reputation_score DESC)
  `;

  // Singleton-per-chain snapshot of the homepage platform metrics. Refreshed
  // from on-chain data by the background snapshot refresh job so /api/landing
  // can serve metrics straight from Postgres instead of scanning program
  // accounts on every request.
  await db`
    CREATE TABLE IF NOT EXISTS platform_metrics_snapshot (
      chain_context VARCHAR(64) PRIMARY KEY,
      agents BIGINT NOT NULL DEFAULT 0,
      authors BIGINT NOT NULL DEFAULT 0,
      skills BIGINT NOT NULL DEFAULT 0,
      revenue_usdc_micros BIGINT NOT NULL DEFAULT 0,
      staked_usdc_micros BIGINT NOT NULL DEFAULT 0,
      on_chain_downloads BIGINT NOT NULL DEFAULT 0,
      downloads BIGINT NOT NULL DEFAULT 0,
      refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
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

  await db`
    CREATE TABLE IF NOT EXISTS api_key_auth_nonces (
      owner_pubkey VARCHAR(44) NOT NULL,
      nonce UUID NOT NULL,
      action VARCHAR(32) NOT NULL,
      consumed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (owner_pubkey, nonce)
    )
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_api_key_auth_nonces_expiry
    ON api_key_auth_nonces(expires_at)
  `;

  // First-party "connected repos": a wallet authorizes a GitHub repo it owns to
  // be kept in sync as its own listings (distinct from community mirrors, which
  // are hardcoded in lib/mirror/sources.ts and attributed to a synthetic GitHub
  // identity). One repo maps to exactly one wallet.
  await db`
    CREATE TABLE IF NOT EXISTS connected_repos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_wallet VARCHAR(44) NOT NULL,
      github_owner VARCHAR(120) NOT NULL,
      github_repo VARCHAR(140) NOT NULL,
      branch VARCHAR(120) NOT NULL DEFAULT 'main',
      include_paths TEXT[] NOT NULL DEFAULT '{}',
      verification_method VARCHAR(24) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'active',
      last_commit_sha VARCHAR(64),
      last_synced_at TIMESTAMPTZ,
      last_sync_status VARCHAR(16),
      last_sync_detail TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(github_owner, github_repo)
    )
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_connected_repos_owner
    ON connected_repos(owner_wallet)
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_connected_repos_status
    ON connected_repos(status)
    WHERE status = 'active'
  `;
}

export async function initializeDatabase() {
  if (_initializePromise) {
    return _initializePromise;
  }

  _initializePromise = initWithRetry(async () => {
    const fingerprint = computeSchemaFingerprint(runCoreSchemaDdl.toString(), [
      getConfiguredSolanaChainContext(),
      getAgentVouchProgramId(),
      AGENTVOUCH_PROTOCOL_VERSION,
    ]);
    await runSchemaDdlOnce(sql(), "core", fingerprint, runCoreSchemaDdl);
  }).catch((error) => {
    _initializePromise = null;
    throw error;
  });

  return _initializePromise;
}
