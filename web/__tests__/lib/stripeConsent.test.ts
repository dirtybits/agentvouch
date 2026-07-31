import { describe, expect, it } from "vitest";
import {
  buildCardRecourseConsentKey,
  hasCurrentCardRecourseConsent,
} from "@/lib/stripeConsent";

describe("card recourse consent identity binding", () => {
  it("invalidates consent when the buyer account, wallet, chain, or skill changes", () => {
    const accepted = buildCardRecourseConsentKey({
      skillDbId: "skill-a",
      buyerAccountId: "account-a",
    });

    expect(hasCurrentCardRecourseConsent(accepted, accepted)).toBe(true);
    expect(
      hasCurrentCardRecourseConsent(
        accepted,
        buildCardRecourseConsentKey({
          skillDbId: "skill-a",
          buyerAccountId: "account-b",
        })
      )
    ).toBe(false);
    expect(
      hasCurrentCardRecourseConsent(
        accepted,
        buildCardRecourseConsentKey({
          skillDbId: "skill-b",
          buyerAccountId: "account-a",
        })
      )
    ).toBe(false);

    const walletAccepted = buildCardRecourseConsentKey({
      skillDbId: "skill-a",
      walletChainContext: "eip155:84532",
      walletAddress: "0xabc",
    });
    expect(
      hasCurrentCardRecourseConsent(
        walletAccepted,
        buildCardRecourseConsentKey({
          skillDbId: "skill-a",
          walletChainContext: "solana:devnet",
          walletAddress: "0xabc",
        })
      )
    ).toBe(false);
    expect(
      hasCurrentCardRecourseConsent(
        walletAccepted,
        buildCardRecourseConsentKey({
          skillDbId: "skill-a",
          walletChainContext: "eip155:84532",
          walletAddress: "0xdef",
        })
      )
    ).toBe(false);
  });

  it("fails closed without a stable current identity", () => {
    expect(
      buildCardRecourseConsentKey({
        skillDbId: "skill-a",
        walletAddress: "0xabc",
      })
    ).toBeNull();
    expect(hasCurrentCardRecourseConsent(null, null)).toBe(false);
  });
});
