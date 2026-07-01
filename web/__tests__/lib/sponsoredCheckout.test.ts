import { describe, expect, it } from "vitest";
import {
  quoteSponsoredCheckoutSetupFee,
  parseSponsoredCheckoutMicroUsdcPerSol,
} from "@/lib/sponsoredCheckout";

describe("sponsored checkout quote", () => {
  it("converts lamport rent and fees to a buffered micro-USDC setup fee", () => {
    const quote = quoteSponsoredCheckoutSetupFee({
      rentLamports: 2_000_000n,
      transactionFeeLamports: 5_000n,
      microUsdcPerSol: 150_000_000n,
      bufferBps: 2_000n,
    });

    expect(quote.baseLamports).toBe(2_005_000n);
    expect(quote.bufferedLamports).toBe(2_406_000n);
    expect(quote.setupFeeUsdcMicros).toBe(360_900n);
    expect(quote.capped).toBe(false);
  });

  it("caps the buyer-facing fee without changing the underlying lamport estimate", () => {
    const quote = quoteSponsoredCheckoutSetupFee({
      rentLamports: 10_000_000n,
      microUsdcPerSol: 200_000_000n,
      capUsdcMicros: 1_000_000n,
    });

    expect(quote.bufferedLamports).toBe(12_000_000n);
    expect(quote.setupFeeUsdcMicros).toBe(1_000_000n);
    expect(quote.capped).toBe(true);
  });

  it("rejects missing or invalid configured SOL/USDC price", () => {
    expect(() => parseSponsoredCheckoutMicroUsdcPerSol(undefined)).toThrow(
      /required/
    );
    expect(() => parseSponsoredCheckoutMicroUsdcPerSol("0")).toThrow(
      /positive/
    );
    expect(parseSponsoredCheckoutMicroUsdcPerSol("150000000")).toBe(
      150_000_000n
    );
  });
});
