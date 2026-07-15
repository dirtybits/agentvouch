import { sql } from "@/lib/db";

let schemaReady: Promise<void> | null = null;

export type StripeWebhookOutcome =
  | "fulfilled"
  | "revoked"
  | "ignored"
  | "needs-review";

export type RecordStripeWebhookOutcomeInput = {
  eventId: string;
  eventType: string;
  objectId?: string | null;
  paymentRef?: string | null;
  skillDbId?: string | null;
  buyerKey?: string | null;
  outcome: StripeWebhookOutcome;
  reason: string;
  needsReview: boolean;
  details?: Record<string, string | number | boolean | null>;
};

export type StripeReconciliationItem = {
  eventId: string;
  eventType: string;
  objectId: string | null;
  paymentRef: string | null;
  skillDbId: string | null;
  buyerKey: string | null;
  outcome: StripeWebhookOutcome;
  reason: string;
  details: Record<string, unknown>;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type StripeReconciliationAlert = {
  eventId: string;
  severity: "warning" | "critical";
  message: string;
};

export async function ensureStripeReconciliationSchema(): Promise<void> {
  if (schemaReady) return schemaReady;

  schemaReady = (async () => {
    const db = sql();
    await db`
      CREATE TABLE IF NOT EXISTS stripe_webhook_outcomes (
        event_id VARCHAR(128) PRIMARY KEY,
        event_type VARCHAR(128) NOT NULL,
        object_id VARCHAR(128),
        payment_ref VARCHAR(128),
        skill_db_id VARCHAR(64),
        buyer_key VARCHAR(128),
        outcome VARCHAR(32) NOT NULL,
        reason TEXT NOT NULL,
        needs_review BOOLEAN NOT NULL DEFAULT FALSE,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        occurrence_count INTEGER NOT NULL DEFAULT 1,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMPTZ,
        resolution_note TEXT
      )
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_stripe_webhook_outcomes_open_review
      ON stripe_webhook_outcomes(last_seen_at DESC)
      WHERE needs_review = TRUE AND resolved_at IS NULL
    `;
    await db`
      CREATE INDEX IF NOT EXISTS idx_stripe_webhook_outcomes_payment_ref
      ON stripe_webhook_outcomes(payment_ref)
      WHERE payment_ref IS NOT NULL
    `;
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });

  return schemaReady;
}

export async function recordStripeWebhookOutcome(
  input: RecordStripeWebhookOutcomeInput
): Promise<void> {
  await ensureStripeReconciliationSchema();
  const details = JSON.stringify(input.details ?? {});

  await sql()`
    INSERT INTO stripe_webhook_outcomes (
      event_id,
      event_type,
      object_id,
      payment_ref,
      skill_db_id,
      buyer_key,
      outcome,
      reason,
      needs_review,
      details,
      first_seen_at,
      last_seen_at
    )
    VALUES (
      ${input.eventId.slice(0, 128)},
      ${input.eventType.slice(0, 128)},
      ${input.objectId?.slice(0, 128) ?? null},
      ${input.paymentRef?.slice(0, 128) ?? null},
      ${input.skillDbId?.slice(0, 64) ?? null},
      ${input.buyerKey?.slice(0, 128) ?? null},
      ${input.outcome},
      ${input.reason},
      ${input.needsReview},
      ${details}::jsonb,
      NOW(),
      NOW()
    )
    ON CONFLICT (event_id)
    DO UPDATE SET
      event_type = EXCLUDED.event_type,
      object_id = EXCLUDED.object_id,
      payment_ref = EXCLUDED.payment_ref,
      skill_db_id = EXCLUDED.skill_db_id,
      buyer_key = EXCLUDED.buyer_key,
      outcome = EXCLUDED.outcome,
      reason = EXCLUDED.reason,
      needs_review = EXCLUDED.needs_review,
      details = EXCLUDED.details,
      occurrence_count = stripe_webhook_outcomes.occurrence_count + 1,
      last_seen_at = NOW(),
      resolved_at = CASE
        WHEN EXCLUDED.needs_review THEN stripe_webhook_outcomes.resolved_at
        ELSE NULL
      END,
      resolution_note = CASE
        WHEN EXCLUDED.needs_review THEN stripe_webhook_outcomes.resolution_note
        ELSE NULL
      END
  `;
}

async function queryOpenStripeReconciliationItems(
  limit: number
): Promise<StripeReconciliationItem[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
  const rows = await sql()<{
    event_id: string;
    event_type: string;
    object_id: string | null;
    payment_ref: string | null;
    skill_db_id: string | null;
    buyer_key: string | null;
    outcome: StripeWebhookOutcome;
    reason: string;
    details: Record<string, unknown> | null;
    occurrence_count: number;
    first_seen_at: string;
    last_seen_at: string;
  }>`
    SELECT
      event_id,
      event_type,
      object_id,
      payment_ref,
      skill_db_id,
      buyer_key,
      outcome,
      reason,
      details,
      occurrence_count,
      first_seen_at::text,
      last_seen_at::text
    FROM stripe_webhook_outcomes
    WHERE needs_review = TRUE
      AND resolved_at IS NULL
    ORDER BY last_seen_at DESC
    LIMIT ${safeLimit}
  `;

  return rows.map((row) => ({
    eventId: row.event_id,
    eventType: row.event_type,
    objectId: row.object_id,
    paymentRef: row.payment_ref,
    skillDbId: row.skill_db_id,
    buyerKey: row.buyer_key,
    outcome: row.outcome,
    reason: row.reason,
    details: row.details ?? {},
    occurrenceCount: row.occurrence_count,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  }));
}

export async function listOpenStripeReconciliationItems(
  limit = 100
): Promise<StripeReconciliationItem[]> {
  await ensureStripeReconciliationSchema();
  return queryOpenStripeReconciliationItems(limit);
}

/** Read-only monitor path: deliberately does not run schema bootstrap DDL. */
export async function listOpenStripeReconciliationItemsReadOnly(
  limit = 100
): Promise<StripeReconciliationItem[]> {
  return queryOpenStripeReconciliationItems(limit);
}

export function buildStripeReconciliationAlerts(
  items: StripeReconciliationItem[],
  nowMs = Date.now(),
  criticalAgeMs = 15 * 60_000
): StripeReconciliationAlert[] {
  return items.map((item) => {
    const ageMs = Math.max(0, nowMs - Date.parse(item.firstSeenAt));
    const severity = ageMs >= criticalAgeMs ? "critical" : "warning";
    return {
      eventId: item.eventId,
      severity,
      message: `${item.eventType} needs review: ${item.reason}`,
    };
  });
}
