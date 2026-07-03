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
  buyerPubkey: string;
  amountUsdcMicros: string;
  amountUsdCents: number;
  successUrl: string;
  cancelUrl: string;
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

  const params: Record<string, string> = {
    mode: "payment",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.skillDbId,
    "metadata[skill_db_id]": input.skillDbId,
    "metadata[buyer_pubkey]": input.buyerPubkey,
    "metadata[price_usdc_micros]": input.amountUsdcMicros,
    "metadata[payment_flow]": STRIPE_PAYMENT_FLOW,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(input.amountUsdCents),
    "line_items[0][price_data][product_data][name]": input.skillName,
  };
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
  data: { object: Record<string, unknown> };
};

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
