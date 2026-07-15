import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(),
  getStripeCheckoutActivation: vi.fn(),
  isStripeEnabled: vi.fn(),
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
}));

vi.mock("@/lib/db", () => ({
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
  sql: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  STRIPE_CURRENCY_SENTINEL: "USD",
  STRIPE_PAYMENT_FLOW: "stripe-mpp-offchain",
  STRIPE_RECIPIENT_SENTINEL: "stripe-offchain",
  STRIPE_MIN_CHARGE_USD_CENTS: 50,
  createCheckoutSession: (...args: unknown[]) =>
    mocks.createCheckoutSession(...args),
  getStripeCheckoutActivation: () => mocks.getStripeCheckoutActivation(),
  isStripeEnabled: () => mocks.isStripeEnabled(),
  usdcMicrosToUsdCents: (micros: bigint) => Number((micros + 5000n) / 10000n),
  verifyAndParseWebhook: (...args: unknown[]) =>
    mocks.verifyAndParseWebhook(...args),
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
import { sql } from "@/lib/db";
import { buildStripeCheckoutMessage } from "@/lib/auth";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;

const skillId = "00000000-0000-0000-0000-000000000001";
const buyerPubkey = "Buyer111111111111111111111111111111111111111";

function jsonRequest(url: string, body: unknown, headers?: HeadersInit) {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
  });
}

function checkoutRequest(body: unknown) {
  return jsonRequest("http://localhost/api/stripe/checkout", body);
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
          ...(overrides.metadata ?? {}),
        },
      },
    },
  };
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
    });
    mocks.isStripeEnabled.mockReturnValue(true);
    mocks.checkRateLimit.mockReturnValue({
      ok: true,
      remaining: 4,
      retryAfterSeconds: 0,
    });
    mocks.recordStripeWebhookOutcome.mockResolvedValue(undefined);
    mocks.createCheckoutSession.mockResolvedValue({
      id: "cs_test_123",
      url: "https://checkout.stripe.test/cs_test_123",
    });
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

  it("requires wallet auth before creating a checkout session", async () => {
    const res = await checkoutPOST(checkoutRequest({ skillId }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("Wallet auth is required");
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
    // Auth is rejected before any database work.
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("requires the server-side checkout activation gate", async () => {
    mocks.getStripeCheckoutActivation.mockReturnValue({
      enabled: false,
      stripeConfigured: true,
      serverFlagEnabled: false,
      productionEdgeRateLimitReady: true,
      production: false,
    });

    const res = await checkoutPOST(
      checkoutRequest({ skillId, auth: signedCheckoutAuth() })
    );
    const body = await res.json();

    expect(res.status).toBe(501);
    expect(body.error).toContain("AGENTVOUCH_STRIPE_CHECKOUT_ENABLED");
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
      buyerPubkey,
      amountUsdcMicros: "1000000",
      amountUsdCents: 100,
      successUrl: `http://localhost/skills/${skillId}?stripe=success`,
      cancelUrl: `http://localhost/skills/${skillId}?stripe=cancelled`,
      customerEmail: "buyer@example.com",
    });
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
