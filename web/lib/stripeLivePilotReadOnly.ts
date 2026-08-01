import { neon } from "@neondatabase/serverless";

import type { StripeLivePilotCapSnapshot } from "@/lib/stripeLivePilotPolicy";

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for Stripe pilot monitoring.");
  }
  return neon(databaseUrl);
}

export type StripeLivePilotMonitorSnapshot = StripeLivePilotCapSnapshot & {
  schemaPresent: boolean;
  paidGrossUsdCents: number;
  refundedUsdCents: number;
  feeUsdCents: number;
  netUsdCents: number;
  disputedPayments: number;
  staleReservations: number;
  missingFinancials: number;
  openReviews: number;
};

/** Read-only CLI seam: no schema bootstrap and no Next `server-only` sentinel. */
export async function getStripeLivePilotMonitorSnapshotReadOnly(input: {
  reconciliationSlaMinutes: number;
}): Promise<StripeLivePilotMonitorSnapshot> {
  const db = getDb();
  const exists = (await db`
    SELECT to_regclass('public.stripe_live_pilot_payments') IS NOT NULL AS present
  `) as Array<{ present: boolean }>;
  if (!exists[0]?.present) {
    return {
      schemaPresent: false,
      grossReservedUsdCents: 0,
      completedPayments: 0,
      concurrentReservations: 0,
      paidGrossUsdCents: 0,
      refundedUsdCents: 0,
      feeUsdCents: 0,
      netUsdCents: 0,
      disputedPayments: 0,
      staleReservations: 0,
      missingFinancials: 0,
      openReviews: 0,
    };
  }
  const rows = (await db`
    SELECT
      COALESCE(SUM(amount_usd_cents), 0)::text AS gross_reserved_usd_cents,
      COUNT(*) FILTER (WHERE paid_at IS NOT NULL)::text AS completed_payments,
      COUNT(*) FILTER (
        WHERE paid_at IS NULL
          AND status IN ('reserved', 'session-created', 'review')
      )::text AS concurrent_reservations,
      COALESCE(SUM(amount_usd_cents) FILTER (WHERE paid_at IS NOT NULL), 0)::text
        AS paid_gross_usd_cents,
      COALESCE(SUM(refunded_usd_cents), 0)::text AS refunded_usd_cents,
      COALESCE(SUM(stripe_fee_usd_cents), 0)::text AS fee_usd_cents,
      COALESCE(SUM(net_usd_cents), 0)::text AS net_usd_cents,
      COUNT(*) FILTER (WHERE status = 'disputed')::text AS disputed_payments,
      COUNT(*) FILTER (
        WHERE status IN ('reserved', 'session-created', 'review')
          AND paid_at IS NULL
          AND reservation_expires_at <= NOW()
      )::text AS stale_reservations,
      COUNT(*) FILTER (
        WHERE paid_at IS NOT NULL
          AND paid_at <= NOW() - (${input.reconciliationSlaMinutes} * INTERVAL '1 minute')
          AND (stripe_fee_usd_cents IS NULL OR net_usd_cents IS NULL)
      )::text AS missing_financials,
      COUNT(*) FILTER (WHERE status = 'review')::text AS open_reviews
    FROM stripe_live_pilot_payments
  `) as Array<{
    gross_reserved_usd_cents: string;
    completed_payments: string;
    concurrent_reservations: string;
    paid_gross_usd_cents: string;
    refunded_usd_cents: string;
    fee_usd_cents: string;
    net_usd_cents: string;
    disputed_payments: string;
    stale_reservations: string;
    missing_financials: string;
    open_reviews: string;
  }>;
  const row = rows[0];
  const number = (value: string | undefined) => Number(value ?? "0");
  return {
    schemaPresent: true,
    grossReservedUsdCents: number(row?.gross_reserved_usd_cents),
    completedPayments: number(row?.completed_payments),
    concurrentReservations: number(row?.concurrent_reservations),
    paidGrossUsdCents: number(row?.paid_gross_usd_cents),
    refundedUsdCents: number(row?.refunded_usd_cents),
    feeUsdCents: number(row?.fee_usd_cents),
    netUsdCents: number(row?.net_usd_cents),
    disputedPayments: number(row?.disputed_payments),
    staleReservations: number(row?.stale_reservations),
    missingFinancials: number(row?.missing_financials),
    openReviews: number(row?.open_reviews),
  };
}
