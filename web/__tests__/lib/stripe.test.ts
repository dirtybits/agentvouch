import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import {
  isStripeEnabled,
  verifyAndParseWebhook,
  usdcMicrosToUsdCents,
} from "@/lib/stripe";

describe("stripe helpers", () => {
  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_API_BASE;
  });

  it("requires both API and webhook secrets before checkout is enabled", () => {
    expect(isStripeEnabled()).toBe(false);

    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    expect(isStripeEnabled()).toBe(false);

    process.env.STRIPE_WEBHOOK_SECRET = "whsec_123";
    expect(isStripeEnabled()).toBe(true);
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
