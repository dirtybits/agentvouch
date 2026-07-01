import { describe, expect, it } from "vitest";
import { getSkillPaymentFlow } from "@/lib/listingContract";

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
});
