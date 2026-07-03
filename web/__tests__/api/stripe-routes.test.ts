import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(),
  isStripeEnabled: vi.fn(),
  verifyAndParseWebhook: vi.fn(),
  verifyWalletSignature: vi.fn(),
  recordUsdcPurchaseReceipt: vi.fn(),
  hasUsdcPurchaseEntitlement: vi.fn(),
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
  isStripeEnabled: () => mocks.isStripeEnabled(),
  usdcMicrosToUsdCents: (micros: bigint) => Number((micros + 5000n) / 10000n),
  verifyAndParseWebhook: (...args: unknown[]) =>
    mocks.verifyAndParseWebhook(...args),
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
  recordUsdcPurchaseReceipt: (...args: unknown[]) =>
    mocks.recordUsdcPurchaseReceipt(...args),
  hasUsdcPurchaseEntitlement: (...args: unknown[]) =>
    mocks.hasUsdcPurchaseEntitlement(...args),
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
    evm_listing_id: string | null;
  }> = {}
) {
  mockSql.mockReturnValue(
    vi.fn().mockResolvedValue([
      {
        id: skillId,
        name: "Paid Skill",
        price_usdc_micros: "1000000",
        evm_listing_id: null,
        ...overrides,
      },
    ])
  );
}

function paidSessionEvent(
  overrides: Partial<{
    amount_total: number;
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
        payment_intent: "pi_test_123",
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
    mocks.isStripeEnabled.mockReturnValue(true);
    mocks.createCheckoutSession.mockResolvedValue({
      id: "cs_test_123",
      url: "https://checkout.stripe.test/cs_test_123",
    });
    mocks.verifyWalletSignature.mockReturnValue({
      valid: true,
      pubkey: buyerPubkey,
    });
    mocks.hasUsdcPurchaseEntitlement.mockResolvedValue(false);
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

  it("records webhook entitlements for the buyer wallet in Stripe metadata", async () => {
    mockSql.mockReturnValue(vi.fn().mockResolvedValue([{ id: skillId }]));
    mocks.verifyAndParseWebhook.mockReturnValue(paidSessionEvent());

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.entitled).toBe(buyerPubkey);
    expect(mocks.recordUsdcPurchaseReceipt).toHaveBeenCalledWith({
      skillDbId: skillId,
      buyerPubkey,
      paymentTxSignature: "stripe:pi_test_123",
      recipientAta: "stripe-offchain",
      currencyMint: "USD",
      amountMicros: "1000000",
      paymentFlow: "stripe-mpp-offchain",
    });
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
    expect(mocks.recordUsdcPurchaseReceipt).not.toHaveBeenCalled();
  });

  it("acks unpaid completed sessions without minting (async payment flow)", async () => {
    const event = paidSessionEvent();
    event.data.object.payment_status = "unpaid";
    mocks.verifyAndParseWebhook.mockReturnValue(event);

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ignored).toContain("not paid");
    expect(mocks.recordUsdcPurchaseReceipt).not.toHaveBeenCalled();
  });

  it("does not overwrite an existing entitlement on duplicate or late webhooks", async () => {
    mockSql.mockReturnValue(vi.fn().mockResolvedValue([{ id: skillId }]));
    mocks.hasUsdcPurchaseEntitlement.mockResolvedValue(true);
    mocks.verifyAndParseWebhook.mockReturnValue(paidSessionEvent());

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.alreadyEntitled).toBe(true);
    expect(mocks.recordUsdcPurchaseReceipt).not.toHaveBeenCalled();
  });
});
