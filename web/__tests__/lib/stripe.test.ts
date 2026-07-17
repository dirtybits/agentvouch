import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getStripeCheckoutActivation,
  isStripeCheckoutUiEnabled,
  isStripeEnabled,
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
    process.env.VERCEL_ENV = "production";

    expect(getStripeCheckoutActivation().enabled).toBe(false);

    process.env.AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY = "true";
    expect(getStripeCheckoutActivation().enabled).toBe(true);
  });

  it("rounds USDC micros into Stripe USD cents", () => {
    expect(usdcMicrosToUsdCents(1_000_000n)).toBe(100);
    expect(usdcMicrosToUsdCents(10_000n)).toBe(1);
    expect(usdcMicrosToUsdCents(14_999n)).toBe(1);
    expect(usdcMicrosToUsdCents(15_000n)).toBe(2);
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
