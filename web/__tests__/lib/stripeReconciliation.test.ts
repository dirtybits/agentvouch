import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  sql: () => mocks.sql(),
}));

import {
  buildStripeReconciliationAlerts,
  listOpenStripeReconciliationItemsReadOnly,
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("reports an empty read-only state before the webhook table exists", async () => {
    const query = vi.fn().mockResolvedValue([{ table_name: null }]);
    mocks.sql.mockReturnValue(query);

    await expect(listOpenStripeReconciliationItemsReadOnly()).resolves.toEqual(
      []
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("queries unresolved outcomes after the webhook table exists", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ table_name: "stripe_webhook_outcomes" }])
      .mockResolvedValueOnce([]);
    mocks.sql.mockReturnValue(query);

    await expect(listOpenStripeReconciliationItemsReadOnly()).resolves.toEqual(
      []
    );
    expect(query).toHaveBeenCalledTimes(2);
  });
});
