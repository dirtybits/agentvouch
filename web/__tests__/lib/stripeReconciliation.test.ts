import { describe, expect, it } from "vitest";
import {
  buildStripeReconciliationAlerts,
  type StripeReconciliationItem,
} from "@/lib/stripeReconciliation";

function item(firstSeenAt: string): StripeReconciliationItem {
  return {
    eventId: "evt_1",
    eventType: "checkout.session.completed",
    objectId: "cs_1",
    paymentRef: "stripe:pi_1",
    skillDbId: null,
    buyerKey: null,
    outcome: "needs-review",
    reason: "charged amount does not match checkout metadata price",
    details: {},
    occurrenceCount: 1,
    firstSeenAt,
    lastSeenAt: firstSeenAt,
  };
}

describe("Stripe reconciliation alerts", () => {
  it("escalates unresolved review items after the critical age", () => {
    const now = Date.parse("2026-07-15T12:30:00.000Z");

    expect(
      buildStripeReconciliationAlerts(
        [item("2026-07-15T12:20:00.000Z")],
        now
      )[0]
    ).toMatchObject({ severity: "warning", eventId: "evt_1" });
    expect(
      buildStripeReconciliationAlerts(
        [item("2026-07-15T12:00:00.000Z")],
        now
      )[0]
    ).toMatchObject({ severity: "critical", eventId: "evt_1" });
  });
});
