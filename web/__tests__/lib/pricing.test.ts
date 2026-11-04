import { describe, expect, it } from "vitest";
import {
  formatMinPrice,
  formatUsdcMicros,
  getMinPriceLamports,
  isValidListingPriceLamports,
  isValidListingPriceMicros,
  toLamports,
  toUsdcMicros,
} from "@/lib/pricing";

describe("pricing", () => {
  describe("formatMinPrice", () => {
    it("returns the USDC floor with the USDC symbol", () => {
      expect(formatMinPrice("USDC")).toBe("0.01 USDC");
    });

    it("returns the SOL floor with the SOL symbol", () => {
      expect(formatMinPrice("SOL")).toBe("0.001 SOL");
    });

    it("defaults to USDC when no currency is supplied", () => {
      expect(formatMinPrice()).toBe("0.01 USDC");
    });
  });

  describe("toUsdcMicros", () => {
    it("converts dollars to 6-decimal micro-units", () => {
      expect(toUsdcMicros(0.01)).toBe(10_000);
      expect(toUsdcMicros(0.1)).toBe(100_000);
      expect(toUsdcMicros(1)).toBe(1_000_000);
      expect(toUsdcMicros(0.000001)).toBe(1);
    });
  });

  describe("toLamports", () => {
    it("converts SOL to 9-decimal lamports", () => {
      expect(toLamports(0.001)).toBe(1_000_000);
      expect(toLamports(1)).toBe(1_000_000_000);
    });
  });

  describe("getMinPriceLamports", () => {
    it("reports the USDC listing floor in micro-units", () => {
      expect(getMinPriceLamports("USDC")).toBe(10_000);
      expect(getMinPriceLamports()).toBe(10_000);
    });

    it("reports the SOL listing floor in lamports", () => {
      expect(getMinPriceLamports("SOL")).toBe(1_000_000);
    });
  });

  describe("isValidListingPriceMicros", () => {
    it("accepts a zero-price free listing", () => {
      expect(isValidListingPriceMicros(0)).toBe(true);
    });

    it("rejects sub-floor micro-unit values", () => {
      expect(isValidListingPriceMicros(9_999)).toBe(false);
      expect(isValidListingPriceMicros(-1)).toBe(false);
    });

    it("accepts the floor and above", () => {
      expect(isValidListingPriceMicros(10_000)).toBe(true);
      expect(isValidListingPriceMicros(1_000_000)).toBe(true);
    });

    it("rejects non-finite input", () => {
      expect(isValidListingPriceMicros(NaN)).toBe(false);
      expect(isValidListingPriceMicros(Infinity)).toBe(false);
      expect(isValidListingPriceMicros(-Infinity)).toBe(false);
    });

    it("rejects fractional atomic-unit values", () => {
      expect(isValidListingPriceMicros(10_000.5)).toBe(false);
    });
  });

  describe("isValidListingPriceLamports", () => {
    it("accepts a zero-price free listing in the chosen currency", () => {
      expect(isValidListingPriceLamports(0, "USDC")).toBe(true);
      expect(isValidListingPriceLamports(0, "SOL")).toBe(true);
    });

    it("applies the USDC micro-unit floor to USDC values", () => {
      expect(isValidListingPriceLamports(9_999, "USDC")).toBe(false);
      expect(isValidListingPriceLamports(10_000, "USDC")).toBe(true);
    });

    it("applies the SOL lamport floor to SOL values", () => {
      expect(isValidListingPriceLamports(999_999, "SOL")).toBe(false);
      expect(isValidListingPriceLamports(1_000_000, "SOL")).toBe(true);
    });

    it("rejects non-finite input", () => {
      expect(isValidListingPriceLamports(NaN, "USDC")).toBe(false);
      expect(isValidListingPriceLamports(Infinity, "SOL")).toBe(false);
    });

    it("rejects fractional atomic-unit values for both currencies", () => {
      expect(isValidListingPriceLamports(10_000.5, "USDC")).toBe(false);
      expect(isValidListingPriceLamports(1_000_000.5, "SOL")).toBe(false);
    });
  });

  describe("formatUsdcMicros", () => {
    it("returns null for missing or zero values", () => {
      expect(formatUsdcMicros(null)).toBeNull();
      expect(formatUsdcMicros(undefined)).toBeNull();
      expect(formatUsdcMicros(0)).toBeNull();
      expect(formatUsdcMicros(0n)).toBeNull();
      expect(formatUsdcMicros("")).toBeNull();
    });

    it("formats whole-dollar and whole-micro amounts without trailing cents", () => {
      expect(formatUsdcMicros("10000")).toBe("0.01");
      expect(formatUsdcMicros("100000")).toBe("0.10");
      expect(formatUsdcMicros("1000000")).toBe("1");
    });

    it("formats sub-micro amounts with up to six decimals", () => {
      expect(formatUsdcMicros("123456")).toBe("0.123456");
      expect(formatUsdcMicros("500")).toBe("0.0005");
      expect(formatUsdcMicros("10")).toBe("0.00001");
    });

    it("accepts bigint micro-units and number inputs", () => {
      expect(formatUsdcMicros(1_000_000n)).toBe("1");
      expect(formatUsdcMicros(123_456)).toBe("0.123456");
    });

    it("returns null when the micro-unit value cannot be parsed as an integer", () => {
      expect(formatUsdcMicros("abc")).toBeNull();
      // BigInt("1.5e3") throws: exponential / fractional inputs are rejected.
      expect(formatUsdcMicros("1.5e3")).toBeNull();
      // A fractional number of micro-units is truncated by BigInt to zero -> null.
      expect(formatUsdcMicros(0.01)).toBeNull();
    });
    it("formats whole, fractional, and sub-cent USDC amounts", () => {
      expect(formatUsdcMicros("1000000")).toBe("1");
      expect(formatUsdcMicros("1500000")).toBe("1.50");
      expect(formatUsdcMicros("100000")).toBe("0.10");
      expect(formatUsdcMicros("1")).toBe("0.000001");
    });

    it("preserves every micro-unit above Number's safe integer range", () => {
      expect(formatUsdcMicros("9007199254740993")).toBe("9,007,199,254.740993");
      expect(formatUsdcMicros(9007199254740993n)).toBe("9,007,199,254.740993");
    });

    it("returns null for missing or non-integer values", () => {
      expect(formatUsdcMicros(null)).toBeNull();
      expect(formatUsdcMicros("not-a-number")).toBeNull();
      expect(formatUsdcMicros("1.5")).toBeNull();
    });
  });
});
