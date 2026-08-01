import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Stripe live-pilot ledger source invariants", () => {
  it("uses an additive table, a global transaction lock, and immutable gross accounting", async () => {
    const source = await readFile(
      resolve(process.cwd(), "lib/stripeLivePilot.ts"),
      "utf8"
    );

    expect(source).toContain(
      "CREATE TABLE IF NOT EXISTS stripe_live_pilot_payments"
    );
    expect(source).toContain("pg_advisory_xact_lock");
    expect(source).toContain("SUM(amount_usd_cents)");
    expect(source).toContain("paid_at IS NOT NULL");
    expect(source).toContain(
      "status IN ('reserved', 'session-created', 'review')"
    );
    expect(source).toContain("paid_at IS NULL");
    expect(source).toContain("status IN ('paid', 'fulfilled', 'review')");
    expect(source).toContain("review_reason = NULL");
    expect(source).not.toContain("reservation_expires_at > NOW()");
    expect(source).toContain("TO_TIMESTAMP(${input.expiresAtUnixSeconds})");
    expect(source).not.toContain("SET amount_usd_cents =");
    expect(source).toContain("checkout_session_id VARCHAR(128) UNIQUE");
    expect(source).toContain("payment_intent_id VARCHAR(128) UNIQUE");
    expect(source).toContain("CHECK (amount_usd_cents > 0)");
    expect(source).toContain(
      "WHERE payment_intent_id = ${input.paymentIntentId.slice(0, 128)}"
    );
    expect(source).not.toContain("OR (\n           ${input.reservationId");
    expect(source).not.toContain("DROP ");
    expect(source).not.toContain("ALTER TABLE");
    expect(source).not.toContain("customer_email");
  });

  it("keeps the CLI read-only DB module free of the Next server-only sentinel", async () => {
    const source = await readFile(
      resolve(process.cwd(), "lib/stripeLivePilotReadOnly.ts"),
      "utf8"
    );
    expect(source).not.toContain('import "server-only"');
    expect(source).toContain("getStripeLivePilotMonitorSnapshotReadOnly");
  });
});
