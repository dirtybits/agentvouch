import { describe, expect, it } from "vitest";

import { formatUsdcMicrosValue, usdcToMicros } from "@/lib/agentvouchUsdc";

// Behavioral tests for the money-conversion helpers in agentvouchUsdc.
//
// These two functions sit on every USDC amount a user sees and every USDC
// micro-amount the app converts between the human decimal world and the
// on-chain 6-decimal micro-unit. A subtle rounding bug here corrupts
// displayed balances, purchase amounts, and (in the conversion direction)
// the on-chain transfer amount, so the assertions pin the exact observed
// behavior rather than just the shape of the output.
//
// All values below were confirmed against the implementation (probe run
// 2026-10-13). If the implementation changes, update these expectations
// deliberately and in the same PR.

describe("usdcToMicros", () => {
  it("converts 0 to 0 micros", () => {
    expect(usdcToMicros(0)).toBe(0n);
  });

  it("converts whole and fractional USDC to 6-decimal micros", () => {
    expect(usdcToMicros(1)).toBe(1_000_000n);
    expect(usdcToMicros(0.01)).toBe(10_000n);
    expect(usdcToMicros(0.1)).toBe(100_000n);
    expect(usdcToMicros(12345.6789)).toBe(12_345_678_900n);
  });

  it("rounds amounts with more than 6 decimals to the nearest micro", () => {
    // 0.0000005 is exactly halfway between 0 and 1 micro; Math.round
    // (and thus usdcToMicros) rounds 0.5 up.
    expect(usdcToMicros(0.0000005)).toBe(1n);
    // 0.0000004 is below the halfway point and truncates toward 0.
    expect(usdcToMicros(0.0000004)).toBe(0n);
    // 1.23456789 -> 1,234,568 micros (the 7th+ decimal rounds the 6th).
    expect(usdcToMicros(1.23456789)).toBe(1_234_568n);
  });

  it("collapses tiny positive sub-micro values to 0 micros", () => {
    expect(usdcToMicros(0.0000000000001)).toBe(0n);
  });

  it("rejects non-finite and negative amounts with a clear error", () => {
    expect(() => usdcToMicros(-0.01)).toThrow(
      "USDC amount must be a non-negative number"
    );
    expect(() => usdcToMicros(NaN)).toThrow(
      "USDC amount must be a non-negative number"
    );
    expect(() => usdcToMicros(Infinity)).toThrow(
      "USDC amount must be a non-negative number"
    );
    expect(() => usdcToMicros(-Infinity)).toThrow(
      "USDC amount must be a non-negative number"
    );
  });
});

describe("formatUsdcMicrosValue", () => {
  it("returns a zero-formatted string when the value is missing", () => {
    expect(formatUsdcMicrosValue(null)).toBe("0.00");
    expect(formatUsdcMicrosValue(undefined)).toBe("0.00");
  });

  it("formats bigint, number, and string inputs identically", () => {
    // Same micro-amount from three input types must render the same.
    expect(formatUsdcMicrosValue(1_000_000n)).toBe("1.00");
    expect(formatUsdcMicrosValue(1_000_000)).toBe("1.00");
    expect(formatUsdcMicrosValue("1000000")).toBe("1.00");
  });

  it("formats whole and fractional amounts with at least 2 decimals", () => {
    expect(formatUsdcMicrosValue(0n)).toBe("0.00");
    expect(formatUsdcMicrosValue(10_000n)).toBe("0.01");
    expect(formatUsdcMicrosValue(1_500_000n)).toBe("1.50");
  });

  it("uses the full 6-decimal precision when the amount needs it", () => {
    // A value with up to six decimals is rendered in full.
    expect(formatUsdcMicrosValue(999_999n)).toBe("0.999999");
    expect(formatUsdcMicrosValue(12_345_678n)).toBe("12.345678");
    // Values larger than a few USDC keep two decimals plus grouping.
    expect(formatUsdcMicrosValue(1_000_000_000_000n)).toBe("1,000,000.00");
  });

  it("honors the minimumFractionDigits override", () => {
    // More decimals are always shown when requested.
    expect(formatUsdcMicrosValue(10_000n, 4)).toBe("0.0100");
    expect(formatUsdcMicrosValue(10_000n, 6)).toBe("0.010000");
    // Zero decimals drops trailing precision.
    expect(formatUsdcMicrosValue(1_500_000n, 0)).toBe("1.5");
  });
});
