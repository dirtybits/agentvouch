import { describe, expect, it } from "vitest";
import { parsePage, parseUsdcListingPrice } from "../src/cli.js";

// These validators sit behind real command options (`publish` / `update`
// `--price-usdc`, and `list --page`), so they guard money and pagination
// behavior. The USDC listing price encodes the 0.01 USDC paid-listing floor
// required by the protocol. `parseUsdcAmount` (vouch stakes) is covered in
// vouch.test.ts; these two siblings had no dedicated coverage.

describe("parseUsdcListingPrice", () => {
  it("accepts a free listing as 0 micro-USDC", () => {
    expect(parseUsdcListingPrice("0")).toBe("0");
    expect(parseUsdcListingPrice("0.000000")).toBe("0");
  });

  it("accepts prices at and above the 0.01 USDC floor", () => {
    expect(parseUsdcListingPrice("0.01")).toBe("10000");
    expect(parseUsdcListingPrice("0.0100")).toBe("10000");
    expect(parseUsdcListingPrice("0.1")).toBe("100000");
    expect(parseUsdcListingPrice("1")).toBe("1000000");
    expect(parseUsdcListingPrice("1.234567")).toBe("1234567");
  });

  it("accepts whitespace-padded values (trim)", () => {
    expect(parseUsdcListingPrice(" 0.01 ")).toBe("10000");
    expect(parseUsdcListingPrice(" 12 ")).toBe("12000000");
  });

  it("rejects a non-zero price below the 0.01 USDC floor", () => {
    expect(() => parseUsdcListingPrice("0.000001")).toThrow(
      /Expected 0 or at least 0\.01 USDC \(10000 micro-USDC\)\./
    );
    expect(() => parseUsdcListingPrice("0.009999")).toThrow(
      /Expected 0 or at least 0\.01 USDC \(10000 micro-USDC\)\./
    );
  });

  it("rejects malformed amounts with the 6-decimal format error", () => {
    const malformed = ["-0.01", "abc", "", "   ", "0.01.0", "1.2345678"];
    for (const input of malformed) {
      expect(() => parseUsdcListingPrice(input)).toThrow(
        /Expected a USDC amount with up to 6 decimals\./
      );
    }
  });
});

describe("parsePage", () => {
  it("accepts positive integer page numbers", () => {
    expect(parsePage("1")).toBe(1);
    expect(parsePage("3")).toBe(3);
    expect(parsePage("10")).toBe(10);
  });

  it("accepts whitespace-padded page numbers", () => {
    expect(parsePage("2 ")).toBe(2);
    expect(parsePage("  4  ")).toBe(4);
  });

  it("rejects zero and negative page numbers", () => {
    expect(() => parsePage("0")).toThrow(/Expected a positive page number\./);
    expect(() => parsePage("-1")).toThrow(/Expected a positive page number\./);
  });

  it("rejects empty or non-numeric page numbers", () => {
    expect(() => parsePage("")).toThrow(/Expected a positive page number\./);
    expect(() => parsePage("   ")).toThrow(/Expected a positive page number\./);
    expect(() => parsePage("abc")).toThrow(/Expected a positive page number\./);
  });

  it("truncates via parseInt (documented current behavior)", () => {
    // parseInt semantics: "9.5" -> 9, "1.9" -> 1, "3x" -> 3.
    // Assertions pin the current behavior so any future change is deliberate.
    expect(parsePage("9.5")).toBe(9);
    expect(parsePage("1.9")).toBe(1);
    expect(parsePage("3x")).toBe(3);
  });
});
