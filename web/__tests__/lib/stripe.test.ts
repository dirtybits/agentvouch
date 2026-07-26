import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  detectStripeKeyMode,
  getStripeCheckoutActivation,
  createCheckoutSession,
  isStripeCheckoutUiEnabled,
  isStripeEnabled,
  stripeEventModeMismatch,
  verifyAndParseWebhook,
  usdcMicrosToUsdCents,
} from "@/lib/stripe";

describe("stripe helpers", () => {
  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_API_BASE;
    delete process.env.NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED;
    delete process.env.AGENTVOUCH_STRIPE_CHECKOUT_ENABLED;
    delete process.env.AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY;
    delete process.env.AGENTVOUCH_STRIPE_LIVE_MODE_ENABLED;
    delete process.env.VERCEL_ENV;
  });

  it("uses a public flag for render-affecting checkout UI", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_123";
    expect(isStripeCheckoutUiEnabled()).toBe(false);

    process.env.NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED = "true";
    expect(isStripeCheckoutUiEnabled()).toBe(true);
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

  it("requires an edge-rate-limit acknowledgement in production", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_123";
    process.env.AGENTVOUCH_STRIPE_CHECKOUT_ENABLED = "true";
    process.env.AGENTVOUCH_STRIPE_LIVE_MODE_ENABLED = "true";
    process.env.VERCEL_ENV = "production";

    expect(getStripeCheckoutActivation().enabled).toBe(false);

    process.env.AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY = "true";
    expect(getStripeCheckoutActivation().enabled).toBe(true);
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

  it("refuses a live key until live mode is explicitly acknowledged", () => {
    // Preview deployments never hit the production edge-rate-limit gate, so
    // this acknowledgement is the only thing standing between a live key and
    // real card payments.
    process.env.STRIPE_SECRET_KEY = "sk_live_123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_123";
    process.env.AGENTVOUCH_STRIPE_CHECKOUT_ENABLED = "true";
    process.env.VERCEL_ENV = "preview";

    expect(getStripeCheckoutActivation()).toMatchObject({
      enabled: false,
      keyMode: "live",
      liveModeAcknowledged: false,
      keyModePermitted: false,
      productionEdgeRateLimitReady: true,
    });

    process.env.AGENTVOUCH_STRIPE_LIVE_MODE_ENABLED = "true";
    expect(getStripeCheckoutActivation()).toMatchObject({
      enabled: true,
      keyMode: "live",
      keyModePermitted: true,
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

  it("does not require an acknowledgement for a test key", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_123";
    process.env.AGENTVOUCH_STRIPE_CHECKOUT_ENABLED = "true";

    expect(getStripeCheckoutActivation()).toMatchObject({
      enabled: true,
      keyMode: "test",
      keyModePermitted: true,
    });
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
