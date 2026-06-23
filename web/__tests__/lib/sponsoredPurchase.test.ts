import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { assertBuyerIsNotSponsor } from "@/lib/sponsoredPurchase";
import {
  SponsoredPurchaseError,
  sponsoredCheckoutShouldFallBack,
} from "@/lib/sponsoredPurchaseClient";

describe("assertBuyerIsNotSponsor", () => {
  it("rejects a buyer that equals the sponsor (self-deal fund-drain guard)", () => {
    // If buyer == sponsor, the buyer/rent_payer/fee_payer signer slots collapse
    // onto one key and the server's partialSign fully signs the transaction.
    const sponsor = Keypair.generate().publicKey;
    expect(() => assertBuyerIsNotSponsor(sponsor, sponsor)).toThrow(
      /must not be the sponsor/i
    );
  });

  it("allows a distinct buyer", () => {
    const buyer = Keypair.generate().publicKey;
    const sponsor = Keypair.generate().publicKey;
    expect(() => assertBuyerIsNotSponsor(buyer, sponsor)).not.toThrow();
  });
});

describe("sponsoredCheckoutShouldFallBack", () => {
  it("falls back on prepare-phase failures (nothing hit the chain)", () => {
    expect(
      sponsoredCheckoutShouldFallBack(
        new SponsoredPurchaseError(
          "Buyer USDC balance is below price plus setup fee",
          409,
          "prepare"
        )
      )
    ).toBe(true);
  });

  it("does not fall back on a generic submit-phase failure (avoid double-submit)", () => {
    expect(
      sponsoredCheckoutShouldFallBack(
        new SponsoredPurchaseError(
          "Sponsored checkout simulation failed",
          500,
          "submit"
        )
      )
    ).toBe(false);
  });

  it("falls back on a submit-phase 'not enabled' failure", () => {
    expect(
      sponsoredCheckoutShouldFallBack(
        new SponsoredPurchaseError(
          "Sponsored checkout is not enabled",
          400,
          "submit"
        )
      )
    ).toBe(true);
  });

  it("propagates non-sponsored errors (e.g. a wallet rejection)", () => {
    expect(sponsoredCheckoutShouldFallBack(new Error("User rejected"))).toBe(
      false
    );
  });
});
