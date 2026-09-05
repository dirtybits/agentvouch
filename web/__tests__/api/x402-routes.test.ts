import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  verifyPaymentProof: vi.fn(),
  verifyBaseX402PaymentPayload: vi.fn(),
  relayAndRecordBaseX402Purchase: vi.fn(),
  loadBaseX402Skill: vi.fn(),
  hasChainUsdcPurchaseEntitlement: vi.fn(),
  getX402SettlementEntitlement: vi.fn(),
  claimX402SettlementAttempt: vi.fn(),
  completeX402SettlementAttempt: vi.fn(),
  failX402SettlementAttempt: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authenticateRequest: mocks.authenticateRequest,
}));
vi.mock("@/lib/x402", () => ({
  verifyPaymentProof: mocks.verifyPaymentProof,
}));
vi.mock("@/lib/baseX402", () => ({
  verifyBaseX402PaymentPayload: mocks.verifyBaseX402PaymentPayload,
  relayAndRecordBaseX402Purchase: mocks.relayAndRecordBaseX402Purchase,
}));
vi.mock("@/lib/baseX402Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/baseX402Api")>()),
  loadBaseX402Skill: mocks.loadBaseX402Skill,
}));
vi.mock("@/lib/usdcPurchases", () => ({
  hasChainUsdcPurchaseEntitlement: mocks.hasChainUsdcPurchaseEntitlement,
  getX402SettlementEntitlement: mocks.getX402SettlementEntitlement,
  claimX402SettlementAttempt: mocks.claimX402SettlementAttempt,
  completeX402SettlementAttempt: mocks.completeX402SettlementAttempt,
  failX402SettlementAttempt: mocks.failX402SettlementAttempt,
}));

import { POST as settle } from "@/app/api/x402/settle/route";
import { POST as verify } from "@/app/api/x402/verify/route";

function request(body: string) {
  return new NextRequest("http://localhost/api/x402", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

const invalidBodies = [
  ["literal null", "null"],
  ["malformed JSON", "{"],
] as const;

describe.each([
  ["verify", verify],
  ["settle", settle],
] as const)("POST /api/x402/%s", (_name, handler) => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateRequest.mockResolvedValue({ valid: true });
  });

  it.each(invalidBodies)(
    "returns the missing-proof 400 for %s without payment work",
    async (_kind, body) => {
      const response = await handler(request(body));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Missing proof.buyer or proof.requirement.skillListingAddress",
      });
      expect(mocks.authenticateRequest).toHaveBeenCalledOnce();
      expect(mocks.verifyPaymentProof).not.toHaveBeenCalled();
      expect(mocks.verifyBaseX402PaymentPayload).not.toHaveBeenCalled();
      expect(mocks.loadBaseX402Skill).not.toHaveBeenCalled();
      expect(mocks.relayAndRecordBaseX402Purchase).not.toHaveBeenCalled();
      expect(mocks.hasChainUsdcPurchaseEntitlement).not.toHaveBeenCalled();
      expect(mocks.getX402SettlementEntitlement).not.toHaveBeenCalled();
      expect(mocks.claimX402SettlementAttempt).not.toHaveBeenCalled();
      expect(mocks.completeX402SettlementAttempt).not.toHaveBeenCalled();
      expect(mocks.failX402SettlementAttempt).not.toHaveBeenCalled();
    }
  );

  it("rejects an invalid Base skillDbId before listing or payment work", async () => {
    const response = await handler(
      request(
        JSON.stringify({
          skillDbId: "not-a-uuid",
          paymentPayload: {},
        })
      )
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid skillDbId",
    });
    expect(mocks.authenticateRequest).toHaveBeenCalledOnce();
    expect(mocks.verifyPaymentProof).not.toHaveBeenCalled();
    expect(mocks.verifyBaseX402PaymentPayload).not.toHaveBeenCalled();
    expect(mocks.loadBaseX402Skill).not.toHaveBeenCalled();
    expect(mocks.relayAndRecordBaseX402Purchase).not.toHaveBeenCalled();
    expect(mocks.hasChainUsdcPurchaseEntitlement).not.toHaveBeenCalled();
    expect(mocks.getX402SettlementEntitlement).not.toHaveBeenCalled();
    expect(mocks.claimX402SettlementAttempt).not.toHaveBeenCalled();
    expect(mocks.completeX402SettlementAttempt).not.toHaveBeenCalled();
    expect(mocks.failX402SettlementAttempt).not.toHaveBeenCalled();
  });
});
