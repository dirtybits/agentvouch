import { describe, expect, it } from "vitest";

import { normalizeBasePurchaseTuple } from "@/lib/basePurchaseVerification";

const BUYER = "0x3fc722ba956f17b521087984F2c5c0BA47Df3c6B";
const LISTING_ID =
  "0x9987077f66345ab282f7698aa90b486787fe3043f880d9f18556bca5ec2fd89e";

describe("Base purchase receipt tuple normalization", () => {
  it("accepts viem positional tuple results", () => {
    const receipt = normalizeBasePurchaseTuple([
      true,
      BUYER,
      LISTING_ID,
      2n,
      1_000_000n,
      600_000n,
      400_000n,
      1_783_000_000n,
    ]);

    expect(receipt.exists).toBe(true);
    expect(receipt.buyer).toBe(BUYER);
    expect(receipt.listingId).toBe(LISTING_ID);
    expect(receipt.revision).toBe(2n);
    expect(receipt.priceUsdcMicros).toBe(1_000_000n);
  });

  it("accepts named tuple results", () => {
    const receipt = normalizeBasePurchaseTuple({
      exists: true,
      buyer: BUYER,
      listingId: LISTING_ID,
      revision: 3n,
      priceUsdcMicros: 1_000_000n,
      authorShareUsdcMicros: 600_000n,
      voucherPoolUsdcMicros: 400_000n,
      timestamp: 1_783_000_001n,
    });

    expect(receipt.exists).toBe(true);
    expect(receipt.buyer).toBe(BUYER);
    expect(receipt.listingId).toBe(LISTING_ID);
    expect(receipt.revision).toBe(3n);
    expect(receipt.priceUsdcMicros).toBe(1_000_000n);
  });
});
