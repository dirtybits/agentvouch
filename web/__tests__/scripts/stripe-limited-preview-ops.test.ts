import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPilotSnapshot: vi.fn(),
  listReconciliationItems: vi.fn(),
}));

vi.mock("../../lib/stripeLivePilotReadOnly", () => ({
  getStripeLivePilotMonitorSnapshotReadOnly: (...args: unknown[]) =>
    mocks.getPilotSnapshot(...args),
}));

vi.mock("../../lib/stripeReconciliation", () => ({
  listOpenStripeReconciliationItemsReadOnly: (...args: unknown[]) =>
    mocks.listReconciliationItems(...args),
  buildStripeReconciliationAlerts: () => [],
}));
import {
  buildStripePreviewPreflight,
  parseStripeOpsMode,
  runStripeOps,
} from "../../scripts/stripe-limited-preview-ops";

describe("Stripe limited-preview operations", () => {
  it("only permits read-only preflight and monitor modes", () => {
    expect(parseStripeOpsMode([])).toBe("preflight");
    expect(parseStripeOpsMode(["monitor"])).toBe("monitor");
    expect(() => parseStripeOpsMode(["monitor", "--apply"])).toThrow(
      "read-only"
    );
    expect(() => parseStripeOpsMode(["resolve"])).toThrow("read-only");
  });

  it("reports every production activation gate without exposing values", () => {
    const preflight = buildStripePreviewPreflight({
      DATABASE_URL: "postgres://configured",
      STRIPE_SECRET_KEY: "sk_live_secret",
      STRIPE_WEBHOOK_SECRET: "whsec_secret",
      AGENTVOUCH_STRIPE_CHECKOUT_ENABLED: "true",
      NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED: "true",
      VERCEL_ENV: "production",
    });

    expect(preflight.checkoutEnabled).toBe(false);
    expect(preflight.blockers).toContain(
      "production edge rate limit is not acknowledged by AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY"
    );
    expect(JSON.stringify(preflight)).not.toContain("sk_live_secret");

    // A live key is still blocked until it is explicitly acknowledged, even
    // with every other production gate satisfied.
    const liveUnacknowledged = buildStripePreviewPreflight({
      DATABASE_URL: "postgres://configured",
      STRIPE_SECRET_KEY: "sk_live_secret",
      STRIPE_WEBHOOK_SECRET: "whsec_secret",
      AGENTVOUCH_STRIPE_CHECKOUT_ENABLED: "true",
      NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED: "true",
      AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY: "true",
      VERCEL_ENV: "production",
    });
    expect(liveUnacknowledged.checkoutEnabled).toBe(false);
    expect(liveUnacknowledged.blockers).toContain(
      "STRIPE_SECRET_KEY is a live key and AGENTVOUCH_STRIPE_LIVE_MODE_ENABLED is not true"
    );
    expect(JSON.stringify(liveUnacknowledged)).not.toContain("sk_live_secret");

    const fullyConfiguredButSourceBlocked = buildStripePreviewPreflight({
      DATABASE_URL: "postgres://configured",
      STRIPE_SECRET_KEY: "sk_live_secret",
      STRIPE_WEBHOOK_SECRET: "whsec_secret",
      AGENTVOUCH_STRIPE_CHECKOUT_ENABLED: "true",
      NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED: "true",
      AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY: "true",
      AGENTVOUCH_STRIPE_LIVE_MODE_ENABLED: "true",
      AGENTVOUCH_STRIPE_LIVE_PILOT_SKILL_IDS:
        "00000000-0000-4000-8000-000000000001",
      AGENTVOUCH_STRIPE_LIVE_PILOT_BUYER_ACCOUNT_IDS:
        "00000000-0000-4000-8000-000000000002",
      AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_UNIT_USD_CENTS: "500",
      AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_GROSS_USD_CENTS: "1000",
      AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_COMPLETED_PAYMENTS: "3",
      AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_CONCURRENT_RESERVATIONS: "1",
      AGENTVOUCH_STRIPE_LIVE_PILOT_RESERVATION_TTL_MINUTES: "31",
      AGENTVOUCH_STRIPE_LIVE_PILOT_RECONCILIATION_SLA_MINUTES: "60",
      AGENTVOUCH_BUYER_CARD_ACCESS_ENABLED: "true",
      NEXT_PUBLIC_AGENTVOUCH_BUYER_CARD_ACCESS_ENABLED: "true",
      AGENTVOUCH_BUYER_AUTH_ENABLED: "true",
      NEXT_PUBLIC_AGENTVOUCH_BUYER_AUTH_ENABLED: "true",
      CLERK_SECRET_KEY: "clerk_secret",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "clerk_public",
      VERCEL_ENV: "production",
    });
    expect(fullyConfiguredButSourceBlocked.checkoutEnabled).toBe(false);
    expect(fullyConfiguredButSourceBlocked.livePilotImplementationReady).toBe(
      false
    );
    expect(fullyConfiguredButSourceBlocked.blockers).toContain(
      "live Stripe pilot remains source-disabled pending founder decisions, schema rehearsal, WAF proof, monitoring readiness, and explicit activation review"
    );
    expect(JSON.stringify(fullyConfiguredButSourceBlocked)).not.toContain(
      "sk_live_secret"
    );
  });

  it("reports durable pilot exposure, remaining caps, and financial alerts read-only", async () => {
    mocks.listReconciliationItems.mockResolvedValue([]);
    mocks.getPilotSnapshot.mockResolvedValue({
      schemaPresent: true,
      grossReservedUsdCents: 700,
      completedPayments: 2,
      concurrentReservations: 1,
      paidGrossUsdCents: 500,
      refundedUsdCents: 100,
      feeUsdCents: 15,
      netUsdCents: 485,
      staleReservations: 1,
      missingFinancials: 1,
      openReviews: 1,
      disputedPayments: 1,
    });
    const result = await runStripeOps("monitor", {
      DATABASE_URL: "postgres://configured",
      STRIPE_SECRET_KEY: "sk_live_secret",
      STRIPE_WEBHOOK_SECRET: "whsec_secret",
      AGENTVOUCH_STRIPE_CHECKOUT_ENABLED: "true",
      NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED: "true",
      AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY: "true",
      AGENTVOUCH_STRIPE_LIVE_MODE_ENABLED: "true",
      AGENTVOUCH_STRIPE_LIVE_PILOT_SKILL_IDS:
        "00000000-0000-4000-8000-000000000001",
      AGENTVOUCH_STRIPE_LIVE_PILOT_BUYER_ACCOUNT_IDS:
        "00000000-0000-4000-8000-000000000002",
      AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_UNIT_USD_CENTS: "500",
      AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_GROSS_USD_CENTS: "1000",
      AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_COMPLETED_PAYMENTS: "3",
      AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_CONCURRENT_RESERVATIONS: "2",
      AGENTVOUCH_STRIPE_LIVE_PILOT_RESERVATION_TTL_MINUTES: "31",
      AGENTVOUCH_STRIPE_LIVE_PILOT_RECONCILIATION_SLA_MINUTES: "60",
      AGENTVOUCH_BUYER_CARD_ACCESS_ENABLED: "true",
      NEXT_PUBLIC_AGENTVOUCH_BUYER_CARD_ACCESS_ENABLED: "true",
      AGENTVOUCH_BUYER_AUTH_ENABLED: "true",
      NEXT_PUBLIC_AGENTVOUCH_BUYER_AUTH_ENABLED: "true",
      CLERK_SECRET_KEY: "clerk_secret",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "clerk_public",
      VERCEL_ENV: "production",
    });

    expect(result.ok).toBe(false);
    expect(result.output.livePilot).toMatchObject({
      grossReservedUsdCents: 700,
      remainingGrossUsdCents: 300,
      remainingCompletedPayments: 0,
      remainingConcurrentReservations: 1,
      disputedPayments: 1,
    });
    expect(result.output.alerts).toHaveLength(3);
    expect(JSON.stringify(result.output)).not.toContain("sk_live_secret");
    expect(JSON.stringify(result.output)).not.toContain(
      "00000000-0000-4000-8000-000000000002"
    );
  });
});
