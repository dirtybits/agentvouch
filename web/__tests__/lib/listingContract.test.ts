import { describe, expect, it } from "vitest";
import {
  getSkillPaymentFlow,
  normalizeUsdcMicros,
  requiresPurchase,
} from "@/lib/listingContract";

describe("normalizeUsdcMicros", () => {
  it("accepts positive integer amounts as normalized digit strings", () => {
    expect(normalizeUsdcMicros("12345")).toBe("12345");
    expect(normalizeUsdcMicros(" 12345 ")).toBe("12345");
    expect(normalizeUsdcMicros(1000000)).toBe("1000000");
    expect(normalizeUsdcMicros("1000000")).toBe("1000000");
    expect(normalizeUsdcMicros(1_000_000)).toBe("1000000");
    // Leading zeros are preserved verbatim by the digit-string contract.
    expect(normalizeUsdcMicros("0123")).toBe("0123");
  });

  it("rejects null, undefined, empty, and zero amounts", () => {
    expect(normalizeUsdcMicros(null)).toBeNull();
    expect(normalizeUsdcMicros(undefined)).toBeNull();
    expect(normalizeUsdcMicros("")).toBeNull();
    expect(normalizeUsdcMicros("0")).toBeNull();
    expect(normalizeUsdcMicros("000")).toBeNull();
    expect(normalizeUsdcMicros(" 0  ")).toBeNull();
    expect(normalizeUsdcMicros(0)).toBeNull();
  });

  it("rejects negative and sign-bearing amounts", () => {
    expect(normalizeUsdcMicros("-5")).toBeNull();
    expect(normalizeUsdcMicros("-0")).toBeNull();
    expect(normalizeUsdcMicros("  -5 ")).toBeNull();
  });

  it("rejects fractional and scientific-notation amounts", () => {
    expect(normalizeUsdcMicros("1.5")).toBeNull();
    expect(normalizeUsdcMicros("1.0")).toBeNull();
    expect(normalizeUsdcMicros("100.00")).toBeNull();
    expect(normalizeUsdcMicros("1e3")).toBeNull();
    expect(normalizeUsdcMicros("1E3")).toBeNull();
  });

  it("rejects non-numeric, malformed, and mixed-type values", () => {
    expect(normalizeUsdcMicros("1_000")).toBeNull();
    expect(normalizeUsdcMicros("abc")).toBeNull();
    expect(normalizeUsdcMicros("12abc")).toBeNull();
    expect(normalizeUsdcMicros("0x10")).toBeNull();
    // JSON request bodies can carry booleans; the digit-string gate must
    // reject them at runtime even though the declared type excludes them.
    expect(normalizeUsdcMicros(true as unknown as number)).toBeNull();
    expect(normalizeUsdcMicros(false as unknown as number)).toBeNull();
    expect(normalizeUsdcMicros("  0  ")).toBeNull();
  });

  it("keeps arbitrarily large digit strings valid (micro-unit amounts)", () => {
    const big = "999999999999999999999999";
    expect(normalizeUsdcMicros(big)).toBe(big);
  });
});

describe("getSkillPaymentFlow", () => {
  it("marks paid repo skills without on-chain listings as listing-required", () => {
    expect(
      getSkillPaymentFlow({
        priceUsdcMicros: "1000000",
        onChainAddress: null,
      })
    ).toBe("listing-required");
  });

  it("keeps linked USDC listings on the direct purchase path", () => {
    expect(
      getSkillPaymentFlow({
        priceUsdcMicros: "1000000",
        onChainAddress: "ListingAddr1",
      })
    ).toBe("direct-purchase-skill");
  });

  it("keeps linked Base listings on the direct purchase path", () => {
    expect(
      getSkillPaymentFlow({
        priceUsdcMicros: "1000000",
        onChainAddress: null,
        evmListingId:
          "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      })
    ).toBe("direct-purchase-skill");
  });

  it("treats zero or invalid prices as free even when a listing is linked", () => {
    // A linked listing with no valid price must fall through to free rather than
    // silently gating the content as paid.
    expect(
      getSkillPaymentFlow({ priceUsdcMicros: "0", onChainAddress: "A" })
    ).toBe("free");
    expect(
      getSkillPaymentFlow({
        priceUsdcMicros: " 0 ",
        onChainAddress: "A",
      })
    ).toBe("free");
    expect(
      getSkillPaymentFlow({
        priceUsdcMicros: "-5",
        onChainAddress: "A",
      })
    ).toBe("free");
    expect(
      getSkillPaymentFlow({
        priceUsdcMicros: "1.5",
        onChainAddress: "A",
      })
    ).toBe("free");
  });

  it("falls back to legacy SOL only when allowed and the lamports amount is positive", () => {
    expect(
      getSkillPaymentFlow({
        allowLegacySol: true,
        legacySolLamports: 5_000_000_000,
      })
    ).toBe("legacy-sol");
    // Zero lamports and disallowed legacy mode must stay free.
    expect(
      getSkillPaymentFlow({ allowLegacySol: true, legacySolLamports: 0 })
    ).toBe("free");
    expect(
      getSkillPaymentFlow({
        allowLegacySol: false,
        legacySolLamports: 5_000_000_000,
      })
    ).toBe("free");
  });

  it("returns free for unpriced skills with no legacy SOL amount", () => {
    expect(getSkillPaymentFlow({ priceUsdcMicros: null })).toBe("free");
  });
});

describe("requiresPurchase", () => {
  it("marks every non-free flow as purchase-required", () => {
    expect(requiresPurchase("listing-required")).toBe(true);
    expect(requiresPurchase("direct-purchase-skill")).toBe(true);
    expect(requiresPurchase("legacy-sol")).toBe(true);
    expect(requiresPurchase("x402-usdc")).toBe(true);
  });

  it("marks free as not purchase-required", () => {
    expect(requiresPurchase("free")).toBe(false);
  });
});
