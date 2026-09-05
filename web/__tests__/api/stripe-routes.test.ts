import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(),
  expireCheckoutSession: vi.fn(),
  getStripeCheckoutActivation: vi.fn(),
  getStripeLivePilotScope: vi.fn(),
  detectStripeKeyMode: vi.fn(),
  isStripeEnabled: vi.fn(),
  stripeEventModeMismatch: vi.fn(),
  verifyAndParseWebhook: vi.fn(),
  verifyWalletSignature: vi.fn(),
  hasUsdcPurchaseEntitlement: vi.fn(),
  hasOnChainPurchase: vi.fn(),
  recordRevocableUsdcPurchaseReceipt: vi.fn(),
  recordAndApplyUsdcPaymentRevocation: vi.fn(),
  getUsdcPurchaseEntitlementStatus: vi.fn(),
  hasUsdcPurchaseReceiptForPaymentRef: vi.fn(),
  checkRateLimit: vi.fn(),
  recordStripeWebhookOutcome: vi.fn(),
  isBuyerCardAccessServerEnabled: vi.fn(),
  getBuyerSession: vi.fn(),
  isSameOriginMutation: vi.fn(),
  hasActiveMarketplaceAccessGrant: vi.fn(),
  recordStripeMarketplaceAccessGrant: vi.fn(),
  recordStripeMarketplacePaymentTerminalState: vi.fn(),
  reserveStripeLivePilotCheckout: vi.fn(),
  attachStripeLivePilotCheckoutSession: vi.fn(),
  closeStripeLivePilotReservationAfterApiFailure: vi.fn(),
  recordStripeLivePilotPaymentCompleted: vi.fn(),
  markStripeLivePilotFulfilled: vi.fn(),
  markStripeLivePilotReview: vi.fn(),
  expireStripeLivePilotReservation: vi.fn(),
  recordStripeLivePilotTerminalState: vi.fn(),
  reconcileStripeLivePilotFinancials: vi.fn(),
  getStripePaymentFinancials: vi.fn(),
  isStripeLivePilotFulfillmentSourceEnabled: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
  sql: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  STRIPE_ACCOUNT_PAYMENT_FLOW: "stripe-account-access",
  STRIPE_CURRENCY_SENTINEL: "USD",
  STRIPE_PAYMENT_FLOW: "stripe-mpp-offchain",
  STRIPE_RECIPIENT_SENTINEL: "stripe-offchain",
  STRIPE_MIN_CHARGE_USD_CENTS: 50,
  STRIPE_LIVE_PILOT_IMPLEMENTATION_READY: false,
  createCheckoutSession: (...args: unknown[]) =>
    mocks.createCheckoutSession(...args),
  expireCheckoutSession: (...args: unknown[]) =>
    mocks.expireCheckoutSession(...args),
  detectStripeKeyMode: (...args: unknown[]) =>
    mocks.detectStripeKeyMode(...args),
  getStripeCheckoutActivation: () => mocks.getStripeCheckoutActivation(),
  getStripeLivePilotScope: () => mocks.getStripeLivePilotScope(),
  getStripePaymentFinancials: (...args: unknown[]) =>
    mocks.getStripePaymentFinancials(...args),
  isStripeEnabled: () => mocks.isStripeEnabled(),
  isStripeLivePilotFulfillmentSourceEnabled: () =>
    mocks.isStripeLivePilotFulfillmentSourceEnabled(),
  stripeEventModeMismatch: (...args: unknown[]) =>
    mocks.stripeEventModeMismatch(...args),
  usdcMicrosToUsdCents: (micros: bigint) => Number((micros + 5000n) / 10000n),
  verifyAndParseWebhook: (...args: unknown[]) =>
    mocks.verifyAndParseWebhook(...args),
}));

vi.mock("@/lib/buyerAuthConfig", () => ({
  isBuyerCardAccessServerEnabled: () => mocks.isBuyerCardAccessServerEnabled(),
}));

vi.mock("@/lib/buyerSession", () => ({
  getBuyerSession: (...args: unknown[]) => mocks.getBuyerSession(...args),
  isSameOriginMutation: (...args: unknown[]) =>
    mocks.isSameOriginMutation(...args),
}));

vi.mock("@/lib/buyerAccessGrants", () => ({
  hasActiveMarketplaceAccessGrant: (...args: unknown[]) =>
    mocks.hasActiveMarketplaceAccessGrant(...args),
  recordStripeMarketplaceAccessGrant: (...args: unknown[]) =>
    mocks.recordStripeMarketplaceAccessGrant(...args),
  recordStripeMarketplacePaymentTerminalState: (...args: unknown[]) =>
    mocks.recordStripeMarketplacePaymentTerminalState(...args),
}));

vi.mock("@/lib/stripeLivePilot", () => ({
  StripeLivePilotCapError: class StripeLivePilotCapError extends Error {
    reason = "gross-cap";
  },
  reserveStripeLivePilotCheckout: (...args: unknown[]) =>
    mocks.reserveStripeLivePilotCheckout(...args),
  attachStripeLivePilotCheckoutSession: (...args: unknown[]) =>
    mocks.attachStripeLivePilotCheckoutSession(...args),
  closeStripeLivePilotReservationAfterApiFailure: (...args: unknown[]) =>
    mocks.closeStripeLivePilotReservationAfterApiFailure(...args),
  recordStripeLivePilotPaymentCompleted: (...args: unknown[]) =>
    mocks.recordStripeLivePilotPaymentCompleted(...args),
  markStripeLivePilotFulfilled: (...args: unknown[]) =>
    mocks.markStripeLivePilotFulfilled(...args),
  markStripeLivePilotReview: (...args: unknown[]) =>
    mocks.markStripeLivePilotReview(...args),
  expireStripeLivePilotReservation: (...args: unknown[]) =>
    mocks.expireStripeLivePilotReservation(...args),
  recordStripeLivePilotTerminalState: (...args: unknown[]) =>
    mocks.recordStripeLivePilotTerminalState(...args),
  reconcileStripeLivePilotFinancials: (...args: unknown[]) =>
    mocks.reconcileStripeLivePilotFinancials(...args),
}));

vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: (...args: unknown[]) => mocks.checkRateLimit(...args),
  clientIpFromRequest: () => "127.0.0.1",
}));

vi.mock("@/lib/stripeReconciliation", () => ({
  recordStripeWebhookOutcome: (...args: unknown[]) =>
    mocks.recordStripeWebhookOutcome(...args),
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    verifyWalletSignature: (...args: unknown[]) =>
      mocks.verifyWalletSignature(...args),
  };
});

vi.mock("@/lib/usdcPurchases", () => ({
  hasUsdcPurchaseEntitlement: (...args: unknown[]) =>
    mocks.hasUsdcPurchaseEntitlement(...args),
  recordRevocableUsdcPurchaseReceipt: (...args: unknown[]) =>
    mocks.recordRevocableUsdcPurchaseReceipt(...args),
  recordAndApplyUsdcPaymentRevocation: (...args: unknown[]) =>
    mocks.recordAndApplyUsdcPaymentRevocation(...args),
  getUsdcPurchaseEntitlementStatus: (...args: unknown[]) =>
    mocks.getUsdcPurchaseEntitlementStatus(...args),
  hasUsdcPurchaseReceiptForPaymentRef: (...args: unknown[]) =>
    mocks.hasUsdcPurchaseReceiptForPaymentRef(...args),
}));

vi.mock("@/lib/x402", () => ({
  hasOnChainPurchase: (...args: unknown[]) => mocks.hasOnChainPurchase(...args),
}));

import { POST as checkoutPOST } from "@/app/api/stripe/checkout/route";
import { POST as webhookPOST } from "@/app/api/stripe/webhook/route";
import { initializeDatabase, sql } from "@/lib/db";
import { buildStripeCheckoutMessage } from "@/lib/auth";
import { CARD_CHECKOUT_RECOURSE_DISCLOSURE_VERSION } from "@/lib/stripePolicyCopy";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;

const skillId = "00000000-0000-4000-8000-000000000001";
const buyerPubkey = "Buyer111111111111111111111111111111111111111";
const buyerAccountId = "00000000-0000-4000-8000-000000000002";

function jsonRequest(url: string, body: unknown, headers?: HeadersInit) {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
  });
}

function checkoutRequest(body: Record<string, unknown>, headers?: HeadersInit) {
  return jsonRequest(
    "http://localhost/api/stripe/checkout",
    {
      cardDisclosureVersion: CARD_CHECKOUT_RECOURSE_DISCLOSURE_VERSION,
      ...body,
    },
    headers
  );
}

function webhookRequest(body: unknown) {
  return jsonRequest("http://localhost/api/stripe/webhook", body, {
    "stripe-signature": "t=1,v1=sig",
  });
}

function signedCheckoutAuth(priceMicros = "1000000") {
  const timestamp = 1709234567890;
  return {
    pubkey: buyerPubkey,
    signature: "sig",
    message: buildStripeCheckoutMessage(skillId, priceMicros, timestamp),
    timestamp,
  };
}

function mockSkillRow(
  overrides: Partial<{
    price_usdc_micros: string | null;
    on_chain_address: string | null;
    evm_listing_id: string | null;
  }> = {}
) {
  mockSql.mockReturnValue(
    vi.fn().mockResolvedValue([
      {
        id: skillId,
        name: "Paid Skill",
        price_usdc_micros: "1000000",
        on_chain_address: null,
        evm_listing_id: null,
        ...overrides,
      },
    ])
  );
}

function paidSessionEvent(
  overrides: Partial<{
    amount_total: number;
    payment_intent: string | null;
    metadata: Record<string, string>;
  }> = {}
) {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: "cs_test_123",
        client_reference_id: skillId,
        payment_intent:
          overrides.payment_intent === undefined
            ? "pi_test_123"
            : overrides.payment_intent,
        amount_total: overrides.amount_total ?? 100,
        currency: "usd",
        mode: "payment",
        payment_status: "paid",
        metadata: {
          skill_db_id: skillId,
          buyer_pubkey: buyerPubkey,
          price_usdc_micros: "1000000",
          payment_flow: "stripe-mpp-offchain",
          recourse_disclosure_version:
            CARD_CHECKOUT_RECOURSE_DISCLOSURE_VERSION,
          ...(overrides.metadata ?? {}),
        },
      },
    },
  };
}

function paidAccountSessionEvent() {
  const event = paidSessionEvent({
    metadata: {
      buyer_account_id: buyerAccountId,
      payment_flow: "stripe-account-access",
    },
  });
  delete (event.data.object.metadata as Record<string, string>).buyer_pubkey;
  return event;
}

function livePaidAccountSessionEvent() {
  const event = { ...paidAccountSessionEvent(), livemode: true };
  (event.data.object.metadata as Record<string, string>)[
    "live_pilot_reservation_id"
  ] = "00000000-0000-4000-8000-000000000003";
  return event;
}

describe("Stripe checkout and webhook routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStripeCheckoutActivation.mockReturnValue({
      enabled: true,
      stripeConfigured: true,
      serverFlagEnabled: true,
      productionEdgeRateLimitReady: true,
      production: false,
      keyMode: "test",
      liveModeAcknowledged: false,
      keyModePermitted: true,
      livePilotScopeReady: true,
      livePilotImplementationReady: true,
    });
    mocks.getStripeLivePilotScope.mockReturnValue({
      skillIds: [skillId],
      buyerAccountIds: [buyerAccountId],
      maxUnitUsdCents: 500,
      maxGrossUsdCents: 1_000,
      maxCompletedPayments: 3,
      maxConcurrentReservations: 1,
      reservationTtlMinutes: 31,
      reconciliationSlaMinutes: 60,
    });
    mocks.isStripeEnabled.mockReturnValue(true);
    mocks.isStripeLivePilotFulfillmentSourceEnabled.mockReturnValue(false);
    mocks.stripeEventModeMismatch.mockReturnValue(null);
    mocks.detectStripeKeyMode.mockReturnValue("test");
    mocks.checkRateLimit.mockReturnValue({
      ok: true,
      remaining: 4,
      retryAfterSeconds: 0,
    });
    mocks.recordStripeWebhookOutcome.mockResolvedValue(undefined);
    mocks.isBuyerCardAccessServerEnabled.mockReturnValue(false);
    mocks.getBuyerSession.mockResolvedValue(null);
    mocks.isSameOriginMutation.mockReturnValue(true);
    mocks.hasActiveMarketplaceAccessGrant.mockResolvedValue(false);
    mocks.recordStripeMarketplaceAccessGrant.mockResolvedValue("active");
    mocks.recordStripeMarketplacePaymentTerminalState.mockResolvedValue([]);
    mocks.reserveStripeLivePilotCheckout.mockResolvedValue({
      reservationId: "00000000-0000-4000-8000-000000000003",
    });
    mocks.attachStripeLivePilotCheckoutSession.mockResolvedValue(undefined);
    mocks.closeStripeLivePilotReservationAfterApiFailure.mockResolvedValue(
      undefined
    );
    mocks.recordStripeLivePilotPaymentCompleted.mockResolvedValue({
      grantAllowed: true,
      replay: false,
    });
    mocks.markStripeLivePilotFulfilled.mockResolvedValue(undefined);
    mocks.markStripeLivePilotReview.mockResolvedValue(undefined);
    mocks.expireStripeLivePilotReservation.mockResolvedValue(true);
    mocks.recordStripeLivePilotTerminalState.mockResolvedValue(0);
    mocks.reconcileStripeLivePilotFinancials.mockResolvedValue(true);
    mocks.getStripePaymentFinancials.mockResolvedValue(null);
    mocks.createCheckoutSession.mockResolvedValue({
      id: "cs_test_123",
      url: "https://checkout.stripe.test/cs_test_123",
    });
    mocks.expireCheckoutSession.mockResolvedValue(undefined);
    mocks.verifyWalletSignature.mockReturnValue({
      valid: true,
      pubkey: buyerPubkey,
    });
    mocks.getUsdcPurchaseEntitlementStatus.mockResolvedValue({
      exists: false,
      revoked: false,
    });
    mocks.hasUsdcPurchaseReceiptForPaymentRef.mockResolvedValue(false);
    mocks.hasUsdcPurchaseEntitlement.mockResolvedValue(false);
    mocks.hasOnChainPurchase.mockResolvedValue(false);
    mocks.recordRevocableUsdcPurchaseReceipt.mockResolvedValue({
      receiptRecorded: true,
      entitlementUpdated: true,
      revoked: false,
    });
    mocks.recordAndApplyUsdcPaymentRevocation.mockResolvedValue([]);
    mockSkillRow();
  });

  it("rejects a null checkout body before rate-limit or database work", async () => {
    const res = await checkoutPOST(
      jsonRequest("http://localhost/api/stripe/checkout", null)
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("skillId is required");
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.verifyWalletSignature).not.toHaveBeenCalled();
    expect(initializeDatabase).not.toHaveBeenCalled();
    expect(mockSql).not.toHaveBeenCalled();
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects malformed skill IDs before checkout side effects", async () => {
    const res = await checkoutPOST(
      checkoutRequest({
        skillId: "not-a-uuid",
        auth: signedCheckoutAuth(),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid skillId");
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.verifyWalletSignature).not.toHaveBeenCalled();
    expect(initializeDatabase).not.toHaveBeenCalled();
    expect(mockSql).not.toHaveBeenCalled();
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("requires wallet auth before creating a checkout session", async () => {
    const res = await checkoutPOST(checkoutRequest({ skillId }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("Wallet auth is required");
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
    // Auth is rejected before any database work.
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("requires the current card-recourse disclosure acknowledgement", async () => {
    const res = await checkoutPOST(
      checkoutRequest({
        skillId,
        cardDisclosureVersion: undefined,
        auth: signedCheckoutAuth(),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("recourse disclosure");
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("requires the server-side checkout activation gate", async () => {
    mocks.getStripeCheckoutActivation.mockReturnValue({
      enabled: false,
      stripeConfigured: true,
      serverFlagEnabled: false,
      productionEdgeRateLimitReady: true,
      production: false,
      keyMode: "test",
      liveModeAcknowledged: false,
      keyModePermitted: true,
      livePilotScopeReady: true,
      livePilotImplementationReady: true,
    });

    const res = await checkoutPOST(
      checkoutRequest({ skillId, auth: signedCheckoutAuth() })
    );
    const body = await res.json();

    expect(res.status).toBe(501);
    expect(body.error).toContain("AGENTVOUCH_STRIPE_CHECKOUT_ENABLED");
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("explains an unacknowledged live key rather than a generic flag error", async () => {
    mocks.getStripeCheckoutActivation.mockReturnValue({
      enabled: false,
      stripeConfigured: true,
      serverFlagEnabled: true,
      productionEdgeRateLimitReady: true,
      production: false,
      keyMode: "live",
      liveModeAcknowledged: false,
      keyModePermitted: false,
      livePilotScopeReady: false,
      livePilotImplementationReady: false,
    });

    const res = await checkoutPOST(
      checkoutRequest({ skillId, auth: signedCheckoutAuth() })
    );
    const body = await res.json();

    expect(res.status).toBe(501);
    expect(body.error).toContain("AGENTVOUCH_STRIPE_LIVE_MODE_ENABLED");
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("rate limits session creation before database work", async () => {
    mocks.checkRateLimit.mockReturnValueOnce({
      ok: false,
      remaining: 0,
      retryAfterSeconds: 42,
    });

    const res = await checkoutPOST(
      checkoutRequest({ skillId, auth: signedCheckoutAuth() })
    );
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(body.error).toContain("Too many");
    expect(mockSql).not.toHaveBeenCalled();
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("binds checkout sessions to the signed buyer wallet, price, and amount", async () => {
    const res = await checkoutPOST(
      checkoutRequest({
        skillId,
        customerEmail: "buyer@example.com",
        auth: signedCheckoutAuth(),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.url).toBe("https://checkout.stripe.test/cs_test_123");
    expect(mocks.createCheckoutSession).toHaveBeenCalledWith({
      skillDbId: skillId,
      skillName: "Paid Skill",
      buyer: { kind: "wallet", pubkey: buyerPubkey },
      amountUsdcMicros: "1000000",
      amountUsdCents: 100,
      recourseDisclosureVersion: CARD_CHECKOUT_RECOURSE_DISCLOSURE_VERSION,
      successUrl: `http://localhost/skills/${skillId}?stripe=success`,
      cancelUrl: `http://localhost/skills/${skillId}?stripe=cancelled`,
      customerEmail: "buyer@example.com",
    });
  });

  it("creates a same-origin account checkout without wallet auth", async () => {
    mocks.isBuyerCardAccessServerEnabled.mockReturnValue(true);
    mocks.getBuyerSession.mockResolvedValue({
      accountId: buyerAccountId,
      provider: "clerk",
      providerSubject: "user_123",
      sessionId: "sess_123",
      issuedAt: null,
    });
    mockSkillRow({ evm_listing_id: "0x1234" });

    const res = await checkoutPOST(
      checkoutRequest({ skillId }, { Origin: "http://localhost" })
    );

    expect(res.status).toBe(200);
    expect(mocks.hasActiveMarketplaceAccessGrant).toHaveBeenCalledWith(
      buyerAccountId,
      skillId
    );
    expect(mocks.verifyWalletSignature).not.toHaveBeenCalled();
    expect(mocks.createCheckoutSession).toHaveBeenCalledWith({
      skillDbId: skillId,
      skillName: "Paid Skill",
      buyer: { kind: "account", accountId: buyerAccountId },
      amountUsdcMicros: "1000000",
      amountUsdCents: 100,
      recourseDisclosureVersion: CARD_CHECKOUT_RECOURSE_DISCLOSURE_VERSION,
      successUrl: `http://localhost/skills/${skillId}?stripe=success`,
      cancelUrl: `http://localhost/skills/${skillId}?stripe=cancelled`,
      customerEmail: undefined,
    });
  });

  it("requires a signed-in account for the limited live pilot", async () => {
    mocks.getStripeCheckoutActivation.mockReturnValue({
      enabled: true,
      stripeConfigured: true,
      serverFlagEnabled: true,
      productionEdgeRateLimitReady: true,
      production: true,
      keyMode: "live",
      liveModeAcknowledged: true,
      keyModePermitted: true,
      livePilotScopeReady: true,
      livePilotImplementationReady: true,
    });

    const res = await checkoutPOST(
      checkoutRequest({ skillId, auth: signedCheckoutAuth() })
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain("signed-in AgentVouch buyer account");
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("rejects an unlisted skill before creating a live Checkout Session", async () => {
    mocks.getStripeCheckoutActivation.mockReturnValue({
      enabled: true,
      stripeConfigured: true,
      serverFlagEnabled: true,
      productionEdgeRateLimitReady: true,
      production: true,
      keyMode: "live",
      liveModeAcknowledged: true,
      keyModePermitted: true,
      livePilotScopeReady: true,
      livePilotImplementationReady: true,
    });
    mocks.getStripeLivePilotScope.mockReturnValue({
      skillIds: ["00000000-0000-4000-8000-000000000099"],
      buyerAccountIds: [buyerAccountId],
      maxUnitUsdCents: 500,
      maxGrossUsdCents: 1_000,
      maxCompletedPayments: 3,
      maxConcurrentReservations: 1,
      reservationTtlMinutes: 31,
      reconciliationSlaMinutes: 60,
    });
    mocks.isBuyerCardAccessServerEnabled.mockReturnValue(true);
    mocks.getBuyerSession.mockResolvedValue({
      accountId: buyerAccountId,
      provider: "clerk",
      providerSubject: "user_123",
      sessionId: "sess_123",
      issuedAt: null,
    });

    const res = await checkoutPOST(
      checkoutRequest({ skillId }, { Origin: "http://localhost" })
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain("not included in the limited live card pilot");
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects an over-ceiling amount before creating a live Checkout Session", async () => {
    mocks.getStripeCheckoutActivation.mockReturnValue({
      enabled: true,
      stripeConfigured: true,
      serverFlagEnabled: true,
      productionEdgeRateLimitReady: true,
      production: true,
      keyMode: "live",
      liveModeAcknowledged: true,
      keyModePermitted: true,
      livePilotScopeReady: true,
      livePilotImplementationReady: true,
    });
    mocks.getStripeLivePilotScope.mockReturnValue({
      skillIds: [skillId],
      buyerAccountIds: [buyerAccountId],
      maxUnitUsdCents: 99,
      maxGrossUsdCents: 1_000,
      maxCompletedPayments: 3,
      maxConcurrentReservations: 1,
      reservationTtlMinutes: 31,
      reconciliationSlaMinutes: 60,
    });
    mocks.isBuyerCardAccessServerEnabled.mockReturnValue(true);
    mocks.getBuyerSession.mockResolvedValue({
      accountId: buyerAccountId,
      provider: "clerk",
      providerSubject: "user_123",
      sessionId: "sess_123",
      issuedAt: null,
    });

    const res = await checkoutPOST(
      checkoutRequest({ skillId }, { Origin: "http://localhost" })
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain("maximum charge");
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects an unallowlisted live buyer before database or Stripe work", async () => {
    mocks.getStripeCheckoutActivation.mockReturnValue({
      enabled: true,
      stripeConfigured: true,
      serverFlagEnabled: true,
      productionEdgeRateLimitReady: true,
      production: true,
      keyMode: "live",
      liveModeAcknowledged: true,
      keyModePermitted: true,
      livePilotScopeReady: true,
      livePilotImplementationReady: true,
    });
    mocks.isBuyerCardAccessServerEnabled.mockReturnValue(true);
    mocks.getBuyerSession.mockResolvedValue({
      accountId: buyerAccountId,
      provider: "clerk",
      providerSubject: "user_123",
      sessionId: "sess_123",
      issuedAt: null,
    });
    mocks.getStripeLivePilotScope.mockReturnValue({
      skillIds: [skillId],
      buyerAccountIds: ["00000000-0000-4000-8000-000000000099"],
      maxUnitUsdCents: 500,
      maxGrossUsdCents: 1_000,
      maxCompletedPayments: 3,
      maxConcurrentReservations: 1,
      reservationTtlMinutes: 31,
      reconciliationSlaMinutes: 60,
    });

    const res = await checkoutPOST(
      checkoutRequest({ skillId }, { Origin: "http://localhost" })
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("buyer account");
    expect(mockSql).not.toHaveBeenCalled();
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("atomically reserves live exposure before Stripe and binds the returned session", async () => {
    mocks.getStripeCheckoutActivation.mockReturnValue({
      enabled: true,
      stripeConfigured: true,
      serverFlagEnabled: true,
      productionEdgeRateLimitReady: true,
      production: true,
      keyMode: "live",
      liveModeAcknowledged: true,
      keyModePermitted: true,
      livePilotScopeReady: true,
      livePilotImplementationReady: true,
    });
    mocks.isBuyerCardAccessServerEnabled.mockReturnValue(true);
    mocks.getBuyerSession.mockResolvedValue({
      accountId: buyerAccountId,
      provider: "clerk",
      providerSubject: "user_123",
      sessionId: "sess_123",
      issuedAt: null,
    });

    const res = await checkoutPOST(
      checkoutRequest({ skillId }, { Origin: "http://localhost" })
    );

    expect(res.status).toBe(200);
    expect(mocks.reserveStripeLivePilotCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        buyerAccountId,
        skillDbId: skillId,
        amountUsdCents: 100,
      })
    );
    expect(
      mocks.reserveStripeLivePilotCheckout.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.createCheckoutSession.mock.invocationCallOrder[0]);
    const reservationInput = mocks.reserveStripeLivePilotCheckout.mock
      .calls[0]?.[0] as { expiresAtUnixSeconds: number };
    const checkoutInput = mocks.createCheckoutSession.mock.calls[0]?.[0] as {
      expiresAtUnixSeconds: number;
    };
    expect(reservationInput.expiresAtUnixSeconds).toBe(
      checkoutInput.expiresAtUnixSeconds
    );
    expect(mocks.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        livePilotReservationId: "00000000-0000-4000-8000-000000000003",
        expiresAtUnixSeconds: expect.any(Number),
      })
    );
    expect(mocks.attachStripeLivePilotCheckoutSession).toHaveBeenCalledWith({
      reservationId: "00000000-0000-4000-8000-000000000003",
      checkoutSessionId: "cs_test_123",
    });
  });

  it("durably closes a live reservation when Stripe session creation fails", async () => {
    mocks.getStripeCheckoutActivation.mockReturnValue({
      enabled: true,
      stripeConfigured: true,
      serverFlagEnabled: true,
      productionEdgeRateLimitReady: true,
      production: true,
      keyMode: "live",
      liveModeAcknowledged: true,
      keyModePermitted: true,
      livePilotScopeReady: true,
      livePilotImplementationReady: true,
    });
    mocks.isBuyerCardAccessServerEnabled.mockReturnValue(true);
    mocks.getBuyerSession.mockResolvedValue({
      accountId: buyerAccountId,
      provider: "clerk",
      providerSubject: "user_123",
      sessionId: "sess_123",
      issuedAt: null,
    });
    mocks.createCheckoutSession.mockRejectedValueOnce(
      new Error("Stripe unavailable")
    );

    const res = await checkoutPOST(
      checkoutRequest({ skillId }, { Origin: "http://localhost" })
    );

    expect(res.status).toBe(500);
    expect(
      mocks.closeStripeLivePilotReservationAfterApiFailure
    ).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000003",
      "Stripe unavailable"
    );
    expect(mocks.attachStripeLivePilotCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.expireCheckoutSession).not.toHaveBeenCalled();
  });

  it("expires a payable Session and closes its reservation when attachment fails", async () => {
    mocks.getStripeCheckoutActivation.mockReturnValue({
      enabled: true,
      stripeConfigured: true,
      serverFlagEnabled: true,
      productionEdgeRateLimitReady: true,
      production: true,
      keyMode: "live",
      liveModeAcknowledged: true,
      keyModePermitted: true,
      livePilotScopeReady: true,
      livePilotImplementationReady: true,
    });
    mocks.isBuyerCardAccessServerEnabled.mockReturnValue(true);
    mocks.getBuyerSession.mockResolvedValue({
      accountId: buyerAccountId,
      provider: "clerk",
      providerSubject: "user_123",
      sessionId: "sess_123",
      issuedAt: null,
    });
    mocks.attachStripeLivePilotCheckoutSession.mockRejectedValueOnce(
      new Error("database unavailable")
    );

    const res = await checkoutPOST(
      checkoutRequest({ skillId }, { Origin: "http://localhost" })
    );

    expect(res.status).toBe(500);
    expect(mocks.expireCheckoutSession).toHaveBeenCalledWith("cs_test_123");
    expect(
      mocks.closeStripeLivePilotReservationAfterApiFailure
    ).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000003",
      expect.stringContaining("Session was expired")
    );
  });

  it("marks durable review when neither Session attachment nor expiration succeeds", async () => {
    mocks.getStripeCheckoutActivation.mockReturnValue({
      enabled: true,
      stripeConfigured: true,
      serverFlagEnabled: true,
      productionEdgeRateLimitReady: true,
      production: true,
      keyMode: "live",
      liveModeAcknowledged: true,
      keyModePermitted: true,
      livePilotScopeReady: true,
      livePilotImplementationReady: true,
    });
    mocks.isBuyerCardAccessServerEnabled.mockReturnValue(true);
    mocks.getBuyerSession.mockResolvedValue({
      accountId: buyerAccountId,
      provider: "clerk",
      providerSubject: "user_123",
      sessionId: "sess_123",
      issuedAt: null,
    });
    mocks.attachStripeLivePilotCheckoutSession.mockRejectedValueOnce(
      new Error("database unavailable")
    );
    mocks.expireCheckoutSession.mockRejectedValueOnce(
      new Error("Stripe unavailable")
    );

    const res = await checkoutPOST(
      checkoutRequest({ skillId }, { Origin: "http://localhost" })
    );

    expect(res.status).toBe(500);
    expect(mocks.markStripeLivePilotReview).toHaveBeenCalledWith({
      reservationId: "00000000-0000-4000-8000-000000000003",
      reason: expect.stringContaining("expiration also failed"),
    });
  });

  it("rejects cross-origin account checkout", async () => {
    mocks.isBuyerCardAccessServerEnabled.mockReturnValue(true);
    mocks.getBuyerSession.mockResolvedValue({
      accountId: buyerAccountId,
      provider: "clerk",
      providerSubject: "user_123",
      sessionId: "sess_123",
      issuedAt: null,
    });
    mocks.isSameOriginMutation.mockReturnValue(false);

    const res = await checkoutPOST(checkoutRequest({ skillId }));

    expect(res.status).toBe(403);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects checkout auth scoped to a different message", async () => {
    const res = await checkoutPOST(
      checkoutRequest({
        skillId,
        auth: {
          pubkey: buyerPubkey,
          signature: "sig",
          message: "wrong scope",
          timestamp: 1709234567890,
        },
      })
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("Message scope mismatch");
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects checkout auth signed for a stale price", async () => {
    const res = await checkoutPOST(
      checkoutRequest({
        skillId,
        auth: signedCheckoutAuth("500000"),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("Message scope mismatch");
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("refuses card checkout below the Stripe minimum charge", async () => {
    mockSkillRow({ price_usdc_micros: "100000" }); // $0.10
    const res = await checkoutPOST(
      checkoutRequest({ skillId, auth: signedCheckoutAuth("100000") })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("card checkout minimum");
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("refuses card checkout for Base protocol listings", async () => {
    mockSkillRow({ evm_listing_id: "0x1234" });
    const res = await checkoutPOST(
      checkoutRequest({ skillId, auth: signedCheckoutAuth() })
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain("Base protocol listings");
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("refuses a repeat card checkout for a wallet with access", async () => {
    mocks.hasUsdcPurchaseEntitlement.mockResolvedValue(true);

    const res = await checkoutPOST(
      checkoutRequest({ skillId, auth: signedCheckoutAuth() })
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain("already has access");
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("refuses card checkout after an on-chain purchase", async () => {
    mockSkillRow({ on_chain_address: "SkillListing111" });
    mocks.hasOnChainPurchase.mockResolvedValue(true);

    const res = await checkoutPOST(
      checkoutRequest({ skillId, auth: signedCheckoutAuth() })
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain("already has access");
    expect(mocks.hasOnChainPurchase).toHaveBeenCalledWith(
      buyerPubkey,
      "SkillListing111"
    );
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("records webhook entitlements for the buyer wallet in Stripe metadata", async () => {
    mockSql.mockReturnValue(
      vi.fn().mockResolvedValue([{ id: skillId, evm_listing_id: null }])
    );
    mocks.verifyAndParseWebhook.mockReturnValue(paidSessionEvent());

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.entitled).toBe(buyerPubkey);
    expect(mocks.recordRevocableUsdcPurchaseReceipt).toHaveBeenCalledWith({
      skillDbId: skillId,
      buyerPubkey,
      paymentTxSignature: "stripe:pi_test_123",
      recipientAta: "stripe-offchain",
      currencyMint: "USD",
      amountMicros: "1000000",
      paymentFlow: "stripe-mpp-offchain",
    });
    expect(mocks.recordStripeWebhookOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "evt_1",
        outcome: "fulfilled",
        needsReview: false,
      })
    );
  });

  it("records an account grant without creating a protocol or wallet receipt", async () => {
    mockSql.mockReturnValue(
      vi.fn().mockResolvedValue([{ id: skillId, evm_listing_id: "0x1234" }])
    );
    mocks.verifyAndParseWebhook.mockReturnValue(paidAccountSessionEvent());

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.grantedAccount).toBe(buyerAccountId);
    expect(mocks.recordStripeMarketplaceAccessGrant).toHaveBeenCalledWith({
      accountId: buyerAccountId,
      skillDbId: skillId,
      paymentRef: "stripe:pi_test_123",
    });
    expect(mocks.recordRevocableUsdcPurchaseReceipt).not.toHaveBeenCalled();
    expect(mocks.recordStripeWebhookOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "fulfilled",
        reason: "account-scoped marketplace access grant recorded",
        details: { protocolReceiptRecorded: false },
      })
    );
  });

  it("keeps all live fulfillment source-disabled pending founder and external gates", async () => {
    const event = livePaidAccountSessionEvent();
    mocks.verifyAndParseWebhook.mockReturnValue(event);

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ignored).toContain("source-disabled");
    expect(mocks.recordStripeMarketplaceAccessGrant).not.toHaveBeenCalled();
    expect(mocks.recordRevocableUsdcPurchaseReceipt).not.toHaveBeenCalled();
    expect(mocks.recordStripeWebhookOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "needs-review", needsReview: true })
    );
  });

  it("hypothetically records a live payment before grant and reconciles after fulfillment", async () => {
    mocks.isStripeLivePilotFulfillmentSourceEnabled.mockReturnValue(true);
    mocks.detectStripeKeyMode.mockReturnValue("live");
    mocks.getStripePaymentFinancials.mockResolvedValue({
      grossUsdCents: 100,
      feeUsdCents: 3,
      netUsdCents: 97,
    });
    mockSql.mockReturnValue(
      vi.fn().mockResolvedValue([{ id: skillId, evm_listing_id: "0x1234" }])
    );
    mocks.verifyAndParseWebhook.mockReturnValue(livePaidAccountSessionEvent());

    const res = await webhookPOST(webhookRequest({}));

    expect(res.status).toBe(200);
    expect(mocks.recordStripeLivePilotPaymentCompleted).toHaveBeenCalledWith({
      reservationId: "00000000-0000-4000-8000-000000000003",
      checkoutSessionId: "cs_test_123",
      paymentIntentId: "pi_test_123",
      buyerAccountId,
      skillDbId: skillId,
      recourseDisclosureVersion: CARD_CHECKOUT_RECOURSE_DISCLOSURE_VERSION,
      grossUsdCents: 100,
    });
    expect(
      mocks.recordStripeLivePilotPaymentCompleted.mock.invocationCallOrder[0]
    ).toBeLessThan(
      mocks.recordStripeMarketplaceAccessGrant.mock.invocationCallOrder[0]
    );
    expect(mocks.markStripeLivePilotFulfilled).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000003"
    );
    expect(mocks.reconcileStripeLivePilotFinancials).toHaveBeenCalledWith({
      reservationId: "00000000-0000-4000-8000-000000000003",
      paymentIntentId: "pi_test_123",
      grossUsdCents: 100,
      feeUsdCents: 3,
      netUsdCents: 97,
    });
  });

  it("marks a paid live reservation for review when access grant persistence fails", async () => {
    mocks.isStripeLivePilotFulfillmentSourceEnabled.mockReturnValue(true);
    mocks.detectStripeKeyMode.mockReturnValue("live");
    mockSql.mockReturnValue(
      vi.fn().mockResolvedValue([{ id: skillId, evm_listing_id: "0x1234" }])
    );
    mocks.recordStripeMarketplaceAccessGrant.mockRejectedValueOnce(
      new Error("grant database unavailable")
    );
    mocks.verifyAndParseWebhook.mockReturnValue(livePaidAccountSessionEvent());

    const res = await webhookPOST(webhookRequest({}));

    expect(res.status).toBe(500);
    expect(mocks.markStripeLivePilotReview).toHaveBeenCalledWith({
      reservationId: "00000000-0000-4000-8000-000000000003",
      reason: expect.stringContaining("access grant failed"),
    });
  });

  it("expires a live pilot reservation even while fulfillment remains source-disabled", async () => {
    mocks.detectStripeKeyMode.mockReturnValue("live");
    mocks.verifyAndParseWebhook.mockReturnValue({
      id: "evt_expired",
      type: "checkout.session.expired",
      livemode: true,
      data: {
        object: {
          id: "cs_live_expired",
          amount_total: 100,
          metadata: {
            live_pilot_reservation_id: "00000000-0000-4000-8000-000000000003",
            buyer_account_id: buyerAccountId,
            skill_db_id: skillId,
            recourse_disclosure_version:
              CARD_CHECKOUT_RECOURSE_DISCLOSURE_VERSION,
            price_usdc_micros: "1000000",
            payment_flow: "stripe-account-access",
          },
        },
      },
    });

    const res = await webhookPOST(webhookRequest({}));

    expect(res.status).toBe(200);
    expect(mocks.expireStripeLivePilotReservation).toHaveBeenCalledWith({
      reservationId: "00000000-0000-4000-8000-000000000003",
      checkoutSessionId: "cs_live_expired",
      buyerAccountId,
      skillDbId: skillId,
      recourseDisclosureVersion: CARD_CHECKOUT_RECOURSE_DISCLOSURE_VERSION,
      grossUsdCents: 100,
    });
    expect(mocks.recordStripeMarketplaceAccessGrant).not.toHaveBeenCalled();
  });

  it("expires an in-flight pilot reservation created under an earlier disclosure version", async () => {
    mocks.detectStripeKeyMode.mockReturnValue("live");
    mocks.verifyAndParseWebhook.mockReturnValue({
      id: "evt_expired_previous_disclosure",
      type: "checkout.session.expired",
      livemode: true,
      data: {
        object: {
          id: "cs_live_expired_previous_disclosure",
          amount_total: 100,
          metadata: {
            live_pilot_reservation_id: "00000000-0000-4000-8000-000000000003",
            buyer_account_id: buyerAccountId,
            skill_db_id: skillId,
            recourse_disclosure_version: "2026-06-01",
            price_usdc_micros: "1000000",
            payment_flow: "stripe-account-access",
          },
        },
      },
    });

    const res = await webhookPOST(webhookRequest({}));

    expect(res.status).toBe(200);
    expect(mocks.expireStripeLivePilotReservation).toHaveBeenCalledWith({
      reservationId: "00000000-0000-4000-8000-000000000003",
      checkoutSessionId: "cs_live_expired_previous_disclosure",
      buyerAccountId,
      skillDbId: skillId,
      recourseDisclosureVersion: "2026-06-01",
      grossUsdCents: 100,
    });
  });

  it("does not grant when a checkout event omits livemode", async () => {
    const event = paidAccountSessionEvent();
    delete (event as { livemode?: boolean }).livemode;
    mocks.verifyAndParseWebhook.mockReturnValue(event);

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ignored).toContain("missing an explicit livemode");
    expect(mocks.recordStripeMarketplaceAccessGrant).not.toHaveBeenCalled();
    expect(mocks.recordStripeWebhookOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "needs-review", needsReview: true })
    );
  });

  it("keeps an account grant revoked when completion is replayed", async () => {
    mockSql.mockReturnValue(
      vi.fn().mockResolvedValue([{ id: skillId, evm_listing_id: "0x1234" }])
    );
    mocks.recordStripeMarketplaceAccessGrant.mockResolvedValue("revoked");
    mocks.verifyAndParseWebhook.mockReturnValue(paidAccountSessionEvent());

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ignored).toContain("account grant stays revoked");
    expect(mocks.recordRevocableUsdcPurchaseReceipt).not.toHaveBeenCalled();
  });

  it("does not grant access when the event livemode contradicts the key", async () => {
    // A live event reaching a test-configured endpoint (or the reverse) means
    // the wiring has crossed. Terminal needs-review for a grant, and a 200 so
    // Stripe stops retrying while reconciliation escalates it.
    mocks.stripeEventModeMismatch.mockReturnValue({
      keyMode: "test",
      eventMode: "live",
    });
    mocks.verifyAndParseWebhook.mockReturnValue(paidSessionEvent());

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ignored).toContain("livemode mismatch");
    expect(mocks.recordRevocableUsdcPurchaseReceipt).not.toHaveBeenCalled();
    expect(mocks.recordStripeMarketplaceAccessGrant).not.toHaveBeenCalled();
    expect(mocks.recordStripeWebhookOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "needs-review", needsReview: true })
    );
  });

  it("still revokes a livemode-mismatched full refund", async () => {
    mocks.stripeEventModeMismatch.mockReturnValue({
      keyMode: "live",
      eventMode: "test",
    });
    mocks.recordAndApplyUsdcPaymentRevocation.mockResolvedValue([
      { skill_db_id: skillId, buyer_pubkey: buyerPubkey },
    ]);
    mocks.verifyAndParseWebhook.mockReturnValue({
      id: "evt_mode_mismatch_refund",
      type: "charge.refunded",
      livemode: false,
      data: { object: { payment_intent: "pi_123", refunded: true } },
    });

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.revoked).toBe(1);
    expect(mocks.recordAndApplyUsdcPaymentRevocation).toHaveBeenCalledWith(
      "stripe:pi_123",
      "stripe-refund"
    );
  });

  it("refuses to grant access when the key mode cannot be classified", async () => {
    mocks.detectStripeKeyMode.mockReturnValue("unknown");
    mocks.verifyAndParseWebhook.mockReturnValue(paidSessionEvent());

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ignored).toContain("unrecognized prefix");
    expect(mocks.recordRevocableUsdcPurchaseReceipt).not.toHaveBeenCalled();
    expect(mocks.recordStripeMarketplaceAccessGrant).not.toHaveBeenCalled();
    expect(mocks.recordStripeWebhookOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "needs-review", needsReview: true })
    );
  });

  it("still revokes on an unclassified key, because refusing would be fail-open", async () => {
    // Fail-closed means "do not grant", not "do not revoke". A terminal ack on
    // a refund would let a charged-back buyer keep access, since Stripe never
    // redelivers it.
    mocks.detectStripeKeyMode.mockReturnValue("unknown");
    mocks.recordAndApplyUsdcPaymentRevocation.mockResolvedValue([
      { skill_db_id: skillId, buyer_pubkey: buyerPubkey },
    ]);
    mocks.verifyAndParseWebhook.mockReturnValue({
      id: "evt_unknown_key_refund",
      type: "charge.refunded",
      livemode: false,
      data: {
        object: {
          id: "ch_unknown_key",
          payment_intent: "pi_test_123",
          refunded: true,
          amount_refunded: 100,
        },
      },
    });

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.revoked).toBe(1);
    expect(mocks.recordAndApplyUsdcPaymentRevocation).toHaveBeenCalledWith(
      "stripe:pi_test_123",
      "stripe-refund"
    );
  });

  it("does not fulfill a paid session without a payment intent", async () => {
    mockSql.mockReturnValue(
      vi.fn().mockResolvedValue([{ id: skillId, evm_listing_id: null }])
    );
    mocks.verifyAndParseWebhook.mockReturnValue(
      paidSessionEvent({ payment_intent: null })
    );

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ignored).toContain("without payment_intent");
    expect(mocks.recordRevocableUsdcPurchaseReceipt).not.toHaveBeenCalled();
  });

  it("does not fulfill after a skill becomes a Base protocol listing", async () => {
    mockSql.mockReturnValue(
      vi.fn().mockResolvedValue([{ id: skillId, evm_listing_id: "0x1234" }])
    );
    mocks.verifyAndParseWebhook.mockReturnValue(paidSessionEvent());

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ignored).toContain("Base protocol listings");
    expect(mocks.recordRevocableUsdcPurchaseReceipt).not.toHaveBeenCalled();
  });

  it("does not mint an entitlement when the Stripe amount mismatches metadata", async () => {
    mockSql.mockReturnValue(vi.fn().mockResolvedValue([{ id: skillId }]));
    mocks.verifyAndParseWebhook.mockReturnValue(
      paidSessionEvent({ amount_total: 99 })
    );

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    // ACKed so Stripe stops retrying a permanently-unprocessable event, but
    // no entitlement is written and the reason is surfaced for reconciliation.
    expect(res.status).toBe(200);
    expect(body.ignored).toContain("charged amount does not match");
    expect(mocks.recordRevocableUsdcPurchaseReceipt).not.toHaveBeenCalled();
    expect(mocks.recordStripeWebhookOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "evt_1",
        outcome: "needs-review",
        needsReview: true,
      })
    );
  });

  it("acks unpaid completed sessions without minting (async payment flow)", async () => {
    const event = paidSessionEvent();
    event.data.object.payment_status = "unpaid";
    mocks.verifyAndParseWebhook.mockReturnValue(event);

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ignored).toContain("not paid");
    expect(mocks.recordRevocableUsdcPurchaseReceipt).not.toHaveBeenCalled();
  });

  it("records repeat charges without overwriting an existing entitlement", async () => {
    mockSql.mockReturnValue(vi.fn().mockResolvedValue([{ id: skillId }]));
    mocks.getUsdcPurchaseEntitlementStatus.mockResolvedValue({
      exists: true,
      revoked: false,
    });
    mocks.verifyAndParseWebhook.mockReturnValue(paidSessionEvent());

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.alreadyEntitled).toBe(true);
    expect(mocks.recordRevocableUsdcPurchaseReceipt).toHaveBeenCalled();
  });

  it("revokes the entitlement on a full charge refund", async () => {
    mocks.recordAndApplyUsdcPaymentRevocation.mockResolvedValue([
      { skill_db_id: skillId, buyer_pubkey: buyerPubkey },
    ]);
    mocks.verifyAndParseWebhook.mockReturnValue({
      id: "evt_2",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_test_1",
          payment_intent: "pi_test_123",
          refunded: true,
          amount_refunded: 100,
        },
      },
    });

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.revoked).toBe(1);
    expect(mocks.recordAndApplyUsdcPaymentRevocation).toHaveBeenCalledWith(
      "stripe:pi_test_123",
      "stripe-refund"
    );
    expect(mocks.recordStripeWebhookOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "evt_2",
        outcome: "revoked",
        needsReview: false,
      })
    );
  });

  it("revokes or tombstones the exact account grant on a full refund", async () => {
    mocks.recordStripeMarketplacePaymentTerminalState.mockResolvedValue([
      { accountId: buyerAccountId, skillDbId: skillId },
    ]);
    mocks.verifyAndParseWebhook.mockReturnValue({
      id: "evt_account_refund",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_test_account",
          payment_intent: "pi_test_123",
          refunded: true,
          amount_refunded: 100,
          metadata: {
            payment_flow: "stripe-account-access",
            buyer_account_id: buyerAccountId,
            skill_db_id: skillId,
          },
        },
      },
    });

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.revoked).toBe(1);
    expect(
      mocks.recordStripeMarketplacePaymentTerminalState
    ).toHaveBeenCalledWith({
      eventId: "evt_account_refund",
      accountId: buyerAccountId,
      skillDbId: skillId,
      paymentRef: "stripe:pi_test_123",
      reason: "stripe-refund",
    });
    expect(mocks.recordStripeWebhookOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        buyerKey: buyerAccountId,
        outcome: "revoked",
        details: {
          revokedWalletEntitlements: 0,
          revokedAccountGrants: 1,
          pilotLedgerRowsUpdated: 0,
        },
      })
    );
    expect(mocks.recordStripeLivePilotTerminalState).not.toHaveBeenCalled();
  });

  it("records a payment terminal marker when refund metadata is absent", async () => {
    mocks.verifyAndParseWebhook.mockReturnValue({
      id: "evt_account_refund_without_metadata",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_test_account_without_metadata",
          payment_intent: "pi_test_123",
          refunded: true,
          amount_refunded: 100,
        },
      },
    });

    const res = await webhookPOST(webhookRequest({}));

    expect(res.status).toBe(200);
    expect(
      mocks.recordStripeMarketplacePaymentTerminalState
    ).toHaveBeenCalledWith({
      eventId: "evt_account_refund_without_metadata",
      paymentRef: "stripe:pi_test_123",
      reason: "stripe-refund",
    });
  });

  it("updates live pilot terminal state only by an already-bound PaymentIntent", async () => {
    mocks.detectStripeKeyMode.mockReturnValue("live");
    mocks.recordStripeLivePilotTerminalState.mockResolvedValueOnce(1);
    mocks.verifyAndParseWebhook.mockReturnValue({
      id: "evt_live_refund",
      type: "charge.refunded",
      livemode: true,
      data: {
        object: {
          id: "ch_live_refund",
          payment_intent: "pi_live_bound",
          refunded: true,
          amount_refunded: 100,
          metadata: {
            // This deliberately does not match any reservation. It must not be
            // an authorization input for ledger mutation.
            live_pilot_reservation_id: "00000000-0000-4000-8000-000000000099",
          },
        },
      },
    });

    const res = await webhookPOST(webhookRequest({}));

    expect(res.status).toBe(200);
    expect(mocks.recordStripeLivePilotTerminalState).toHaveBeenCalledWith({
      paymentIntentId: "pi_live_bound",
      kind: "full-refund",
      refundedUsdCents: 100,
    });
  });

  it("never mutates the live pilot ledger from a test-mode terminal event", async () => {
    mocks.detectStripeKeyMode.mockReturnValue("live");
    mocks.verifyAndParseWebhook.mockReturnValue({
      id: "evt_test_refund",
      type: "charge.refunded",
      livemode: false,
      data: {
        object: {
          id: "ch_test_refund",
          payment_intent: "pi_live_bound",
          refunded: true,
          amount_refunded: 100,
          metadata: {
            live_pilot_reservation_id: "00000000-0000-4000-8000-000000000003",
          },
        },
      },
    });

    const res = await webhookPOST(webhookRequest({}));

    expect(res.status).toBe(200);
    expect(mocks.recordStripeLivePilotTerminalState).not.toHaveBeenCalled();
  });

  it("revokes the entitlement when a dispute is opened", async () => {
    mocks.verifyAndParseWebhook.mockReturnValue({
      id: "evt_3",
      type: "charge.dispute.created",
      data: {
        object: { id: "dp_test_1", payment_intent: "pi_test_123" },
      },
    });

    const res = await webhookPOST(webhookRequest({}));

    expect(res.status).toBe(200);
    expect(mocks.recordAndApplyUsdcPaymentRevocation).toHaveBeenCalledWith(
      "stripe:pi_test_123",
      "stripe-dispute"
    );
  });

  it("keeps the entitlement on a partial refund", async () => {
    mocks.verifyAndParseWebhook.mockReturnValue({
      id: "evt_4",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_test_1",
          payment_intent: "pi_test_123",
          refunded: false,
          amount_refunded: 40,
        },
      },
    });

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ignored).toBe("partial refund");
    expect(mocks.recordAndApplyUsdcPaymentRevocation).not.toHaveBeenCalled();
    expect(mocks.recordStripeLivePilotTerminalState).not.toHaveBeenCalled();
    expect(mocks.recordStripeWebhookOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "evt_4",
        outcome: "needs-review",
        reason: "partial refund",
      })
    );
  });

  it("returns 500 when a terminal outcome cannot be persisted", async () => {
    mocks.recordStripeWebhookOutcome.mockRejectedValueOnce(
      new Error("database unavailable")
    );
    mocks.verifyAndParseWebhook.mockReturnValue(
      paidSessionEvent({ amount_total: 99 })
    );

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("persist Stripe webhook outcome");
  });

  it("does not re-mint when a revoked payment's webhook is replayed", async () => {
    mockSql.mockReturnValue(vi.fn().mockResolvedValue([{ id: skillId }]));
    mocks.getUsdcPurchaseEntitlementStatus.mockResolvedValue({
      exists: true,
      revoked: true,
    });
    mocks.hasUsdcPurchaseReceiptForPaymentRef.mockResolvedValue(true);
    mocks.verifyAndParseWebhook.mockReturnValue(paidSessionEvent());

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ignored).toContain("stays revoked");
    expect(mocks.recordRevocableUsdcPurchaseReceipt).not.toHaveBeenCalled();
  });

  it("does not mint when a refund arrived before checkout completion", async () => {
    mockSql.mockReturnValue(
      vi.fn().mockResolvedValue([{ id: skillId, evm_listing_id: null }])
    );
    mocks.recordRevocableUsdcPurchaseReceipt.mockResolvedValue({
      receiptRecorded: false,
      entitlementUpdated: false,
      revoked: true,
    });
    mocks.verifyAndParseWebhook.mockReturnValue(paidSessionEvent());

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ignored).toContain("stays revoked");
    expect(mocks.recordRevocableUsdcPurchaseReceipt).toHaveBeenCalled();
  });

  it("re-mints a revoked entitlement for a genuinely new payment", async () => {
    mockSql.mockReturnValue(vi.fn().mockResolvedValue([{ id: skillId }]));
    mocks.getUsdcPurchaseEntitlementStatus.mockResolvedValue({
      exists: true,
      revoked: true,
    });
    mocks.hasUsdcPurchaseReceiptForPaymentRef.mockResolvedValue(false);
    mocks.verifyAndParseWebhook.mockReturnValue(paidSessionEvent());

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.entitled).toBe(buyerPubkey);
    expect(mocks.recordRevocableUsdcPurchaseReceipt).toHaveBeenCalled();
  });
});
