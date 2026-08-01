import "server-only";

import { randomUUID } from "node:crypto";
import {
  neon,
  type NeonQueryFunctionInTransaction,
} from "@neondatabase/serverless";

import type { StripeLivePilotScope } from "@/lib/stripe";
import {
  evaluateStripeLivePilotCaps,
  type StripeLivePilotCapRejection,
  type StripeLivePilotCapSnapshot,
} from "@/lib/stripeLivePilotPolicy";

export type { StripeLivePilotCapSnapshot } from "@/lib/stripeLivePilotPolicy";

export class StripeLivePilotCapError extends Error {
  constructor(public readonly reason: StripeLivePilotCapRejection) {
    super(`Stripe live-pilot reservation rejected: ${reason}`);
    this.name = "StripeLivePilotCapError";
  }
}

const PILOT_LOCK_KEY = "agentvouch:stripe-live-pilot:v1";
let schemaReady: Promise<void> | null = null;

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for Stripe pilot accounting.");
  }
  return neon(databaseUrl);
}

/**
 * Additive and race-tolerant bootstrap for a new table. Core reservation facts
 * (identity, skill, disclosure, gross amount and expiry) are inserted once and
 * are never updated; lifecycle and authoritative reconciliation fields only
 * move forward. No email, card data, or raw Stripe payload is stored.
 */
export async function ensureStripeLivePilotSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await getDb()`
      CREATE TABLE IF NOT EXISTS stripe_live_pilot_payments (
        reservation_id UUID PRIMARY KEY,
        buyer_account_id UUID NOT NULL,
        skill_db_id UUID NOT NULL,
        recourse_disclosure_version VARCHAR(64) NOT NULL,
        amount_usd_cents BIGINT NOT NULL CHECK (amount_usd_cents > 0),
        status VARCHAR(32) NOT NULL CHECK (
          status IN (
            'reserved',
            'session-created',
            'stripe-failed',
            'paid',
            'fulfilled',
            'review',
            'expired',
            'refunded',
            'disputed'
          )
        ),
        checkout_session_id VARCHAR(128) UNIQUE,
        payment_intent_id VARCHAR(128) UNIQUE,
        stripe_fee_usd_cents BIGINT CHECK (stripe_fee_usd_cents >= 0),
        net_usd_cents BIGINT CHECK (net_usd_cents >= 0),
        refunded_usd_cents BIGINT NOT NULL DEFAULT 0 CHECK (refunded_usd_cents >= 0),
        dispute_opened_at TIMESTAMPTZ,
        reserved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reservation_expires_at TIMESTAMPTZ NOT NULL,
        checkout_session_created_at TIMESTAMPTZ,
        paid_at TIMESTAMPTZ,
        fulfilled_at TIMESTAMPTZ,
        terminal_at TIMESTAMPTZ,
        reconciliation_updated_at TIMESTAMPTZ,
        review_reason VARCHAR(512),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

type CapRow = {
  gross_reserved_usd_cents: string;
  completed_payments: string;
  concurrent_reservations: string;
};

function capSnapshot(row: CapRow | undefined): StripeLivePilotCapSnapshot {
  const snapshot = {
    grossReservedUsdCents: Number(row?.gross_reserved_usd_cents ?? "0"),
    completedPayments: Number(row?.completed_payments ?? "0"),
    concurrentReservations: Number(row?.concurrent_reservations ?? "0"),
  };
  if (
    Object.values(snapshot).some(
      (value) => !Number.isSafeInteger(value) || value < 0
    )
  ) {
    throw new StripeLivePilotCapError("invalid-state");
  }
  return snapshot;
}

function pilotCapQuery(txn: NeonQueryFunctionInTransaction<false, false>) {
  return txn`
    SELECT
      COALESCE(SUM(amount_usd_cents), 0)::text AS gross_reserved_usd_cents,
      COUNT(*) FILTER (WHERE paid_at IS NOT NULL)::text AS completed_payments,
      COUNT(*) FILTER (
        WHERE paid_at IS NULL
          AND status IN ('reserved', 'session-created', 'review')
      )::text AS concurrent_reservations
    FROM stripe_live_pilot_payments
  `;
}

export async function reserveStripeLivePilotCheckout(input: {
  buyerAccountId: string;
  skillDbId: string;
  recourseDisclosureVersion: string;
  amountUsdCents: number;
  expiresAtUnixSeconds: number;
  scope: StripeLivePilotScope;
}): Promise<{ reservationId: string }> {
  await ensureStripeLivePilotSchema();
  const reservationId = randomUUID();
  const db = getDb();
  const results = await db.transaction((txn) => [
    txn`SELECT pg_advisory_xact_lock(hashtextextended(${PILOT_LOCK_KEY}, 0))`,
    pilotCapQuery(txn),
    txn`
      INSERT INTO stripe_live_pilot_payments (
        reservation_id,
        buyer_account_id,
        skill_db_id,
        recourse_disclosure_version,
        amount_usd_cents,
        status,
        reservation_expires_at
      )
      SELECT
        ${reservationId}::uuid,
        ${input.buyerAccountId}::uuid,
        ${input.skillDbId}::uuid,
        ${input.recourseDisclosureVersion},
        ${input.amountUsdCents},
        'reserved',
        TO_TIMESTAMP(${input.expiresAtUnixSeconds})
      WHERE
        (SELECT COALESCE(SUM(amount_usd_cents), 0)
         FROM stripe_live_pilot_payments) + ${input.amountUsdCents}
          <= ${input.scope.maxGrossUsdCents}
        AND (
          (SELECT COUNT(*) FROM stripe_live_pilot_payments
           WHERE paid_at IS NOT NULL)
          +
          (SELECT COUNT(*) FROM stripe_live_pilot_payments
           WHERE paid_at IS NULL
             AND status IN ('reserved', 'session-created', 'review'))
        )
          < ${input.scope.maxCompletedPayments}
        AND (SELECT COUNT(*) FROM stripe_live_pilot_payments
             WHERE paid_at IS NULL
               AND status IN ('reserved', 'session-created', 'review'))
          < ${input.scope.maxConcurrentReservations}
      RETURNING reservation_id::text
    `,
  ]);
  const inserted = (results[2] as Array<{ reservation_id: string }>)[0];
  if (inserted) return { reservationId: inserted.reservation_id };

  const snapshot = capSnapshot((results[1] as CapRow[])[0]);
  throw new StripeLivePilotCapError(
    evaluateStripeLivePilotCaps(snapshot, input.amountUsdCents, input.scope) ??
      "invalid-state"
  );
}

export async function attachStripeLivePilotCheckoutSession(input: {
  reservationId: string;
  checkoutSessionId: string;
}): Promise<void> {
  await ensureStripeLivePilotSchema();
  const results = await getDb().transaction((txn) => [
    txn`SELECT pg_advisory_xact_lock(hashtextextended(${PILOT_LOCK_KEY}, 0))`,
    txn`
      UPDATE stripe_live_pilot_payments
      SET status = 'session-created',
          checkout_session_id = ${input.checkoutSessionId.slice(0, 128)},
          checkout_session_created_at = COALESCE(checkout_session_created_at, NOW()),
          updated_at = NOW()
      WHERE reservation_id = ${input.reservationId}::uuid
        AND status = 'reserved'
        AND checkout_session_id IS NULL
      RETURNING reservation_id::text
    `,
  ]);
  if (!(results[1] as unknown[]).length) {
    throw new Error(
      "Stripe pilot reservation could not bind its Checkout Session."
    );
  }
}

export async function closeStripeLivePilotReservationAfterApiFailure(
  reservationId: string,
  reason: string
): Promise<void> {
  await ensureStripeLivePilotSchema();
  await getDb().transaction((txn) => [
    txn`SELECT pg_advisory_xact_lock(hashtextextended(${PILOT_LOCK_KEY}, 0))`,
    txn`
      UPDATE stripe_live_pilot_payments
      SET status = 'stripe-failed',
          terminal_at = COALESCE(terminal_at, NOW()),
          review_reason = ${reason.slice(0, 512)},
          updated_at = NOW()
      WHERE reservation_id = ${reservationId}::uuid
        AND status = 'reserved'
    `,
  ]);
}

type PilotPaymentRow = {
  reservation_id: string;
  buyer_account_id: string;
  skill_db_id: string;
  recourse_disclosure_version: string;
  amount_usd_cents: string;
  status: string;
  checkout_session_id: string | null;
  payment_intent_id: string | null;
  paid_at: string | null;
};

export async function recordStripeLivePilotPaymentCompleted(input: {
  reservationId: string;
  checkoutSessionId: string;
  paymentIntentId: string;
  buyerAccountId: string;
  skillDbId: string;
  recourseDisclosureVersion: string;
  grossUsdCents: number;
}): Promise<{ grantAllowed: boolean; replay: boolean }> {
  await ensureStripeLivePilotSchema();
  const results = await getDb().transaction((txn) => [
    txn`SELECT pg_advisory_xact_lock(hashtextextended(${PILOT_LOCK_KEY}, 0))`,
    txn`
      SELECT
        reservation_id::text,
        buyer_account_id::text,
        skill_db_id::text,
        recourse_disclosure_version,
        amount_usd_cents::text,
        status,
        checkout_session_id,
        payment_intent_id,
        paid_at::text
      FROM stripe_live_pilot_payments
      WHERE reservation_id = ${input.reservationId}::uuid
      LIMIT 1
    `,
    txn`
      UPDATE stripe_live_pilot_payments
      SET status = CASE WHEN status = 'review' THEN 'review' ELSE 'paid' END,
          checkout_session_id = COALESCE(
            checkout_session_id,
            ${input.checkoutSessionId.slice(0, 128)}
          ),
          checkout_session_created_at = COALESCE(
            checkout_session_created_at,
            NOW()
          ),
          payment_intent_id = COALESCE(payment_intent_id, ${input.paymentIntentId.slice(
            0,
            128
          )}),
          paid_at = COALESCE(paid_at, NOW()),
          updated_at = NOW()
      WHERE reservation_id = ${input.reservationId}::uuid
        AND buyer_account_id = ${input.buyerAccountId}::uuid
        AND skill_db_id = ${input.skillDbId}::uuid
        AND recourse_disclosure_version = ${input.recourseDisclosureVersion}
        AND amount_usd_cents = ${input.grossUsdCents}
        AND (checkout_session_id IS NULL OR checkout_session_id = ${input.checkoutSessionId.slice(
          0,
          128
        )})
        AND (payment_intent_id IS NULL OR payment_intent_id = ${input.paymentIntentId.slice(
          0,
          128
        )})
        AND status IN ('session-created', 'paid', 'fulfilled', 'review')
      RETURNING paid_at::text
    `,
  ]);
  const before = (results[1] as PilotPaymentRow[])[0];
  if (!before) throw new Error("Stripe pilot reservation was not found.");
  const updated = (results[2] as Array<{ paid_at: string }>)[0];
  if (!updated) {
    if (before.status === "refunded" || before.status === "disputed") {
      return { grantAllowed: false, replay: true };
    }
    throw new Error(
      "Stripe pilot payment did not match its immutable reservation."
    );
  }
  return { grantAllowed: true, replay: before.paid_at !== null };
}

export async function markStripeLivePilotFulfilled(
  reservationId: string
): Promise<void> {
  await ensureStripeLivePilotSchema();
  await getDb().transaction((txn) => [
    txn`SELECT pg_advisory_xact_lock(hashtextextended(${PILOT_LOCK_KEY}, 0))`,
    txn`
      UPDATE stripe_live_pilot_payments
      SET status = 'fulfilled',
          fulfilled_at = COALESCE(fulfilled_at, NOW()),
          review_reason = NULL,
          updated_at = NOW()
      WHERE reservation_id = ${reservationId}::uuid
        AND status IN ('paid', 'fulfilled', 'review')
        AND paid_at IS NOT NULL
    `,
  ]);
}

export async function markStripeLivePilotReview(input: {
  reservationId: string;
  reason: string;
}): Promise<void> {
  await ensureStripeLivePilotSchema();
  await getDb()`
    UPDATE stripe_live_pilot_payments
    SET status = 'review',
        review_reason = ${input.reason.slice(0, 512)},
        updated_at = NOW()
    WHERE reservation_id = ${input.reservationId}::uuid
      AND status NOT IN ('refunded', 'disputed')
  `;
}

export async function expireStripeLivePilotReservation(input: {
  reservationId: string;
  checkoutSessionId: string;
  buyerAccountId: string;
  skillDbId: string;
  recourseDisclosureVersion: string;
  grossUsdCents: number;
}): Promise<boolean> {
  await ensureStripeLivePilotSchema();
  const results = await getDb().transaction((txn) => [
    txn`SELECT pg_advisory_xact_lock(hashtextextended(${PILOT_LOCK_KEY}, 0))`,
    txn`
      UPDATE stripe_live_pilot_payments
      SET status = 'expired',
          checkout_session_id = COALESCE(
            checkout_session_id,
            ${input.checkoutSessionId.slice(0, 128)}
          ),
          checkout_session_created_at = COALESCE(
            checkout_session_created_at,
            NOW()
          ),
          terminal_at = COALESCE(terminal_at, NOW()),
          updated_at = NOW()
      WHERE reservation_id = ${input.reservationId}::uuid
        AND buyer_account_id = ${input.buyerAccountId}::uuid
        AND skill_db_id = ${input.skillDbId}::uuid
        AND recourse_disclosure_version = ${input.recourseDisclosureVersion}
        AND amount_usd_cents = ${input.grossUsdCents}
        AND (checkout_session_id IS NULL OR checkout_session_id = ${input.checkoutSessionId.slice(
          0,
          128
        )})
        AND status IN ('reserved', 'session-created', 'review')
        AND paid_at IS NULL
      RETURNING reservation_id
    `,
  ]);
  return (results[1] as unknown[]).length > 0;
}

export async function recordStripeLivePilotTerminalState(input: {
  paymentIntentId: string;
  kind: "full-refund" | "partial-refund" | "dispute";
  refundedUsdCents?: number | null;
}): Promise<number> {
  await ensureStripeLivePilotSchema();
  const status =
    input.kind === "full-refund"
      ? "refunded"
      : input.kind === "dispute"
      ? "disputed"
      : "review";
  const reason =
    input.kind === "partial-refund" ? "partial refund requires review" : null;
  const results = await getDb().transaction((txn) => [
    txn`SELECT pg_advisory_xact_lock(hashtextextended(${PILOT_LOCK_KEY}, 0))`,
    txn`
      UPDATE stripe_live_pilot_payments
      SET status = ${status},
          payment_intent_id = COALESCE(
            payment_intent_id,
            ${input.paymentIntentId.slice(0, 128)}
          ),
          refunded_usd_cents = GREATEST(
            refunded_usd_cents,
            ${input.refundedUsdCents ?? 0}
          ),
          dispute_opened_at = CASE
            WHEN ${
              input.kind
            } = 'dispute' THEN COALESCE(dispute_opened_at, NOW())
            ELSE dispute_opened_at
          END,
          terminal_at = CASE
            WHEN ${input.kind} IN ('full-refund', 'dispute')
              THEN COALESCE(terminal_at, NOW())
            ELSE terminal_at
          END,
          review_reason = COALESCE(${reason}, review_reason),
          updated_at = NOW()
      WHERE payment_intent_id = ${input.paymentIntentId.slice(0, 128)}
      RETURNING reservation_id
    `,
  ]);
  return (results[1] as unknown[]).length;
}

export async function reconcileStripeLivePilotFinancials(input: {
  reservationId: string;
  paymentIntentId: string;
  grossUsdCents: number;
  feeUsdCents: number;
  netUsdCents: number;
}): Promise<boolean> {
  if (
    [input.grossUsdCents, input.feeUsdCents, input.netUsdCents].some(
      (value) => !Number.isSafeInteger(value) || value < 0
    ) ||
    input.grossUsdCents !== input.feeUsdCents + input.netUsdCents
  ) {
    throw new Error(
      "Stripe fee/net reconciliation is internally inconsistent."
    );
  }
  await ensureStripeLivePilotSchema();
  const rows = await getDb()`
    UPDATE stripe_live_pilot_payments
    SET stripe_fee_usd_cents = ${input.feeUsdCents},
        net_usd_cents = ${input.netUsdCents},
        reconciliation_updated_at = NOW(),
        updated_at = NOW()
    WHERE reservation_id = ${input.reservationId}::uuid
      AND payment_intent_id = ${input.paymentIntentId.slice(0, 128)}
      AND amount_usd_cents = ${input.grossUsdCents}
      AND (stripe_fee_usd_cents IS NULL OR stripe_fee_usd_cents = ${
        input.feeUsdCents
      })
      AND (net_usd_cents IS NULL OR net_usd_cents = ${input.netUsdCents})
    RETURNING reservation_id
  `;
  return rows.length > 0;
}
