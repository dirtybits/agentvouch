import { createWalletTransactionSigner } from "@solana/client";
import {
  decodePaymentResponseHeader,
  wrapFetchWithPayment,
  x402Client,
  x402HTTPClient,
} from "@x402/fetch";
import { ExactSvmScheme, toClientSvmSigner } from "@x402/svm";
import { createSignedDownloadAuthPayload } from "@/lib/auth";
import { DEFAULT_SOLANA_RPC_URL } from "@/lib/solanaRpc";

export type BrowserX402Wallet = Parameters<typeof createWalletTransactionSigner>[0];
type BrowserX402SettleResponse = ReturnType<typeof decodePaymentResponseHeader>;

type BrowserSignMessage = (message: Uint8Array) => Promise<Uint8Array>;

export function walletSupportsBrowserX402(
  wallet: BrowserX402Wallet | null | undefined
): boolean {
  if (!wallet) {
    return false;
  }

  const directMethods = wallet as unknown as {
    signTransaction?: unknown;
    signTransactions?: unknown;
  };
  if (
    typeof directMethods.signTransaction === "function" ||
    typeof directMethods.signTransactions === "function"
  ) {
    return true;
  }

  const features = (wallet as unknown as { features?: Record<string, unknown> })
    .features;
  if (!features) {
    return false;
  }

  return Object.keys(features).some((featureName) =>
    /(^|:)signTransaction(s)?$/i.test(featureName)
  );
}

function getErrorFromResponseBody(body: unknown): string | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  if ("error" in body && typeof body.error === "string" && body.error) {
    return body.error;
  }

  if ("message" in body && typeof body.message === "string" && body.message) {
    return body.message;
  }

  return null;
}

export async function createBrowserX402Fetch(input: {
  wallet: BrowserX402Wallet;
  authHeader?: string;
  rpcUrl?: string;
  fetchImpl?: typeof fetch;
}) {
  const signer = toClientSvmSigner(
    createWalletTransactionSigner(input.wallet).signer
  );
  const client = new x402HTTPClient(
    new x402Client().register(
      "solana:*",
      new ExactSvmScheme(signer, {
        rpcUrl: input.rpcUrl ?? DEFAULT_SOLANA_RPC_URL,
      })
    )
  );

  const authHeader = input.authHeader;
  if (authHeader) {
    client.onPaymentRequired(async () => ({
      headers: {
        "X-AgentVouch-Auth": authHeader,
      },
    }));
  }

  return wrapFetchWithPayment(input.fetchImpl ?? fetch, client);
}

export async function fetchSkillWithBrowserX402(input: {
  wallet: BrowserX402Wallet;
  walletAddress: string;
  signMessage: BrowserSignMessage;
  skillId: string;
  listingAddress?: string;
  rawPath: string;
  rpcUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  authHeader: string;
  content: string;
  paymentResponse?: BrowserX402SettleResponse;
}> {
  const authHeader = JSON.stringify(
    await createSignedDownloadAuthPayload({
      walletAddress: input.walletAddress,
      signMessage: input.signMessage,
      skillId: input.skillId,
      listingAddress: input.listingAddress,
    })
  );
  const paidFetch = await createBrowserX402Fetch({
    wallet: input.wallet,
    authHeader,
    rpcUrl: input.rpcUrl,
    fetchImpl: input.fetchImpl,
  });
  const response = await paidFetch(input.rawPath, { method: "GET" });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") || "";
    let errorMessage = `USDC purchase failed with status ${response.status}`;

    if (contentType.includes("application/json")) {
      const body = (await response.json().catch(() => null)) as unknown;
      errorMessage = getErrorFromResponseBody(body) ?? errorMessage;
    } else {
      const text = await response.text().catch(() => "");
      if (text) {
        errorMessage = text;
      }
    }

    throw new Error(errorMessage);
  }

  const paymentResponseHeader = response.headers.get("PAYMENT-RESPONSE");

  return {
    authHeader,
    content: await response.text(),
    paymentResponse: paymentResponseHeader
      ? decodePaymentResponseHeader(paymentResponseHeader)
      : undefined,
  };
}
