import { PublicKey, Transaction } from "@solana/web3.js";

export type SponsorMode = "bespoke" | "kora";

export type KoraSetupFeeQuote = {
  feeInLamports: bigint;
  feeInTokenMicros: bigint;
  setupFeeUsdcMicros: bigint;
  capped: false;
};

const DEFAULT_KORA_URL = "http://localhost:8080";
const DEFAULT_KORA_REIMBURSEMENT_BUFFER_BPS = 200n;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function requireKoraPubkey(value: string | undefined, label: string) {
  if (!value) throw new Error(`${label} is required in Kora sponsor mode`);
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`${label} is not a valid Solana address`);
  }
}

export function getSponsoredSponsorMode(): SponsorMode {
  const raw = process.env.AGENTVOUCH_SPONSOR_MODE?.trim().toLowerCase();
  if (!raw || raw === "bespoke" || raw === "server") return "bespoke";
  if (raw === "kora") return "kora";
  throw new Error('AGENTVOUCH_SPONSOR_MODE must be "bespoke" or "kora"');
}

export function isKoraSponsorMode() {
  return getSponsoredSponsorMode() === "kora";
}

export function getKoraFeePayer() {
  return requireKoraPubkey(
    process.env.AGENTVOUCH_KORA_FEE_PAYER,
    "AGENTVOUCH_KORA_FEE_PAYER"
  );
}

export function getKoraFeeDestination() {
  return requireKoraPubkey(
    process.env.AGENTVOUCH_KORA_USDC_FEE_DESTINATION,
    "AGENTVOUCH_KORA_USDC_FEE_DESTINATION"
  );
}

export function getKoraFeeToken(configUsdcMint: PublicKey) {
  const configured = process.env.AGENTVOUCH_KORA_FEE_TOKEN;
  if (!configured) return configUsdcMint;
  const feeToken = requireKoraPubkey(configured, "AGENTVOUCH_KORA_FEE_TOKEN");
  if (!feeToken.equals(configUsdcMint)) {
    throw new Error(
      "AGENTVOUCH_KORA_FEE_TOKEN must match the AgentVouch config USDC mint"
    );
  }
  return feeToken;
}

function parseNonNegativeInteger(value: string | undefined, label: string) {
  if (!value) return null;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return BigInt(value);
}

export function getKoraReimbursementBufferBps() {
  return (
    parseNonNegativeInteger(
      process.env.AGENTVOUCH_KORA_REIMBURSEMENT_BUFFER_BPS,
      "AGENTVOUCH_KORA_REIMBURSEMENT_BUFFER_BPS"
    ) ?? DEFAULT_KORA_REIMBURSEMENT_BUFFER_BPS
  );
}

function ceilDiv(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n) throw new Error("Denominator must be positive");
  return (numerator + denominator - 1n) / denominator;
}

export function bufferKoraTokenFee(
  feeInTokenMicros: bigint | number | string,
  bufferBps: bigint | number | string = DEFAULT_KORA_REIMBURSEMENT_BUFFER_BPS
) {
  const fee = BigInt(feeInTokenMicros);
  const bps = BigInt(bufferBps);
  if (fee < 0n) throw new Error("feeInTokenMicros must be non-negative");
  if (bps < 0n) throw new Error("bufferBps must be non-negative");
  return ceilDiv(fee * (10_000n + bps), 10_000n);
}

function serializePartialTransaction(transaction: Transaction) {
  return transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
}

function serializedMessage(transaction: Transaction) {
  return Buffer.from(transaction.compileMessage().serialize());
}

function getKoraRpcUrls() {
  const configured = process.env.AGENTVOUCH_KORA_URL ?? DEFAULT_KORA_URL;
  const urls = [configured];
  try {
    const url = new URL(configured);
    if (url.hostname === "localhost") {
      url.hostname = "127.0.0.1";
      urls.push(url.toString());
    }
  } catch {
    // Let fetch surface the original malformed URL error below.
  }
  return urls;
}

async function callKoraRpc<T>(
  method: string,
  params: Record<string, unknown>
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const authToken = process.env.AGENTVOUCH_KORA_AUTH_TOKEN;
  if (authToken) headers.authorization = `Bearer ${authToken}`;

  const requestBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method,
    params,
  });
  let response: Response | null = null;
  let lastFetchError: unknown = null;
  for (const url of getKoraRpcUrls()) {
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: requestBody,
      });
      break;
    } catch (error) {
      lastFetchError = error;
    }
  }
  if (!response) {
    const message =
      lastFetchError instanceof Error ? lastFetchError.message : "fetch failed";
    throw new Error(`Kora ${method} request failed: ${message}`);
  }
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(`Kora ${method} HTTP ${response.status}`);
  }
  if (!isRecord(body)) {
    throw new Error(`Kora ${method} returned a malformed response`);
  }
  if ("error" in body && body.error) {
    const error = body.error;
    const message =
      isRecord(error) && typeof error.message === "string"
        ? error.message
        : JSON.stringify(error);
    throw new Error(`Kora ${method} failed: ${message}`);
  }
  if (!("result" in body)) {
    throw new Error(`Kora ${method} returned no result`);
  }
  return body.result as T;
}

function readBigIntField(result: unknown, field: string) {
  if (!isRecord(result)) {
    throw new Error("Kora fee estimate returned a malformed result");
  }
  const value = result[field];
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value))
    return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  throw new Error(`Kora fee estimate missing integer ${field}`);
}

export async function estimateKoraSetupFeeUsdcMicros(input: {
  transaction: Transaction;
  feeToken: PublicKey;
  capUsdcMicros: bigint | null;
}): Promise<KoraSetupFeeQuote> {
  const result = await callKoraRpc<unknown>("estimateTransactionFee", {
    transaction: serializePartialTransaction(input.transaction),
    fee_token: input.feeToken.toBase58(),
    sig_verify: false,
  });
  const feeInLamports = readBigIntField(result, "fee_in_lamports");
  const feeInTokenMicros = readBigIntField(result, "fee_in_token");
  const setupFeeUsdcMicros = bufferKoraTokenFee(
    feeInTokenMicros,
    getKoraReimbursementBufferBps()
  );

  if (
    input.capUsdcMicros !== null &&
    setupFeeUsdcMicros > input.capUsdcMicros
  ) {
    throw new Error("Kora fee quote exceeds configured setup fee cap");
  }

  return {
    feeInLamports,
    feeInTokenMicros,
    setupFeeUsdcMicros,
    capped: false,
  };
}

export async function signTransactionWithKora(
  transaction: Transaction
): Promise<Transaction> {
  const originalMessage = serializedMessage(transaction);
  const result = await callKoraRpc<unknown>("signTransaction", {
    transaction: serializePartialTransaction(transaction),
    sig_verify: false,
  });
  if (!isRecord(result)) {
    throw new Error("Kora signTransaction returned a malformed result");
  }
  const signedTransaction =
    typeof result.signed_transaction === "string"
      ? result.signed_transaction
      : typeof result.signedTransaction === "string"
      ? result.signedTransaction
      : null;
  if (!signedTransaction) {
    throw new Error("Kora signTransaction returned no signed transaction");
  }

  const signed = Transaction.from(Buffer.from(signedTransaction, "base64"));
  if (!serializedMessage(signed).equals(originalMessage)) {
    throw new Error("Kora returned a transaction with a different message");
  }
  return signed;
}
