// Tier 1 Stripe MPP-style payments — PROTOTYPE. See docs/STRIPE_FEASIBILITY.md.
//
// Deliberately implemented against the Stripe REST API with `fetch` plus
// `node:crypto` for webhook signature verification, so this adds NO new npm
// dependency and leaves the lockfile and build untouched. A production
// implementation should weigh adopting the official `stripe` SDK.
//
// Scope: this only ever mints an OFF-CHAIN entitlement. It does not convert
// fiat to USDC, does not settle on-chain, and does not fund author proceeds
// or voucher rewards. Those are the Tier 2/3 hard parts and are out of scope.

import { createHmac, timingSafeEqual } from "node:crypto";

export const STRIPE_PAYMENT_FLOW = "stripe-mpp-offchain";
export const STRIPE_ACCOUNT_PAYMENT_FLOW = "stripe-account-access";

// Sentinels stored in chain-shaped receipt columns (see Obstacle 2 in the
// feasibility note). These are placeholders, not real on-chain references.
export const STRIPE_RECIPIENT_SENTINEL = "stripe-offchain";
export const STRIPE_CURRENCY_SENTINEL = "USD";

type StripeConfig = {
  secretKey: string;
  webhookSecret: string | null;
  apiBase: string;
};

export function getStripeConfig(): StripeConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) return null;
  return {
    secretKey,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() || null,
    apiBase: (
      process.env.STRIPE_API_BASE?.trim() || "https://api.stripe.com"
    ).replace(/\/+$/, ""),
  };
}

export function isStripeEnabled(): boolean {
  const config = getStripeConfig();
  return Boolean(config?.secretKey && config.webhookSecret);
}

export type StripeKeyMode = "test" | "live" | "unknown";

/**
 * Stripe secret (`sk_`) and restricted (`rk_`) keys carry their mode in the
 * prefix. Anything we cannot positively identify is `unknown` and is treated as
 * not-permitted, so a malformed, truncated, or unexpected credential can never
 * silently activate commerce.
 *
 * This is the code-level half of the test-mode constraint that
 * `docs/STRIPE_TEST_MODE_ROLLOUT.md` previously stated only as a written
 * precondition.
 */
export function detectStripeKeyMode(
  secretKey: string | undefined | null
): StripeKeyMode {
  const key = secretKey?.trim() ?? "";
  if (/^(?:sk|rk)_test_/.test(key)) return "test";
  if (/^(?:sk|rk)_live_/.test(key)) return "live";
  return "unknown";
}

export type StripeCheckoutActivation = {
  enabled: boolean;
  stripeConfigured: boolean;
  serverFlagEnabled: boolean;
  productionEdgeRateLimitReady: boolean;
  production: boolean;
  keyMode: StripeKeyMode;
  liveModeAcknowledged: boolean;
  keyModePermitted: boolean;
};

/**
 * Checkout session creation is a separate activation boundary from webhook
 * processing. Webhooks must remain live after checkout is disabled so delayed
 * payments, refunds, disputes, and retries can still converge.
 */
export function getStripeCheckoutActivation(
  env: Readonly<Record<string, string | undefined>> = process.env
): StripeCheckoutActivation {
  const stripeConfigured = Boolean(
    env.STRIPE_SECRET_KEY?.trim() && env.STRIPE_WEBHOOK_SECRET?.trim()
  );
  const serverFlagEnabled = env.AGENTVOUCH_STRIPE_CHECKOUT_ENABLED === "true";
  const production = env.VERCEL_ENV === "production";
  const productionEdgeRateLimitReady =
    !production || env.AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY === "true";

  // A live key must be acknowledged explicitly, in every environment. The
  // edge-rate-limit acknowledgement above only applies when VERCEL_ENV is
  // "production", so without this a live key on a preview deployment would
  // start real commerce with no further gate.
  const keyMode = detectStripeKeyMode(env.STRIPE_SECRET_KEY);
  const liveModeAcknowledged =
    env.AGENTVOUCH_STRIPE_LIVE_MODE_ENABLED === "true";
  const keyModePermitted =
    keyMode === "test" || (keyMode === "live" && liveModeAcknowledged);

  return {
    enabled:
      stripeConfigured &&
      serverFlagEnabled &&
      productionEdgeRateLimitReady &&
      keyModePermitted,
    stripeConfigured,
    serverFlagEnabled,
    productionEdgeRateLimitReady,
    production,
    keyMode,
    liveModeAcknowledged,
    keyModePermitted,
  };
}

export function isStripeCheckoutServerEnabled(): boolean {
  return getStripeCheckoutActivation().enabled;
}

// The render-affecting UI flag lives in `@/lib/stripeUi` so rendering code does
// not import this module's `node:crypto` dependency or server-only env reads.

// Stripe charges integer minor units (cents). We treat one USDC micro-unit as
// 1e-6 USD (1 USDC ~= 1 USD), so cents = round(micros / 10_000).
// This 1:1 assumption is flagged in the feasibility note and is a real
// product/treasury decision before Tier 2.
export function usdcMicrosToUsdCents(micros: bigint): number {
  if (micros < 0n) throw new Error("amount must be non-negative");
  // round to nearest cent
  return Number((micros + 5000n) / 10000n);
}

// Stripe rejects one-time USD payments below $0.50; sub-cent prices would even
// round to a 0-amount session. Checkout must refuse prices below this floor.
export const STRIPE_MIN_CHARGE_USD_CENTS = 50;

export type CreateCheckoutSessionInput = {
  skillDbId: string;
  skillName: string;
  amountUsdcMicros: string;
  amountUsdCents: number;
  successUrl: string;
  cancelUrl: string;
  buyer:
    | { kind: "wallet"; pubkey: string }
    | { kind: "account"; accountId: string };
  // Optional: a buyer-supplied email so Stripe can create/attach a customer.
  customerEmail?: string;
};

export type CheckoutSession = {
  id: string;
  url: string | null;
};

// Creates a Stripe Checkout Session for a one-time payment. The skill DB id is
// stashed in client_reference_id + metadata so the webhook can resolve it.
export async function createCheckoutSession(
  input: CreateCheckoutSessionInput
): Promise<CheckoutSession> {
  const config = getStripeConfig();
  if (!config) throw new Error("Stripe is not configured");

  const paymentFlow =
    input.buyer.kind === "account"
      ? STRIPE_ACCOUNT_PAYMENT_FLOW
      : STRIPE_PAYMENT_FLOW;
  const metadata: Record<string, string> = {
    skill_db_id: input.skillDbId,
    price_usdc_micros: input.amountUsdcMicros,
    payment_flow: paymentFlow,
    ...(input.buyer.kind === "account"
      ? { buyer_account_id: input.buyer.accountId }
      : { buyer_pubkey: input.buyer.pubkey }),
  };

  const params: Record<string, string> = {
    mode: "payment",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.skillDbId,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(input.amountUsdCents),
    "line_items[0][price_data][product_data][name]": input.skillName,
  };
  for (const [key, value] of Object.entries(metadata)) {
    params[`metadata[${key}]`] = value;
    // Charge refund/dispute events do not carry Checkout Session metadata.
    // Copy the opaque identifiers onto the PaymentIntent so terminal events
    // can revoke (or tombstone) the exact account grant before completion.
    params[`payment_intent_data[metadata][${key}]`] = value;
  }
  if (input.customerEmail) {
    params["customer_email"] = input.customerEmail;
  }

  const res = await fetch(`${config.apiBase}/v1/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Stripe checkout session creation failed (${res.status}): ${detail}`
    );
  }

  const json = (await res.json()) as { id: string; url?: string | null };
  return { id: json.id, url: json.url ?? null };
}

export type StripeWebhookEvent = {
  id: string;
  type: string;
  livemode?: boolean;
  data: { object: Record<string, unknown> };
};

/**
 * Cross-checks an event's `livemode` against the configured key's mode.
 *
 * A mismatch means the deployment is wired to one Stripe mode and receiving
 * events from the other — a live event reaching a test-configured endpoint, or
 * a webhook pointed at the wrong environment. Either way the event must not
 * mint or revoke entitlements here.
 *
 * Returns null when no *comparison* is possible: an unknown key prefix, or an
 * event without the field. Null is therefore "no mismatch detected", not "safe
 * to grant" — the caller is responsible for handling an unknown key mode. The
 * webhook does that separately, refusing to grant while still allowing
 * revocations through (refusing those would be fail-open).
 */
export function stripeEventModeMismatch(
  event: Pick<StripeWebhookEvent, "livemode">,
  env: Readonly<Record<string, string | undefined>> = process.env
): { keyMode: StripeKeyMode; eventMode: "test" | "live" } | null {
  if (typeof event.livemode !== "boolean") return null;
  const keyMode = detectStripeKeyMode(env.STRIPE_SECRET_KEY);
  if (keyMode === "unknown") return null;
  const eventMode = event.livemode ? "live" : "test";
  return keyMode === eventMode ? null : { keyMode, eventMode };
}

// Verifies a Stripe webhook signature (the `Stripe-Signature` header) using
// the documented scheme: HMAC-SHA256 over `${t}.${rawBody}` compared against
// the `v1` signature(s), within a tolerance window. Returns the parsed event
// or throws.
export function verifyAndParseWebhook(
  rawBody: string,
  signatureHeader: string | null,
  toleranceSeconds = 300
): StripeWebhookEvent {
  const config = getStripeConfig();
  if (!config?.webhookSecret) {
    throw new Error("Stripe webhook secret is not configured");
  }
  if (!signatureHeader) {
    throw new Error("Missing Stripe-Signature header");
  }

  const parts = signatureHeader.split(",").reduce(
    (acc, kv) => {
      const idx = kv.indexOf("=");
      const key = kv.slice(0, idx).trim();
      const value = kv.slice(idx + 1).trim();
      if (!key || idx < 0) return acc;
      if (key === "v1") {
        acc.v1.push(value);
      } else {
        acc[key] = value;
      }
      return acc;
    },
    { v1: [] as string[] } as Record<string, string> & { v1: string[] }
  );

  const timestamp = parts["t"];
  const provided = parts.v1;
  if (!timestamp || provided.length === 0) {
    throw new Error("Malformed Stripe-Signature header");
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > toleranceSeconds) {
    throw new Error("Stripe webhook timestamp outside tolerance");
  }

  const expected = createHmac("sha256", config.webhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const matches = provided.some((signature) => {
    const b = Buffer.from(signature, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  });
  if (!matches) {
    throw new Error("Stripe webhook signature mismatch");
  }

  return JSON.parse(rawBody) as StripeWebhookEvent;
}
