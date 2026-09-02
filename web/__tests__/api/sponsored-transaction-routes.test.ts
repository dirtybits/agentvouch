import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const transactionMocks = vi.hoisted(() => ({
  prepareSponsoredPurchase: vi.fn(),
  submitSponsoredPurchase: vi.fn(),
  prepareSponsoredRegisterAgent: vi.fn(),
  submitSponsoredRegisterAgent: vi.fn(),
}));

vi.mock("@/lib/sponsoredPurchase", () => ({
  prepareSponsoredPurchase: transactionMocks.prepareSponsoredPurchase,
  submitSponsoredPurchase: transactionMocks.submitSponsoredPurchase,
}));
vi.mock("@/lib/sponsoredRegisterAgent", () => ({
  prepareSponsoredRegisterAgent: transactionMocks.prepareSponsoredRegisterAgent,
  submitSponsoredRegisterAgent: transactionMocks.submitSponsoredRegisterAgent,
}));

import { POST as preparePurchase } from "@/app/api/transactions/sponsored/purchase/prepare/route";
import { POST as submitPurchase } from "@/app/api/transactions/sponsored/purchase/submit/route";
import { POST as prepareRegistration } from "@/app/api/transactions/sponsored/register-agent/prepare/route";
import { POST as submitRegistration } from "@/app/api/transactions/sponsored/register-agent/submit/route";

function nullJsonRequest(path: string, clientIp: string) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": clientIp,
    },
    body: "null",
  });
}

describe("sponsored transaction routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a null purchase-prepare body before preparing a transaction", async () => {
    const response = await preparePurchase(
      nullJsonRequest(
        "/api/transactions/sponsored/purchase/prepare",
        "198.51.100.1"
      )
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "buyerPubkey and listingAddress are required",
    });
    expect(transactionMocks.prepareSponsoredPurchase).not.toHaveBeenCalled();
  });

  it("rejects overflowing numeric micro-USDC fields before preparing a transaction", async () => {
    for (const [field, error] of [
      ["expectedPriceUsdcMicros", "Invalid expectedPriceUsdcMicros"],
      ["maxSetupFeeUsdcMicros", "Invalid maxSetupFeeUsdcMicros"],
    ]) {
      const response = await preparePurchase(
        new NextRequest(
          "http://localhost/api/transactions/sponsored/purchase/prepare",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Forwarded-For": "198.51.100.5",
            },
            body: `{"buyerPubkey":"buyer","listingAddress":"listing","${field}":1e309}`,
          }
        )
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error });
      expect(transactionMocks.prepareSponsoredPurchase).not.toHaveBeenCalled();
    }
  });

  it("rejects a null purchase-submit body before submitting a transaction", async () => {
    const response = await submitPurchase(
      nullJsonRequest(
        "/api/transactions/sponsored/purchase/submit",
        "198.51.100.2"
      )
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "signedTransaction is required",
    });
    expect(transactionMocks.submitSponsoredPurchase).not.toHaveBeenCalled();
  });

  it("rejects a null registration-prepare body before preparing a transaction", async () => {
    const response = await prepareRegistration(
      nullJsonRequest(
        "/api/transactions/sponsored/register-agent/prepare",
        "198.51.100.3"
      )
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "authorityPubkey is required",
    });
    expect(
      transactionMocks.prepareSponsoredRegisterAgent
    ).not.toHaveBeenCalled();
  });

  it("rejects a null registration-submit body before submitting a transaction", async () => {
    const response = await submitRegistration(
      nullJsonRequest(
        "/api/transactions/sponsored/register-agent/submit",
        "198.51.100.4"
      )
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "signedTransaction is required",
    });
    expect(
      transactionMocks.submitSponsoredRegisterAgent
    ).not.toHaveBeenCalled();
  });
});
