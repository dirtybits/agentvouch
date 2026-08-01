// Tier 1 Stripe MPP-style payments — test-mode implementation; live disabled.
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

// Source-controlled stop gate. The durable code controls exist, but live
// checkout stays impossible until founder decisions, schema rehearsal, WAF,
// monitoring and the other external gates are recorded and reviewed. This is
// intentionally not an environment variable: deployment configuration cannot
// substitute for activation approval.
export const STRIPE_LIVE_PILOT_IMPLEMENTATION_READY = false;

export function isStripeLivePilotFulfillmentSourceEnabled(): boolean {
  return STRIPE_LIVE_PILOT_IMPLEMENTATION_READY;
}

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

const STRIPE_LIVE_PILOT_SKILL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StripeLivePilotScope = {
  skillIds: string[];
  buyerAccountIds: string[];
  maxUnitUsdCents: number;
  maxGrossUsdCents: number;
  maxCompletedPayments: number;
  maxConcurrentReservations: number;
  reservationTtlMinutes: number;
  reconciliationSlaMinutes: number;
};

function parsePositiveSafeInteger(value: string | undefined): number | null {
  const raw = value?.trim() ?? "";
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

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

/**
 * A live key is limited to an explicit set of skill UUIDs and a maximum
 * per-session charge. Missing, malformed, or empty values return null so live
 * checkout fails closed. Test-mode checkout deliberately ignores this scope.
 *
 * The returned values are enforced again by the durable live-pilot ledger.
 */
export function getStripeLivePilotScope(
  env: Readonly<Record<string, string | undefined>> = process.env
): StripeLivePilotScope | null {
  const rawSkillIds = env.AGENTVOUCH_STRIPE_LIVE_PILOT_SKILL_IDS ?? "";
  const skillIds = rawSkillIds
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (
    skillIds.length === 0 ||
    skillIds.some((value) => !STRIPE_LIVE_PILOT_SKILL_ID_PATTERN.test(value))
  ) {
    return null;
  }

  const buyerAccountIds = (
    env.AGENTVOUCH_STRIPE_LIVE_PILOT_BUYER_ACCOUNT_IDS ?? ""
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (
    buyerAccountIds.length === 0 ||
    buyerAccountIds.some(
      (value) => !STRIPE_LIVE_PILOT_SKILL_ID_PATTERN.test(value)
    )
  ) {
    return null;
  }

  const maxUnitUsdCents = parsePositiveSafeInteger(
    env.AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_UNIT_USD_CENTS
  );
  const maxGrossUsdCents = parsePositiveSafeInteger(
    env.AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_GROSS_USD_CENTS
  );
  const maxCompletedPayments = parsePositiveSafeInteger(
    env.AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_COMPLETED_PAYMENTS
  );
  const maxConcurrentReservations = parsePositiveSafeInteger(
    env.AGENTVOUCH_STRIPE_LIVE_PILOT_MAX_CONCURRENT_RESERVATIONS
  );
  const reservationTtlMinutes = parsePositiveSafeInteger(
    env.AGENTVOUCH_STRIPE_LIVE_PILOT_RESERVATION_TTL_MINUTES
  );
  const reconciliationSlaMinutes = parsePositiveSafeInteger(
    env.AGENTVOUCH_STRIPE_LIVE_PILOT_RECONCILIATION_SLA_MINUTES
  );
  if (
    maxUnitUsdCents === null ||
    maxGrossUsdCents === null ||
    maxCompletedPayments === null ||
    maxConcurrentReservations === null ||
    reservationTtlMinutes === null ||
    reservationTtlMinutes < 31 ||
    reservationTtlMinutes > 1_440 ||
    reconciliationSlaMinutes === null
  ) {
    return null;
  }

  return {
    skillIds: [...new Set(skillIds)],
    buyerAccountIds: [...new Set(buyerAccountIds)],
    maxUnitUsdCents,
    maxGrossUsdCents,
    maxCompletedPayments,
    maxConcurrentReservations,
    reservationTtlMinutes,
    reconciliationSlaMinutes,
  };
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
  livePilotScopeReady: boolean;
  livePilotImplementationReady: boolean;
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
  const keyMode = detectStripeKeyMode(env.STRIPE_SECRET_KEY);
  const production = env.VERCEL_ENV === "production";
  // Preserve the production deployment gate for test-mode rehearsals and also
  // require the external WAF acknowledgement for any live key, including on a
  // public preview where VERCEL_ENV is not "production".
  const edgeRateLimitRequired = production || keyMode === "live";
  const productionEdgeRateLimitReady =
    !edgeRateLimitRequired ||
    env.AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY === "true";

  // A live key must be acknowledged explicitly in every environment.
  const liveModeAcknowledged =
    env.AGENTVOUCH_STRIPE_LIVE_MODE_ENABLED === "true";
  const keyModePermitted =
    keyMode === "test" || (keyMode === "live" && liveModeAcknowledged);
  const livePilotScopeReady =
    keyMode !== "live" || getStripeLivePilotScope(env) !== null;
  const livePilotImplementationReady =
    keyMode !== "live" || STRIPE_LIVE_PILOT_IMPLEMENTATION_READY;

  return {
    enabled:
      stripeConfigured &&
      serverFlagEnabled &&
      productionEdgeRateLimitReady &&
      keyModePermitted &&
      livePilotScopeReady &&
      livePilotImplementationReady,
    stripeConfigured,
    serverFlagEnabled,
    productionEdgeRateLimitReady,
    production,
    keyMode,
    liveModeAcknowledged,
    keyModePermitted,
    livePilotScopeReady,
    livePilotImplementationReady,
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
  recourseDisclosureVersion: string;
  successUrl: string;
  cancelUrl: string;
  buyer:
    | { kind: "wallet"; pubkey: string }
    | { kind: "account"; accountId: string };
  // Optional: a buyer-supplied email so Stripe can create/attach a customer.
  customerEmail?: string;
  livePilotReservationId?: string;
  expiresAtUnixSeconds?: number;
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
    recourse_disclosure_version: input.recourseDisclosureVersion,
    ...(input.buyer.kind === "account"
      ? { buyer_account_id: input.buyer.accountId }
      : { buyer_pubkey: input.buyer.pubkey }),
    ...(input.livePilotReservationId
      ? { live_pilot_reservation_id: input.livePilotReservationId }
      : {}),
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
  if (input.expiresAtUnixSeconds) {
    params["expires_at"] = String(input.expiresAtUnixSeconds);
  }

  const res = await fetch(`${config.apiBase}/v1/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(input.livePilotReservationId
        ? { "Idempotency-Key": input.livePilotReservationId }
        : {}),
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

/** Best-effort fail-safe for a Session created across the Stripe/DB boundary. */
export async function expireCheckoutSession(sessionId: string): Promise<void> {
  const config = getStripeConfig();
  if (!config) throw new Error("Stripe is not configured");
  const res = await fetch(
    `${config.apiBase}/v1/checkout/sessions/${encodeURIComponent(
      sessionId
    )}/expire`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${config.secretKey}` },
    }
  );
  if (!res.ok) {
    throw new Error(
      `Stripe Checkout Session expiration failed (${res.status}): ${await res
        .text()
        .catch(() => "")}`
    );
  }
}

export type StripePaymentFinancials = {
  grossUsdCents: number;
  feeUsdCents: number;
  netUsdCents: number;
};

/**
 * Reads Stripe's authoritative balance transaction for reconciliation. Buyer
 * access never depends on this secondary lookup; a missing value remains an
 * operator alert until Stripe makes it available or reconciliation succeeds.
 */
export async function getStripePaymentFinancials(
  paymentIntentId: string
): Promise<StripePaymentFinancials | null> {
  const config = getStripeConfig();
  if (!config) throw new Error("Stripe is not configured");
  const params = new URLSearchParams({
    "expand[]": "latest_charge.balance_transaction",
  });
  const res = await fetch(
    `${config.apiBase}/v1/payment_intents/${encodeURIComponent(
      paymentIntentId
    )}?${params.toString()}`,
    { headers: { Authorization: `Bearer ${config.secretKey}` } }
  );
  if (!res.ok) {
    throw new Error(
      `Stripe payment reconciliation failed (${res.status}): ${await res
        .text()
        .catch(() => "")}`
    );
  }
  const paymentIntent = (await res.json()) as {
    amount?: number;
    latest_charge?: {
      balance_transaction?: { amount?: number; fee?: number; net?: number };
    } | null;
  };
  const balance = paymentIntent.latest_charge?.balance_transaction;
  if (
    !Number.isSafeInteger(paymentIntent.amount) ||
    !Number.isSafeInteger(balance?.amount) ||
    !Number.isSafeInteger(balance?.fee) ||
    !Number.isSafeInteger(balance?.net)
  ) {
    return null;
  }
  return {
    grossUsdCents: balance!.amount!,
    feeUsdCents: balance!.fee!,
    netUsdCents: balance!.net!,
  };
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
 * a webhook pointed at the wrong environment. The webhook must not grant
 * entitlements under that wiring, but processes refunds/disputes before this
 * comparison because terminally acknowledging a revocation would fail open.
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
