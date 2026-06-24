import { afterEach, describe, expect, it } from "vitest";
import {
  ComputeBudgetProgram,
  Keypair,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  assertBuyerIsNotSponsor,
  assertSponsoredTransactionSignatures,
  getSponsoredCoreInstructions,
} from "@/lib/sponsoredPurchase";
import { bufferKoraTokenFee, getSponsoredSponsorMode } from "@/lib/koraSponsor";
import {
  SponsoredPurchaseError,
  encodeSignedTransaction,
  sponsoredCheckoutShouldRefreshBlockhash,
  sponsoredCheckoutShouldFallBack,
} from "@/lib/sponsoredPurchaseClient";
import { normalizeSponsoredRegisterAgentMetadataUri } from "@/lib/sponsoredRegisterAgent";

const ORIGINAL_SPONSOR_MODE = process.env.AGENTVOUCH_SPONSOR_MODE;

afterEach(() => {
  if (ORIGINAL_SPONSOR_MODE === undefined) {
    delete process.env.AGENTVOUCH_SPONSOR_MODE;
  } else {
    process.env.AGENTVOUCH_SPONSOR_MODE = ORIGINAL_SPONSOR_MODE;
  }
});

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

describe("Kora sponsor mode helpers", () => {
  it("defaults to the bespoke server sponsor and accepts explicit Kora mode", () => {
    delete process.env.AGENTVOUCH_SPONSOR_MODE;
    expect(getSponsoredSponsorMode()).toBe("bespoke");
    process.env.AGENTVOUCH_SPONSOR_MODE = "kora";
    expect(getSponsoredSponsorMode()).toBe("kora");
  });

  it("buffers Kora token fee quotes with ceiling rounding", () => {
    expect(bufferKoraTokenFee(200_000n, 0n)).toBe(200_000n);
    expect(bufferKoraTokenFee(100n, 200n)).toBe(102n);
    expect(bufferKoraTokenFee(101n, 200n)).toBe(104n);
  });
});

describe("sponsored transaction signatures", () => {
  function buildUserSignedTransaction() {
    const sponsor = Keypair.generate();
    const buyer = Keypair.generate();
    const recipient = Keypair.generate();
    const transaction = new Transaction({
      feePayer: sponsor.publicKey,
      recentBlockhash: "11111111111111111111111111111111",
    }).add(
      SystemProgram.transfer({
        fromPubkey: buyer.publicKey,
        toPubkey: recipient.publicKey,
        lamports: 0,
      })
    );
    transaction.partialSign(buyer);
    return { buyer, sponsor, transaction };
  }

  it("allows Kora submit transactions with only the user signature present", () => {
    const { sponsor, transaction } = buildUserSignedTransaction();
    expect(() =>
      assertSponsoredTransactionSignatures({
        transaction,
        sponsor: sponsor.publicKey,
        sponsorMode: "kora",
        label: "test transaction",
      })
    ).not.toThrow();
  });

  it("keeps bespoke submit transactions fully signed", () => {
    const { sponsor, transaction } = buildUserSignedTransaction();
    expect(() =>
      assertSponsoredTransactionSignatures({
        transaction,
        sponsor: sponsor.publicKey,
        sponsorMode: "bespoke",
        label: "test transaction",
      })
    ).toThrow(/missing signatures/i);
  });

  it("serializes partially signed legacy transactions for Kora submit", () => {
    const { buyer, sponsor, transaction } = buildUserSignedTransaction();
    const encoded = encodeSignedTransaction(transaction);
    const decoded = Transaction.from(Buffer.from(encoded, "base64"));
    const sponsorSignature = decoded.signatures.find((signature) =>
      signature.publicKey.equals(sponsor.publicKey)
    );
    const buyerSignature = decoded.signatures.find((signature) =>
      signature.publicKey.equals(buyer.publicKey)
    );
    expect(sponsorSignature?.signature).toBeNull();
    expect(buyerSignature?.signature).toBeTruthy();
  });

  it("strips Kora-mode ComputeBudget instructions before core validation", () => {
    const { transaction } = buildUserSignedTransaction();
    transaction.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 })
    );
    expect(
      getSponsoredCoreInstructions({
        transaction,
        sponsorMode: "kora",
        label: "test transaction",
      })
    ).toHaveLength(1);
    expect(
      getSponsoredCoreInstructions({
        transaction,
        sponsorMode: "bespoke",
        label: "test transaction",
      })
    ).toHaveLength(2);
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

describe("sponsoredCheckoutShouldRefreshBlockhash", () => {
  it("refreshes submit-phase blockhash expiry errors", () => {
    expect(
      sponsoredCheckoutShouldRefreshBlockhash(
        new SponsoredPurchaseError("Blockhash not found", 500, "submit")
      )
    ).toBe(true);
  });

  it("does not refresh generic submit failures", () => {
    expect(
      sponsoredCheckoutShouldRefreshBlockhash(
        new SponsoredPurchaseError("Simulation failed", 500, "submit")
      )
    ).toBe(false);
  });

  it("does not refresh prepare failures", () => {
    expect(
      sponsoredCheckoutShouldRefreshBlockhash(
        new SponsoredPurchaseError("Blockhash not found", 500, "prepare")
      )
    ).toBe(false);
  });
});

describe("normalizeSponsoredRegisterAgentMetadataUri", () => {
  it("defaults missing metadata to an empty URI", () => {
    expect(normalizeSponsoredRegisterAgentMetadataUri(null)).toBe("");
    expect(normalizeSponsoredRegisterAgentMetadataUri(undefined)).toBe("");
  });

  it("accepts metadata URIs up to the on-chain byte limit", () => {
    const uri = "a".repeat(200);
    expect(normalizeSponsoredRegisterAgentMetadataUri(uri)).toBe(uri);
  });

  it("rejects metadata URIs over the on-chain byte limit", () => {
    expect(() =>
      normalizeSponsoredRegisterAgentMetadataUri("a".repeat(201))
    ).toThrow(/at most 200 bytes/i);
  });
});
