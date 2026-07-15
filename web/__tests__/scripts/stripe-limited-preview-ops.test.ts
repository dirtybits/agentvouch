import { describe, expect, it } from "vitest";
import {
  buildStripePreviewPreflight,
  parseStripeOpsMode,
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

    const ready = buildStripePreviewPreflight({
      DATABASE_URL: "postgres://configured",
      STRIPE_SECRET_KEY: "sk_live_secret",
      STRIPE_WEBHOOK_SECRET: "whsec_secret",
      AGENTVOUCH_STRIPE_CHECKOUT_ENABLED: "true",
      NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED: "true",
      AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY: "true",
      VERCEL_ENV: "production",
    });
    expect(ready.checkoutEnabled).toBe(true);
    expect(ready.blockers).toEqual([]);
  });
});
