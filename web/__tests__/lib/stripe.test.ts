import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  detectStripeKeyMode,
  getStripeCheckoutActivation,
  getStripeLivePilotScope,
  STRIPE_LIVE_PILOT_IMPLEMENTATION_READY,
  createCheckoutSession,
  isStripeEnabled,
  stripeEventModeMismatch,
  verifyAndParseWebhook,
  usdcMicrosToUsdCents,
} from "@/lib/stripe";
import { isStripeCheckoutUiEnabled } from "@/lib/stripeUi";

describe("stripe helpers", () => {
  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_API_BASE;
    delete process.env.NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED;
    delete process.env.AGENTVOUCH_STRIPE_CHECKOUT_ENABLED;
    delete process.env.AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY;
    delete process.env.AGENTVOUCH_STRIPE_LIVE_MODE_ENABLED;
    delete process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_SKILL_IDS;
    delete process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_BUYER_ACCOUNT_IDS;
    delete process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_UNIT_USD_CENTS;
    delete process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_GROSS_USD_CENTS;
    delete process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_COMPLETED_PAYMENTS;
    delete process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_CONCURRENT_RESERVATIONS;
    delete process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_RESERVATION_TTL_MINUTES;
    delete process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_RECONCILIATION_SLA_MINUTES;
    delete process.env.VERCEL_ENV;
  });

  it("uses a public flag for render-affecting checkout UI", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_123";
    expect(isStripeCheckoutUiEnabled()).toBe(false);

    process.env.NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED = "true";
    expect(isStripeCheckoutUiEnabled()).toBe(true);
  });

  it("keeps the render-affecting flag free of server-only imports", async () => {
    // Rendering code imports @/lib/stripeUi. If it ever pulls in node:crypto or
    // a server-only env read, a client component importing it would break the
    // browser bundle, so keep this module free of both.
    const source = await readFile(
      resolve(process.cwd(), "lib/stripeUi.ts"),
      "utf8"
    );
    const code = source.replace(/\/\/.*$/gm, "");
    expect(code).not.toContain("node:");
    expect(code).not.toContain("STRIPE_SECRET_KEY");
    expect(code).not.toContain("AGENTVOUCH_STRIPE");
    expect(code).toContain("NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED");
  });

  it("requires both API and webhook secrets before checkout is enabled", () => {
    expect(isStripeEnabled()).toBe(false);

    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    expect(isStripeEnabled()).toBe(false);

    process.env.STRIPE_WEBHOOK_SECRET = "whsec_123";
    expect(isStripeEnabled()).toBe(true);
  });

  it("keeps checkout behind a separate server activation flag", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_123";

    expect(getStripeCheckoutActivation().enabled).toBe(false);

    process.env.AGENTVOUCH_STRIPE_CHECKOUT_ENABLED = "true";
    expect(getStripeCheckoutActivation()).toMatchObject({
      enabled: true,
      stripeConfigured: true,
      serverFlagEnabled: true,
      productionEdgeRateLimitReady: true,
    });
  });

  it("requires an edge-rate-limit acknowledgement and source readiness for live keys", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_123";
    process.env.AGENTVOUCH_STRIPE_CHECKOUT_ENABLED = "true";
    process.env.AGENTVOUCH_STRIPE_LIVE_MODE_ENABLED = "true";
    process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_SKILL_IDS =
      "00000000-0000-4000-8000-000000000001";
    process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_BUYER_ACCOUNT_IDS =
      "00000000-0000-4000-8000-000000000002";
    process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_UNIT_USD_CENTS = "500";
    process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_GROSS_USD_CENTS = "1000";
    process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_COMPLETED_PAYMENTS = "3";
    process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_CONCURRENT_RESERVATIONS = "1";
    process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_RESERVATION_TTL_MINUTES = "31";
    process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_RECONCILIATION_SLA_MINUTES = "60";
    process.env.VERCEL_ENV = "production";

    expect(getStripeCheckoutActivation().enabled).toBe(false);

    process.env.AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY = "true";
    expect(getStripeCheckoutActivation()).toMatchObject({
      enabled: false,
      productionEdgeRateLimitReady: true,
      livePilotImplementationReady: false,
    });
    expect(STRIPE_LIVE_PILOT_IMPLEMENTATION_READY).toBe(false);
  });

  it("detects the mode of Stripe secret and restricted keys", () => {
    expect(detectStripeKeyMode("sk_test_123")).toBe("test");
    expect(detectStripeKeyMode("rk_test_123")).toBe("test");
    expect(detectStripeKeyMode("sk_live_123")).toBe("live");
    expect(detectStripeKeyMode("rk_live_123")).toBe("live");
    expect(detectStripeKeyMode("  sk_test_123  ")).toBe("test");
    // Fail closed on anything unrecognized.
    expect(detectStripeKeyMode("sk_testing_123")).toBe("unknown");
    expect(detectStripeKeyMode("pk_test_123")).toBe("unknown");
    expect(detectStripeKeyMode("")).toBe("unknown");
    expect(detectStripeKeyMode(undefined)).toBe("unknown");
  });

  it("requires live acknowledgement and WAF proof even on preview", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_123";
    process.env.AGENTVOUCH_STRIPE_CHECKOUT_ENABLED = "true";
    process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_SKILL_IDS =
      "00000000-0000-4000-8000-000000000001";
    process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_BUYER_ACCOUNT_IDS =
      "00000000-0000-4000-8000-000000000002";
    process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_UNIT_USD_CENTS = "500";
    process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_GROSS_USD_CENTS = "1000";
    process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_COMPLETED_PAYMENTS = "3";
    process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_CONCURRENT_RESERVATIONS = "1";
    process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_RESERVATION_TTL_MINUTES = "31";
    process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_RECONCILIATION_SLA_MINUTES = "60";
    process.env.VERCEL_ENV = "preview";

    expect(getStripeCheckoutActivation()).toMatchObject({
      enabled: false,
      keyMode: "live",
      liveModeAcknowledged: false,
      keyModePermitted: false,
      productionEdgeRateLimitReady: false,
    });

    process.env.AGENTVOUCH_STRIPE_LIVE_MODE_ENABLED = "true";
    expect(getStripeCheckoutActivation()).toMatchObject({
      enabled: false,
      keyMode: "live",
      keyModePermitted: true,
      productionEdgeRateLimitReady: false,
    });
    process.env.AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY = "true";
    expect(getStripeCheckoutActivation()).toMatchObject({
      enabled: false,
      productionEdgeRateLimitReady: true,
      livePilotImplementationReady: false,
    });
  });

  it("refuses an unrecognized key even with every flag set", () => {
    process.env.STRIPE_SECRET_KEY = "totally-not-a-stripe-key";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_123";
    process.env.AGENTVOUCH_STRIPE_CHECKOUT_ENABLED = "true";
    process.env.AGENTVOUCH_STRIPE_LIVE_MODE_ENABLED = "true";
    process.env.AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY = "true";

    expect(getStripeCheckoutActivation()).toMatchObject({
      enabled: false,
      keyMode: "unknown",
      keyModePermitted: false,
    });
  });

  it("does not require an acknowledgement for a test key outside production", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_123";
    process.env.AGENTVOUCH_STRIPE_CHECKOUT_ENABLED = "true";

    expect(getStripeCheckoutActivation()).toMatchObject({
      enabled: true,
      keyMode: "test",
      keyModePermitted: true,
    });
  });

  it("preserves the edge-rate-limit gate for test keys in production", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_123";
    process.env.AGENTVOUCH_STRIPE_CHECKOUT_ENABLED = "true";
    process.env.VERCEL_ENV = "production";

    expect(getStripeCheckoutActivation()).toMatchObject({
      enabled: false,
      keyMode: "test",
      production: true,
      productionEdgeRateLimitReady: false,
    });

    process.env.AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY = "true";
    expect(getStripeCheckoutActivation()).toMatchObject({
      enabled: true,
      productionEdgeRateLimitReady: true,
    });
  });

  it("fails live checkout closed until an explicit pilot scope is valid", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_123";
    process.env.AGENTVOUCH_STRIPE_CHECKOUT_ENABLED = "true";
    process.env.AGENTVOUCH_STRIPE_LIVE_MODE_ENABLED = "true";

    expect(getStripeCheckoutActivation()).toMatchObject({
      enabled: false,
      livePilotScopeReady: false,
    });
    expect(getStripeLivePilotScope()).toBeNull();

    process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_SKILL_IDS =
      "not-a-uuid,00000000-0000-4000-8000-000000000001";
    process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_UNIT_USD_CENTS = "500";
    expect(getStripeLivePilotScope()).toBeNull();

    process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_SKILL_IDS =
      "00000000-0000-4000-8000-000000000001,00000000-0000-4000-8000-000000000001";
    process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_BUYER_ACCOUNT_IDS =
      "00000000-0000-4000-8000-000000000002,00000000-0000-4000-8000-000000000002";
    process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_GROSS_USD_CENTS = "1000";
    process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_COMPLETED_PAYMENTS = "3";
    process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_CONCURRENT_RESERVATIONS = "1";
    process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_RESERVATION_TTL_MINUTES = "31";
    process.env.AGENTVOUCH_STRIPE_LIVE_PILOT_RECONCILIATION_SLA_MINUTES = "60";
    expect(getStripeLivePilotScope()).toEqual({
      skillIds: ["00000000-0000-4000-8000-000000000001"],
      buyerAccountIds: ["00000000-0000-4000-8000-000000000002"],
      maxUnitUsdCents: 500,
      maxGrossUsdCents: 1000,
      maxCompletedPayments: 3,
      maxConcurrentReservations: 1,
      reservationTtlMinutes: 31,
      reconciliationSlaMinutes: 60,
    });
    expect(getStripeCheckoutActivation()).toMatchObject({
      enabled: false,
      livePilotScopeReady: true,
      livePilotImplementationReady: false,
    });
  });

  it("rejects missing or malformed live buyer and aggregate cap scope", () => {
    const base = {
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
    };

    expect(
      getStripeLivePilotScope({
        ...base,
        AGENTVOUCH_STRIPE_LIVE_PILOT_BUYER_ACCOUNT_IDS: "email@example.com",
      })
    ).toBeNull();
    expect(
      getStripeLivePilotScope({
        ...base,
        AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_GROSS_USD_CENTS: "0",
      })
    ).toBeNull();
    expect(
      getStripeLivePilotScope({
        ...base,
        AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_COMPLETED_PAYMENTS: "1.5",
      })
    ).toBeNull();
    expect(
      getStripeLivePilotScope({
        ...base,
        AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_CONCURRENT_RESERVATIONS: "",
      })
    ).toBeNull();
    expect(
      getStripeLivePilotScope({
        ...base,
        AGENTVOUCH_STRIPE_LIVE_PILOT_RESERVATION_TTL_MINUTES: "30",
      })
    ).toBeNull();
    expect(
      getStripeLivePilotScope({
        ...base,
        AGENTVOUCH_STRIPE_LIVE_PILOT_RESERVATION_TTL_MINUTES: "1441",
      })
    ).toBeNull();
    expect(
      getStripeLivePilotScope({
        ...base,
        AGENTVOUCH_STRIPE_LIVE_PILOT_RESERVATION_TTL_MINUTES: "1440",
      })?.reservationTtlMinutes
    ).toBe(1440);
  });

  it("flags a livemode mismatch between the event and the configured key", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";

    expect(stripeEventModeMismatch({ livemode: true })).toEqual({
      keyMode: "test",
      eventMode: "live",
    });
    expect(stripeEventModeMismatch({ livemode: false })).toBeNull();

    process.env.STRIPE_SECRET_KEY = "sk_live_123";
    expect(stripeEventModeMismatch({ livemode: false })).toEqual({
      keyMode: "live",
      eventMode: "test",
    });
    expect(stripeEventModeMismatch({ livemode: true })).toBeNull();

    // No check is possible without both a known key mode and the field.
    expect(stripeEventModeMismatch({})).toBeNull();
    process.env.STRIPE_SECRET_KEY = "mystery";
    expect(stripeEventModeMismatch({ livemode: true })).toBeNull();
  });

  it("rounds USDC micros into Stripe USD cents", () => {
    expect(usdcMicrosToUsdCents(1_000_000n)).toBe(100);
    expect(usdcMicrosToUsdCents(10_000n)).toBe(1);
    expect(usdcMicrosToUsdCents(14_999n)).toBe(1);
    expect(usdcMicrosToUsdCents(15_000n)).toBe(2);
  });

  it("copies opaque account metadata onto the session and PaymentIntent", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ id: "cs_test_123", url: "https://checkout.test" }),
          { status: 200 }
        )
      );

    await createCheckoutSession({
      skillDbId: "00000000-0000-4000-8000-000000000001",
      skillName: "Paid Skill",
      buyer: {
        kind: "account",
        accountId: "00000000-0000-4000-8000-000000000002",
      },
      amountUsdcMicros: "1000000",
      amountUsdCents: 100,
      recourseDisclosureVersion: "2026-07-31",
      livePilotReservationId: "00000000-0000-4000-8000-000000000003",
      expiresAtUnixSeconds: 1_800_000_000,
      successUrl: "https://example.test/success",
      cancelUrl: "https://example.test/cancel",
    });

    const request = fetchSpy.mock.calls[0]?.[1];
    const params = new URLSearchParams(String(request?.body));
    expect(params.get("metadata[payment_flow]")).toBe("stripe-account-access");
    expect(params.get("metadata[buyer_account_id]")).toBe(
      "00000000-0000-4000-8000-000000000002"
    );
    expect(params.get("payment_intent_data[metadata][buyer_account_id]")).toBe(
      "00000000-0000-4000-8000-000000000002"
    );
    expect(params.get("metadata[recourse_disclosure_version]")).toBe(
      "2026-07-31"
    );
    expect(params.get("metadata[live_pilot_reservation_id]")).toBe(
      "00000000-0000-4000-8000-000000000003"
    );
    expect(
      params.get("payment_intent_data[metadata][live_pilot_reservation_id]")
    ).toBe("00000000-0000-4000-8000-000000000003");
    expect(params.get("expires_at")).toBe("1800000000");
    expect(
      (request?.headers as Record<string, string>)["Idempotency-Key"]
    ).toBe("00000000-0000-4000-8000-000000000003");
    expect(params.has("metadata[buyer_pubkey]")).toBe(false);
    fetchSpy.mockRestore();
  });

  it("accepts any valid v1 webhook signature in the Stripe header", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_123";

    const rawBody = JSON.stringify({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_1" } },
    });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const validSignature = createHmac("sha256", "whsec_123")
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");

    const event = verifyAndParseWebhook(
      rawBody,
      `t=${timestamp},v1=bad-signature,v1=${validSignature}`
    );

    expect(event.id).toBe("evt_1");
  });
});
