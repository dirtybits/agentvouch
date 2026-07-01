import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(),
  isStripeEnabled: vi.fn(),
  verifyAndParseWebhook: vi.fn(),
  verifyWalletSignature: vi.fn(),
  recordUsdcPurchaseReceipt: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
  sql: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  STRIPE_CURRENCY_SENTINEL: "USD",
  STRIPE_PAYMENT_FLOW: "stripe-mpp-offchain",
  STRIPE_RECIPIENT_SENTINEL: "stripe-offchain",
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
}));

import { POST as checkoutPOST } from "@/app/api/stripe/checkout/route";
import { POST as webhookPOST } from "@/app/api/stripe/webhook/route";
import { sql } from "@/lib/db";
import { buildStripeCheckoutMessage } from "@/lib/auth";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;

const skillId = "00000000-0000-0000-0000-000000000001";

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
      pubkey: "Buyer111111111111111111111111111111111111111",
    });
    mockSql.mockReturnValue(
      vi.fn().mockResolvedValue([
        {
          id: skillId,
          name: "Paid Skill",
          price_usdc_micros: "1000000",
        },
      ])
    );
  });

  it("requires wallet auth before creating a checkout session", async () => {
    const res = await checkoutPOST(checkoutRequest({ skillId }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("Wallet auth is required");
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("binds checkout sessions to the signed buyer wallet and price", async () => {
    const timestamp = 1709234567890;
    const auth = {
      pubkey: "Buyer111111111111111111111111111111111111111",
      signature: "sig",
      message: buildStripeCheckoutMessage(skillId, timestamp),
      timestamp,
    };

    const res = await checkoutPOST(
      checkoutRequest({
        skillId,
        customerEmail: "buyer@example.com",
        auth,
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.url).toBe("https://checkout.stripe.test/cs_test_123");
    expect(mocks.createCheckoutSession).toHaveBeenCalledWith({
      skillDbId: skillId,
      skillName: "Paid Skill",
      buyerPubkey: "Buyer111111111111111111111111111111111111111",
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
          pubkey: "Buyer111111111111111111111111111111111111111",
          signature: "sig",
          message: "wrong scope",
          timestamp: 1709234567890,
        },
      })
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Message scope mismatch");
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("records webhook entitlements for the buyer wallet in Stripe metadata", async () => {
    mockSql.mockReturnValue(vi.fn().mockResolvedValue([{ id: skillId }]));
    mocks.verifyAndParseWebhook.mockReturnValue({
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_123",
          client_reference_id: skillId,
          payment_intent: "pi_test_123",
          amount_total: 100,
          currency: "usd",
          mode: "payment",
          payment_status: "paid",
          metadata: {
            skill_db_id: skillId,
            buyer_pubkey: "Buyer111111111111111111111111111111111111111",
            price_usdc_micros: "1000000",
            payment_flow: "stripe-mpp-offchain",
          },
        },
      },
    });

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.entitled).toBe("Buyer111111111111111111111111111111111111111");
    expect(mocks.recordUsdcPurchaseReceipt).toHaveBeenCalledWith({
      skillDbId: skillId,
      buyerPubkey: "Buyer111111111111111111111111111111111111111",
      paymentTxSignature: "stripe:pi_test_123",
      recipientAta: "stripe-offchain",
      currencyMint: "USD",
      amountMicros: "1000000",
      paymentFlow: "stripe-mpp-offchain",
    });
  });

  it("does not mint an entitlement when the Stripe amount mismatches metadata", async () => {
    mockSql.mockReturnValue(vi.fn().mockResolvedValue([{ id: skillId }]));
    mocks.verifyAndParseWebhook.mockReturnValue({
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_123",
          client_reference_id: skillId,
          payment_intent: "pi_test_123",
          amount_total: 99,
          currency: "usd",
          mode: "payment",
          payment_status: "paid",
          metadata: {
            skill_db_id: skillId,
            buyer_pubkey: "Buyer111111111111111111111111111111111111111",
            price_usdc_micros: "1000000",
            payment_flow: "stripe-mpp-offchain",
          },
        },
      },
    });

    const res = await webhookPOST(webhookRequest({}));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe("Charged amount does not match listing price");
    expect(mocks.recordUsdcPurchaseReceipt).not.toHaveBeenCalled();
  });
});
