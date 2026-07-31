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

    const ready = buildStripePreviewPreflight({
      DATABASE_URL: "postgres://configured",
      STRIPE_SECRET_KEY: "sk_live_secret",
      STRIPE_WEBHOOK_SECRET: "whsec_secret",
      AGENTVOUCH_STRIPE_CHECKOUT_ENABLED: "true",
      NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED: "true",
      AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY: "true",
      AGENTVOUCH_STRIPE_LIVE_MODE_ENABLED: "true",
      VERCEL_ENV: "production",
    });
    expect(ready.checkoutEnabled).toBe(true);
    expect(ready.blockers).toEqual([]);
    expect(JSON.stringify(ready)).not.toContain("sk_live_secret");
  });
});
