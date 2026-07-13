import { describe, expect, it } from "vitest";
import { getExpectedBaseCurrency } from "@/lib/adapters/baseListing";
import { BASE_NATIVE_USDC_ADDRESS } from "@/lib/adapters/baseConfig";
import { isSameSkillRawUri } from "@/lib/baseListingVerification";

// Why Base paid rows must persist currency_mint = null rather than the configured Solana mint
// (PR #74 P1). getExpectedBaseCurrency runs inside the baseListing PATCH's verifyBaseSkillListing;
// a non-EVM currency_mint throws before the repair UPDATE, orphaning the on-chain listing.

const CONFIGURED = BASE_NATIVE_USDC_ADDRESS;
const NATIVE = BASE_NATIVE_USDC_ADDRESS;
const SOLANA_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // Solana USDC mint

describe("getExpectedBaseCurrency", () => {
  it("treats a null currency_mint as native Base USDC (the Phase 8a Base paid default)", () => {
    expect(
      getExpectedBaseCurrency({
        skill: { currency_mint: null },
        configuredUsdc: CONFIGURED,
        nativeUsdc: NATIVE,
        usage: "listings",
      })
    ).toBe(NATIVE);
  });

  it("accepts an explicit native USDC currency_mint", () => {
    expect(
      getExpectedBaseCurrency({
        skill: { currency_mint: NATIVE },
        configuredUsdc: CONFIGURED,
        nativeUsdc: NATIVE,
        usage: "listings",
      })
    ).toBe(NATIVE);
  });

  it("throws on a Solana-mint currency_mint — the exact PR #74 P1 failure", () => {
    // If the POST route had stamped the Base row with the configured Solana mint, this is the
    // throw that broke the link. The route fix (null default) is what prevents reaching here.
    expect(() =>
      getExpectedBaseCurrency({
        skill: { currency_mint: SOLANA_MINT },
        configuredUsdc: CONFIGURED,
        nativeUsdc: NATIVE,
        usage: "listings",
      })
    ).toThrow(/valid EVM address/i);
  });
});

describe("isSameSkillRawUri", () => {
  it("accepts the same raw skill path across hosts for relink repair", () => {
    expect(
      isSameSkillRawUri({
        actual: "http://localhost:3001/api/skills/uuid-skill-1/raw",
        expected: "https://agentvouch.xyz/api/skills/uuid-skill-1/raw",
      })
    ).toBe(true);
  });

  it("rejects a raw URI for a different skill", () => {
    expect(
      isSameSkillRawUri({
        actual: "http://localhost:3001/api/skills/uuid-skill-2/raw",
        expected: "https://agentvouch.xyz/api/skills/uuid-skill-1/raw",
      })
    ).toBe(false);
  });
});
