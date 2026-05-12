import { address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  assessPurchasePreflight,
  PURCHASE_FEE_BUFFER_LAMPORTS,
  serializePurchasePreflight,
  type PurchasePreflightContext,
} from "@/lib/purchasePreflight";

const PURCHASE_RENT_LAMPORTS = 1_510_320n;
const SYSTEM_RENT_LAMPORTS = 890_880n;
const AUTHOR = address("2DGYWtztLvPB6GxgGXT16gjCoEf56jEmwSxjMwK21Pg3");
const BUYER = address("asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw");
const BUYER_USDC = address("7dHbWXmci3dT7Hcq2UYGfWYJ7Zdn4cUrAEZHbmVQSNhz");

function createContext({
  buyerBalanceLamports = 10_000_000n,
  buyerUsdcBalanceMicros = 10_000_000n,
  buyerUsdcAccountExists = true,
  authorBalanceLamports = 0n,
}: {
  buyerBalanceLamports?: bigint;
  buyerUsdcBalanceMicros?: bigint | null;
  buyerUsdcAccountExists?: boolean | null;
  authorBalanceLamports?: bigint;
}): PurchasePreflightContext {
  return {
    buyer: BUYER,
    buyerUsdcAccount: buyerUsdcAccountExists ? BUYER_USDC : null,
    buyerUsdcBalanceMicros,
    buyerUsdcAccountExists,
    buyerBalanceLamports,
    purchaseRentLamports: PURCHASE_RENT_LAMPORTS,
    systemAccountRentExemptLamports: SYSTEM_RENT_LAMPORTS,
    authorBalanceLamportsByAddress: new Map([
      [String(AUTHOR), authorBalanceLamports],
    ]),
  };
}

describe("purchase preflight", () => {
  it("treats free listings as immediately purchasable", () => {
    const result = assessPurchasePreflight({
      context: createContext({}),
      priceUsdcMicros: 0n,
      author: AUTHOR,
    });

    expect(result.purchasePreflightStatus).toBe("ok");
    expect(result.estimatedBuyerTotalLamports).toBe(0n);
    expect(result.purchasePreflightMessage).toBeNull();
  });

  it("accepts a USDC listing when buyer has enough USDC and SOL for receipt rent", () => {
    const result = assessPurchasePreflight({
      context: createContext({
        buyerBalanceLamports: 5_000_000n,
        buyerUsdcBalanceMicros: 2_000_000n,
      }),
      priceUsdcMicros: 1_000_000n,
      author: AUTHOR,
      authorBackingUsdcMicros: 5_000_000n,
    });

    expect(result.purchasePreflightStatus).toBe("ok");
    expect(result.estimatedBuyerTotalLamports).toBe(
      PURCHASE_RENT_LAMPORTS + PURCHASE_FEE_BUFFER_LAMPORTS
    );
  });

  it("accepts a paid listing when author self-stake is the only backing", () => {
    const result = assessPurchasePreflight({
      context: createContext({
        buyerBalanceLamports: 5_000_000n,
        buyerUsdcBalanceMicros: 2_000_000n,
      }),
      priceUsdcMicros: 1_000_000n,
      author: AUTHOR,
      authorBackingUsdcMicros: 1_000_000n,
    });

    expect(result.purchasePreflightStatus).toBe("ok");
  });

  it("blocks a paid protocol listing when the author has no active backing", () => {
    const result = assessPurchasePreflight({
      context: createContext({
        buyerBalanceLamports: 50_000_000n,
        buyerUsdcBalanceMicros: 2_000_000n,
      }),
      priceUsdcMicros: 1_000_000n,
      author: AUTHOR,
      authorBackingUsdcMicros: 0n,
    });

    expect(result.purchasePreflightStatus).toBe("authorMissingBacking");
    expect(result.purchasePreflightMessage).toBe(
      "This author needs active vouch backing or author self-stake before paid purchases are available."
    );

    const serialized = serializePurchasePreflight(result);
    expect(serialized.purchaseBlocked).toBe(true);
    expect(serialized.purchaseBlockError).toEqual({
      code: "authorMissingBacking",
      message: result.purchasePreflightMessage,
    });
  });

  it("blocks a USDC listing when buyer has no USDC token account", () => {
    const result = assessPurchasePreflight({
      context: createContext({
        buyerBalanceLamports: 50_000_000n,
        buyerUsdcBalanceMicros: null,
        buyerUsdcAccountExists: false,
      }),
      priceUsdcMicros: 1_000_000n,
      author: AUTHOR,
    });

    expect(result.purchasePreflightStatus).toBe("buyerMissingUsdcAccount");
    expect(result.purchasePreflightMessage).toContain(
      "does not have a USDC associated token account"
    );

    const serialized = serializePurchasePreflight(result);
    expect(serialized.purchaseBlocked).toBe(true);
    expect(serialized.purchaseBlockError).toEqual({
      code: "buyerMissingUsdcAccount",
      message: result.purchasePreflightMessage,
    });
  });

  it("blocks a USDC listing when buyer has insufficient USDC", () => {
    const result = assessPurchasePreflight({
      context: createContext({
        buyerBalanceLamports: 50_000_000n,
        buyerUsdcBalanceMicros: 500_000n,
      }),
      priceUsdcMicros: 1_000_000n,
      author: AUTHOR,
    });

    expect(result.purchasePreflightStatus).toBe("buyerInsufficientBalance");
    expect(result.purchasePreflightMessage).toContain("USDC available");
  });
});
