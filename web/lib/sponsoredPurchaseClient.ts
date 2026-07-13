"use client";

import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { decodeBase64, encodeBase64 } from "@/lib/base64";

export type ConnectorTransactionSigner = {
  address: string;
  signTransaction(transaction: unknown): Promise<unknown>;
};

type SponsoredTransactionDebug = {
  sponsorSignerPresent: boolean;
  sponsorSignaturePresent: boolean;
  requiredSignatures: number;
  presentSignatures: number;
};

type SponsoredPrepareResponse =
  | {
      transaction: string;
      encoding: "base64";
      quote: {
        priceUsdcMicros: string;
        setupFeeUsdcMicros: string;
      };
      accounts: {
        buyer: string;
        sponsor: string;
        skillListing: string;
        purchase: string;
      };
      debug: SponsoredTransactionDebug;
    }
  | { error: string };

type SponsoredSubmitResponse =
  | {
      signature: string;
      purchasePda: string;
      buyerPubkey: string;
      listingAddress: string;
      setupFeeUsdcMicros: string;
    }
  | { error: string };

export type SponsoredCheckoutPhase = "prepare" | "submit";

export class SponsoredPurchaseError extends Error {
  readonly status: number;
  readonly phase: SponsoredCheckoutPhase;

  constructor(message: string, status: number, phase: SponsoredCheckoutPhase) {
    super(message);
    this.name = "SponsoredPurchaseError";
    this.status = status;
    this.phase = phase;
  }
}

/**
 * Whether a failed sponsored checkout is safe to retry as a direct (self-pay)
 * purchase. `prepare`-phase failures never touched the chain, so falling back is
 * always safe (and fixes the gap where a buyer who could afford the price but
 * not the setup fee got a hard failure). A `submit`-phase failure may already
 * have landed on-chain, so we only fall back when the sponsor path was
 * explicitly unavailable — otherwise we surface the error to avoid a
 * double-submit. Non-sponsored errors (e.g. a wallet rejection) propagate.
 */
export function sponsoredCheckoutShouldFallBack(error: unknown): boolean {
  if (!(error instanceof SponsoredPurchaseError)) return false;
  if (error.phase === "prepare") return true;
  return /not enabled/i.test(error.message);
}

export function sponsoredCheckoutShouldRefreshBlockhash(
  error: unknown
): boolean {
  return (
    error instanceof SponsoredPurchaseError &&
    error.phase === "submit" &&
    /blockhash not found|block height exceeded|expired blockhash|transaction expired/i.test(
      error.message
    )
  );
}

export function confirmDirectPurchaseAfterSponsoredUnavailable(reason: string) {
  const message = [
    "Sponsored checkout is unavailable for this purchase.",
    reason ? `Reason: ${reason}` : "",
    "",
    "Use direct purchase instead?",
    "Direct purchase will ask your wallet to pay Solana network fees and rent in SOL.",
  ]
    .filter(Boolean)
    .join("\n");

  if (typeof window === "undefined" || !window.confirm(message)) {
    throw new Error(
      "Sponsored checkout unavailable; direct SOL-paying purchase was not confirmed"
    );
  }
}

function readResponseError(body: unknown, fallback: string) {
  return body &&
    typeof body === "object" &&
    "error" in body &&
    typeof (body as { error?: unknown }).error === "string"
    ? (body as { error: string }).error
    : fallback;
}

function formatUsdcMicros(micros: string | bigint) {
  const value = BigInt(micros);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${fraction.replace(/0+$/, "").padEnd(2, "0")}`;
}

function decodeBase64Transaction(serialized: string) {
  return Transaction.from(decodeBase64(serialized));
}

export function encodeSignedTransaction(transaction: unknown) {
  if (transaction instanceof Uint8Array) {
    return encodeBase64(transaction);
  }
  if (ArrayBuffer.isView(transaction)) {
    return encodeBase64(
      new Uint8Array(
        transaction.buffer,
        transaction.byteOffset,
        transaction.byteLength
      )
    );
  }
  if (
    transaction instanceof Transaction ||
    transaction instanceof VersionedTransaction
  ) {
    if (transaction instanceof Transaction) {
      return encodeBase64(
        transaction.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        })
      );
    }
    return encodeBase64(transaction.serialize());
  }
  if (
    transaction &&
    typeof transaction === "object" &&
    "signedTransaction" in transaction
  ) {
    return encodeSignedTransaction(
      (transaction as { signedTransaction?: unknown }).signedTransaction
    );
  }
  const maybeSerializable = transaction as { serialize?: () => Uint8Array };
  if (typeof maybeSerializable?.serialize === "function") {
    return encodeBase64(maybeSerializable.serialize());
  }
  throw new Error("Wallet returned an unsupported signed transaction format");
}

export function sponsoredCheckoutPubliclyEnabled() {
  return (
    process.env.NEXT_PUBLIC_AGENTVOUCH_SPONSORED_CHECKOUT_ENABLED === "1" ||
    process.env.NEXT_PUBLIC_AGENTVOUCH_SPONSORED_CHECKOUT_ENABLED?.toLowerCase() ===
      "true"
  );
}

export async function purchaseSkillWithSponsoredCheckout(input: {
  signer: ConnectorTransactionSigner;
  listingAddress: string;
  expectedPriceUsdcMicros: bigint | string | number;
  expectedUsdcMint: string;
}) {
  const prepare = async () => {
    const prepareResponse = await fetch(
      "/api/transactions/sponsored/purchase/prepare",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyerPubkey: input.signer.address,
          listingAddress: input.listingAddress,
          expectedPriceUsdcMicros: input.expectedPriceUsdcMicros.toString(),
          expectedUsdcMint: input.expectedUsdcMint,
        }),
      }
    );
    const prepareBody = (await prepareResponse
      .json()
      .catch(() => null)) as SponsoredPrepareResponse | null;
    if (!prepareResponse.ok || !prepareBody || "error" in prepareBody) {
      throw new SponsoredPurchaseError(
        readResponseError(prepareBody, "Sponsored checkout prepare failed"),
        prepareResponse.status,
        "prepare"
      );
    }
    return prepareBody;
  };

  let prepareBody = await prepare();
  let confirmed = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (
      !confirmed &&
      typeof window !== "undefined" &&
      prepareBody.quote.setupFeeUsdcMicros
    ) {
      const setupFee = BigInt(prepareBody.quote.setupFeeUsdcMicros);
      const message =
        setupFee > 0n
          ? `Pay ${formatUsdcMicros(
              prepareBody.quote.priceUsdcMicros
            )} USDC plus a ${formatUsdcMicros(
              setupFee
            )} USDC sponsored checkout setup fee?`
          : `Pay ${formatUsdcMicros(
              prepareBody.quote.priceUsdcMicros
            )} USDC with sponsored checkout?`;
      if (!window.confirm(message)) {
        throw new Error("Sponsored checkout cancelled before signing");
      }
      confirmed = true;
    }

    const unsignedTransaction = decodeBase64Transaction(
      prepareBody.transaction
    );
    const signed = await input.signer.signTransaction(unsignedTransaction);
    const signedTransaction = encodeSignedTransaction(signed);
    const submitResponse = await fetch(
      "/api/transactions/sponsored/purchase/submit",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signedTransaction }),
      }
    );
    const submitBody = (await submitResponse
      .json()
      .catch(() => null)) as SponsoredSubmitResponse | null;
    if (!submitResponse.ok || !submitBody || "error" in submitBody) {
      const error = new SponsoredPurchaseError(
        readResponseError(submitBody, "Sponsored checkout submit failed"),
        submitResponse.status,
        "submit"
      );
      if (attempt === 0 && sponsoredCheckoutShouldRefreshBlockhash(error)) {
        console.warn(
          "Sponsored checkout blockhash expired; preparing a fresh transaction."
        );
        prepareBody = await prepare();
        continue;
      }
      throw error;
    }

    return {
      signature: submitBody.signature,
      purchasePda: submitBody.purchasePda,
      setupFeeUsdcMicros: BigInt(submitBody.setupFeeUsdcMicros),
      sponsor: prepareBody.accounts.sponsor,
    };
  }

  throw new Error("Sponsored checkout submit failed after retry");
}

export type SponsoredCheckoutResult = {
  signature: string;
  setupFeeUsdcMicros: bigint;
  sponsor: string;
};

/**
 * Shared sponsored-checkout call + fallback decision for the marketplace and
 * reputation purchase hooks. Returns the on-chain result, or `null` when the
 * caller should fall back to a direct purchase (a safe-to-retry failure per
 * `sponsoredCheckoutShouldFallBack`); otherwise throws. Each hook still builds
 * its own transaction summary (which legitimately differs) and gates on
 * enablement + signer availability first, so its mint/cluster lookups stay lazy.
 */
export async function runSponsoredCheckout(input: {
  connectorSigner: ConnectorTransactionSigner;
  skillListing: string;
  priceUsdcMicros: bigint | string | number;
  expectedUsdcMint: string;
}): Promise<SponsoredCheckoutResult | null> {
  try {
    return await purchaseSkillWithSponsoredCheckout({
      signer: input.connectorSigner,
      listingAddress: input.skillListing,
      expectedPriceUsdcMicros: BigInt(input.priceUsdcMicros),
      expectedUsdcMint: input.expectedUsdcMint,
    });
  } catch (error) {
    if (sponsoredCheckoutShouldFallBack(error)) {
      console.warn(
        "Sponsored checkout unavailable; asking before direct purchase fallback:",
        error
      );
      confirmDirectPurchaseAfterSponsoredUnavailable(
        error instanceof Error
          ? error.message
          : "Unknown sponsored checkout error"
      );
      return null;
    }
    throw error;
  }
}

// ----------------------------------------------------------------------------
// Sponsored register_agent — gasless onboarding. Mirrors the purchase flow:
// the sponsor pays SOL gas + the AgentProfile rent, the user reimburses in USDC.
// ----------------------------------------------------------------------------

type SponsoredRegisterPrepareResponse =
  | {
      transaction: string;
      encoding: "base64";
      quote: { setupFeeUsdcMicros: string };
      accounts: { authority: string; sponsor: string; agentProfile: string };
      debug: SponsoredTransactionDebug;
    }
  | { error: string };

type SponsoredRegisterSubmitResponse =
  | {
      signature: string;
      agentProfile: string;
      authorityPubkey: string;
      setupFeeUsdcMicros: string;
    }
  | { error: string };

export type SponsoredRegisterAgentResult = {
  signature: string;
  agentProfile: string;
  setupFeeUsdcMicros: bigint;
  sponsor: string;
};

function confirmSponsoredRegistrationSetupFee(setupFeeUsdcMicros: string) {
  if (typeof window === "undefined") return;
  const setupFee = BigInt(setupFeeUsdcMicros);
  const message =
    setupFee > 0n
      ? `Register your agent with sponsored checkout for a ${formatUsdcMicros(
          setupFee
        )} USDC setup fee (no SOL needed)?`
      : "Register your agent with sponsored checkout (no SOL needed)?";
  if (!window.confirm(message)) {
    throw new Error("Sponsored registration cancelled before signing");
  }
}

export async function registerAgentWithSponsoredCheckout(input: {
  signer: ConnectorTransactionSigner;
  metadataUri: string;
}) {
  const prepare = async () => {
    const prepareResponse = await fetch(
      "/api/transactions/sponsored/register-agent/prepare",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authorityPubkey: input.signer.address,
          metadataUri: input.metadataUri,
        }),
      }
    );
    const prepareBody = (await prepareResponse
      .json()
      .catch(() => null)) as SponsoredRegisterPrepareResponse | null;
    if (!prepareResponse.ok || !prepareBody || "error" in prepareBody) {
      throw new SponsoredPurchaseError(
        readResponseError(prepareBody, "Sponsored registration prepare failed"),
        prepareResponse.status,
        "prepare"
      );
    }
    return prepareBody;
  };

  let prepareBody = await prepare();
  let confirmed = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!confirmed) {
      confirmSponsoredRegistrationSetupFee(
        prepareBody.quote.setupFeeUsdcMicros
      );
      confirmed = true;
    }

    const unsignedTransaction = decodeBase64Transaction(
      prepareBody.transaction
    );
    const signed = await input.signer.signTransaction(unsignedTransaction);
    const signedTransaction = encodeSignedTransaction(signed);
    const submitResponse = await fetch(
      "/api/transactions/sponsored/register-agent/submit",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signedTransaction }),
      }
    );
    const submitBody = (await submitResponse
      .json()
      .catch(() => null)) as SponsoredRegisterSubmitResponse | null;
    if (!submitResponse.ok || !submitBody || "error" in submitBody) {
      const error = new SponsoredPurchaseError(
        readResponseError(submitBody, "Sponsored registration submit failed"),
        submitResponse.status,
        "submit"
      );
      if (attempt === 0 && sponsoredCheckoutShouldRefreshBlockhash(error)) {
        console.warn(
          "Sponsored registration blockhash expired; preparing a fresh transaction."
        );
        prepareBody = await prepare();
        continue;
      }
      throw error;
    }

    return {
      signature: submitBody.signature,
      agentProfile: submitBody.agentProfile,
      setupFeeUsdcMicros: BigInt(submitBody.setupFeeUsdcMicros),
      sponsor: prepareBody.accounts.sponsor,
    };
  }

  throw new Error("Sponsored registration submit failed after retry");
}

/**
 * Shared sponsored register_agent call + fallback decision. Returns the on-chain
 * result, or `null` when the caller should fall back to direct (self-pay)
 * registration (a safe-to-retry failure per `sponsoredCheckoutShouldFallBack`);
 * otherwise throws.
 */
export async function runSponsoredRegisterAgent(input: {
  connectorSigner: ConnectorTransactionSigner;
  metadataUri: string;
}): Promise<SponsoredRegisterAgentResult | null> {
  try {
    return await registerAgentWithSponsoredCheckout({
      signer: input.connectorSigner,
      metadataUri: input.metadataUri,
    });
  } catch (error) {
    if (sponsoredCheckoutShouldFallBack(error)) {
      console.warn(
        "Sponsored registration unavailable; asking before direct fallback:",
        error
      );
      confirmDirectPurchaseAfterSponsoredUnavailable(
        error instanceof Error
          ? error.message
          : "Unknown sponsored registration error"
      );
      return null;
    }
    throw error;
  }
}
