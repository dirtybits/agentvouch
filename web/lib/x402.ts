import { createHash, randomBytes } from "crypto";
import {
  createSolanaRpc,
  getProgramDerivedAddress,
  getAddressEncoder,
  getUtf8Encoder,
  type Address,
} from "@solana/kit";
import {
  getConfiguredSolanaChainContext,
  normalizeInputChainContext,
} from "./chains";
import { getErrorMessage } from "./errors";
import { DEFAULT_SOLANA_RPC_URL } from "./solanaRpc";
import {
  fetchMaybePurchase,
  fetchMaybeSkillListing,
} from "../generated/agentvouch/src/generated";
import { AGENTVOUCH_PROGRAM_ADDRESS } from "../generated/agentvouch/src/generated/programs";

const SOL_NATIVE_MINT = "So11111111111111111111111111111111111111112";
export const USDC_DEVNET_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const USDC_MAINNET_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const FACILITATOR_SUPPORTED_CACHE_TTL_MS = 5 * 60_000;

const VERIFICATION_CACHE = new Map<
  string,
  { status: string; verifiedAt: number }
>();

type RpcTokenBalance = {
  accountIndex?: number;
  mint?: string;
  uiTokenAmount?: {
    amount?: string;
  };
};

type RpcParsedTransaction = {
  meta?: {
    err?: unknown;
    preTokenBalances?: RpcTokenBalance[];
    postTokenBalances?: RpcTokenBalance[];
    logMessages?: string[];
  };
  transaction?: {
    message?: {
      accountKeys?: Array<string | { pubkey?: string; signer?: boolean }>;
      instructions?: Array<{
        programId?: string;
        parsed?: unknown;
        data?: string;
      }>;
    };
  };
};

// ---------------------------------------------------------------------------
// Legacy AgentVouch payment requirement shape (SOL path, pre-x402-spec).
// ---------------------------------------------------------------------------
// Retained unchanged so existing callers, CLIs, and previously-issued
// 402 responses keep working while we dual-path to the spec-compliant USDC
// flow. Do not add fields here — new work belongs on `X402PaymentRequirement`.

export interface PaymentRequirement {
  scheme: "exact";
  network: "solana";
  chainContext?: string;
  programId: string;
  instruction: "purchaseSkill";
  skillListingAddress: string;
  mint: string;
  amount: number;
  resource: string;
  expiry: number;
  nonce: string;
  metadata?: Record<string, string>;
}

export interface PaymentProof {
  buyer: string;
  txSignature: string;
  requirement: PaymentRequirement;
}

export function generatePaymentRequirement(opts: {
  skillId: string;
  legacySolLamports: number;
  skillListingAddress: string;
  resourcePath: string;
}): PaymentRequirement {
  if (!Number.isFinite(opts.legacySolLamports) || opts.legacySolLamports <= 0) {
    throw new Error(
      "Legacy SOL payment requirements require a positive amount"
    );
  }
  const expirySeconds = 300;
  return {
    scheme: "exact",
    network: "solana",
    chainContext: getConfiguredSolanaChainContext(),
    programId: AGENTVOUCH_PROGRAM_ADDRESS,
    instruction: "purchaseSkill",
    skillListingAddress: opts.skillListingAddress,
    mint: SOL_NATIVE_MINT,
    amount: opts.legacySolLamports,
    resource: hashResource(opts.resourcePath),
    expiry: Math.floor(Date.now() / 1000) + expirySeconds,
    nonce: randomBytes(16).toString("hex"),
    metadata: {
      skill_id: opts.skillId,
      display_price: `${(opts.legacySolLamports / 1e9).toFixed(4)} SOL`,
    },
  };
}

export function hashResource(resource: string): string {
  return createHash("sha256").update(resource).digest("hex").slice(0, 32);
}

export function paymentRefFromProof(proof: PaymentProof): string {
  return createHash("sha256")
    .update(
      `${proof.buyer}:${proof.requirement.skillListingAddress}:${proof.requirement.nonce}`
    )
    .digest("hex");
}

async function derivePurchasePda(
  buyer: string,
  skillListingAddress: string,
  revision: bigint | number
): Promise<Address> {
  const addressEncoder = getAddressEncoder();
  const utf8Encoder = getUtf8Encoder();
  const revisionBytes = new Uint8Array(8);
  new DataView(revisionBytes.buffer).setBigUint64(0, BigInt(revision), true);

  const [pda] = await getProgramDerivedAddress({
    programAddress: AGENTVOUCH_PROGRAM_ADDRESS,
    seeds: [
      utf8Encoder.encode("purchase"),
      addressEncoder.encode(buyer as Address),
      addressEncoder.encode(skillListingAddress as Address),
      revisionBytes,
    ],
  });

  return pda;
}

async function getOnChainPurchaseStatus(
  buyer: string,
  skillListingAddress: string
): Promise<"valid" | "missing" | "buyerMismatch"> {
  const rpc = createSolanaRpc(DEFAULT_SOLANA_RPC_URL);
  const listing = await fetchMaybeSkillListing(
    rpc,
    skillListingAddress as Address
  );
  const purchasePda = await derivePurchasePda(
    buyer,
    skillListingAddress,
    listing.exists ? listing.data.currentRevision : 0n
  );
  const account = await fetchMaybePurchase(rpc, purchasePda);
  if (!account.exists) return "missing";
  if (account.data.buyer !== (buyer as Address)) return "buyerMismatch";
  return "valid";
}

export async function hasOnChainPurchase(
  buyer: string,
  skillListingAddress: string
): Promise<boolean> {
  return (
    (await getOnChainPurchaseStatus(buyer, skillListingAddress)) === "valid"
  );
}

export async function verifyPaymentProof(proof: PaymentProof): Promise<{
  status: "valid" | "invalid" | "pending";
  paymentRef: string;
  error?: string;
}> {
  const paymentRef = paymentRefFromProof(proof);

  const existing = VERIFICATION_CACHE.get(paymentRef);
  if (existing?.status === "valid" || existing?.status === "complete") {
    return { status: "valid", paymentRef };
  }

  const { requirement } = proof;

  if (requirement.scheme !== "exact") {
    return {
      status: "invalid",
      paymentRef,
      error: "Unsupported payment scheme",
    };
  }

  if (requirement.network !== "solana") {
    return { status: "invalid", paymentRef, error: "Unsupported network" };
  }

  if (requirement.chainContext) {
    const normalizedChainContext = normalizeInputChainContext(
      requirement.chainContext
    );
    if (!normalizedChainContext) {
      return {
        status: "invalid",
        paymentRef,
        error: "Unsupported chain context",
      };
    }

    if (normalizedChainContext !== getConfiguredSolanaChainContext()) {
      return {
        status: "invalid",
        paymentRef,
        error: "Payment proof chain context mismatch",
      };
    }
  }

  if (requirement.expiry < Math.floor(Date.now() / 1000)) {
    return {
      status: "invalid",
      paymentRef,
      error: "Payment requirement expired",
    };
  }

  if (!proof.buyer || proof.buyer.length < 32) {
    return {
      status: "invalid",
      paymentRef,
      error: "Missing or invalid buyer address",
    };
  }

  try {
    const purchaseStatus = await getOnChainPurchaseStatus(
      proof.buyer,
      requirement.skillListingAddress
    );

    if (purchaseStatus === "missing") {
      return {
        status: "invalid",
        paymentRef,
        error: "Purchase not found on-chain. Call purchaseSkill first.",
      };
    }
    if (purchaseStatus === "buyerMismatch") {
      return {
        status: "invalid",
        paymentRef,
        error: "Purchase buyer mismatch",
      };
    }

    VERIFICATION_CACHE.set(paymentRef, {
      status: "valid",
      verifiedAt: Date.now(),
    });
    return { status: "valid", paymentRef };
  } catch (error: unknown) {
    return {
      status: "pending",
      paymentRef,
      error: `Verification pending: ${getErrorMessage(error)}`,
    };
  }
}

type FacilitatorSupportedKind = {
  x402Version: number;
  scheme: string;
  network: string;
  extra?: Record<string, unknown>;
};

let facilitatorSupportedKindsCache: {
  expiresAt: number;
  kinds: FacilitatorSupportedKind[];
} | null = null;

export interface X402ResourceInfo {
  url: string;
  description: string;
  mimeType: string;
}

/** x402 v2 payment requirements entry for Solana exact payments. */
export interface X402PaymentRequirements {
  scheme: "exact";
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
}

/** x402 v2 payment-required response body. */
export interface X402PaymentRequiredBody {
  x402Version: 2;
  error: string;
  resource: X402ResourceInfo;
  accepts: X402PaymentRequirements[];
  extensions?: Record<string, unknown>;
}

/** x402 v2 payment payload carried by `PAYMENT-SIGNATURE`. */
export interface X402PaymentPayload {
  x402Version: 2;
  resource: X402ResourceInfo;
  accepted: X402PaymentRequirements;
  payload: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

/** Facilitator /verify response. */
export interface X402VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  invalidMessage?: string;
  payer?: string;
  extensions?: Record<string, unknown>;
}

/** Facilitator /settle response. */
export interface X402SettleResponse {
  success: boolean;
  transaction: string;
  network: string;
  payer?: string;
  amount?: string;
  errorReason?: string;
  errorMessage?: string;
  extensions?: Record<string, unknown>;
}

/** Where to reach the x402 facilitator. Defaults to x402.org for devnet. */
export function getFacilitatorUrl(): string {
  return (
    process.env.FACILITATOR_URL?.replace(/\/+$/, "") ||
    "https://x402.org/facilitator"
  );
}

/** Optional auth header for facilitators that require it (e.g. CDP). */
export function getFacilitatorAuthHeader(): string | null {
  return process.env.FACILITATOR_AUTH_HEADER || null;
}

async function getFacilitatorSupportedKinds(): Promise<
  FacilitatorSupportedKind[]
> {
  if (
    facilitatorSupportedKindsCache &&
    facilitatorSupportedKindsCache.expiresAt > Date.now()
  ) {
    return facilitatorSupportedKindsCache.kinds;
  }

  const res = await fetch(`${getFacilitatorUrl()}/supported`, {
    headers: {
      ...(getFacilitatorAuthHeader()
        ? { Authorization: getFacilitatorAuthHeader() as string }
        : {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Facilitator /supported returned ${res.status}${text ? `: ${text}` : ""}`
    );
  }

  const body = (await res.json()) as { kinds?: FacilitatorSupportedKind[] };
  const kinds = Array.isArray(body.kinds) ? body.kinds : [];
  facilitatorSupportedKindsCache = {
    expiresAt: Date.now() + FACILITATOR_SUPPORTED_CACHE_TTL_MS,
    kinds,
  };
  return kinds;
}

export async function getFacilitatorFeePayer(
  network = getConfiguredSolanaChainContext()
): Promise<string> {
  const kinds = await getFacilitatorSupportedKinds();
  const match = kinds.find(
    (kind) =>
      kind.x402Version === 2 &&
      kind.scheme === "exact" &&
      kind.network === network
  );
  const feePayer = match?.extra?.feePayer;
  if (typeof feePayer !== "string" || feePayer.length === 0) {
    throw new Error(
      `Facilitator does not advertise a Solana exact fee payer for ${network}`
    );
  }
  return feePayer;
}

/** USDC mint for the currently-configured Solana cluster. */
export function getConfiguredUsdcMint(): string {
  const override = process.env.USDC_MINT_ADDRESS;
  if (override) return override;
  const chain = getConfiguredSolanaChainContext();
  if (chain === "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp") {
    return USDC_MAINNET_MINT;
  }
  return USDC_DEVNET_MINT;
}

/**
 * Build a Solana x402 v2 requirement for a USDC-priced listing.
 *
 * For exact SVM payments, `payTo` is the recipient owner wallet. The client
 * derives the associated token account for that owner + mint inside the
 * partially signed transaction.
 */
export async function generateX402UsdcRequirement(opts: {
  priceUsdcMicros: bigint | number | string;
  payTo: string;
  usdcMint?: string;
  network?: string;
  timeoutSeconds?: number;
  extra?: Record<string, unknown>;
}): Promise<X402PaymentRequirements> {
  const network = opts.network ?? getConfiguredSolanaChainContext();
  const feePayer = await getFacilitatorFeePayer(network);
  return {
    scheme: "exact",
    network,
    amount: opts.priceUsdcMicros.toString(),
    payTo: opts.payTo,
    maxTimeoutSeconds: opts.timeoutSeconds ?? 300,
    asset: opts.usdcMint ?? getConfiguredUsdcMint(),
    extra: {
      feePayer,
      ...(opts.extra ?? {}),
    },
  };
}

export function buildX402PaymentRequiredBody(opts: {
  error: string;
  resource: X402ResourceInfo;
  requirement: X402PaymentRequirements;
  extensions?: Record<string, unknown>;
}): X402PaymentRequiredBody {
  return {
    x402Version: 2,
    error: opts.error,
    resource: opts.resource,
    accepts: [opts.requirement],
    ...(opts.extensions ? { extensions: opts.extensions } : {}),
  };
}

/** Parse the base64-encoded `PAYMENT-SIGNATURE` request header. */
export function decodeX402PaymentSignatureHeader(
  headerValue: string
): X402PaymentPayload | null {
  try {
    const decoded = Buffer.from(headerValue, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded);
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.x402Version === 2 &&
      parsed.accepted &&
      typeof parsed.accepted === "object" &&
      parsed.resource &&
      typeof parsed.resource === "object" &&
      parsed.payload &&
      typeof parsed.payload === "object"
    ) {
      return parsed as X402PaymentPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/** Encode the `PAYMENT-REQUIRED` header value. */
export function encodeX402PaymentRequiredHeader(
  value: X402PaymentRequiredBody
): string {
  return Buffer.from(JSON.stringify(value), "utf-8").toString("base64");
}

/** Encode the `PAYMENT-RESPONSE` header value. */
export function encodeX402PaymentResponseHeader(
  value: X402SettleResponse
): string {
  return Buffer.from(JSON.stringify(value), "utf-8").toString("base64");
}

async function facilitatorPost<T>(
  path: "/verify" | "/settle",
  body: unknown
): Promise<T> {
  const url = `${getFacilitatorUrl()}${path}`;
  const authHeader = getFacilitatorAuthHeader();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Facilitator ${path} returned ${res.status}${text ? `: ${text}` : ""}`
    );
  }

  return (await res.json()) as T;
}

/** Ask the configured facilitator to verify an x402 payment payload. */
export async function verifyX402Payment(
  paymentPayload: X402PaymentPayload,
  paymentRequirements: X402PaymentRequirements
): Promise<X402VerifyResponse> {
  return facilitatorPost<X402VerifyResponse>("/verify", {
    x402Version: 2,
    paymentPayload,
    paymentRequirements,
  });
}

/** Ask the configured facilitator to settle (broadcast) an x402 payment. */
export async function settleX402Payment(
  paymentPayload: X402PaymentPayload,
  paymentRequirements: X402PaymentRequirements
): Promise<X402SettleResponse> {
  return facilitatorPost<X402SettleResponse>("/settle", {
    x402Version: 2,
    paymentPayload,
    paymentRequirements,
  });
}

function getTokenBalanceAmount(balance: RpcTokenBalance | undefined): bigint {
  return BigInt(balance?.uiTokenAmount?.amount ?? "0");
}

async function getConfirmedParsedTransaction(
  signature: string
): Promise<RpcParsedTransaction | null> {
  const response = await fetch(DEFAULT_SOLANA_RPC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `x402-${signature}`,
      method: "getTransaction",
      params: [
        signature,
        {
          commitment: "confirmed",
          encoding: "jsonParsed",
          maxSupportedTransactionVersion: 0,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC getTransaction failed with status ${response.status}`);
  }

  const json = (await response.json()) as {
    result?: RpcParsedTransaction | null;
    error?: { message?: string };
  };

  if (json.error) {
    throw new Error(json.error.message || "RPC getTransaction failed");
  }

  return json.result ?? null;
}

export async function verifySettledUsdcTransfer(opts: {
  signature: string;
  destinationAta: string;
  currencyMint: string;
  minimumAmountMicros: bigint;
  expectedPayer?: string;
  expectedMemo?: string;
  exactAmountMicros?: bigint;
}): Promise<{ settledAmountMicros: bigint }> {
  const transaction = await getConfirmedParsedTransaction(opts.signature);

  if (!transaction?.meta) {
    throw new Error("Facilitator settlement transaction was not found on RPC");
  }

  if (transaction.meta.err) {
    throw new Error("Facilitator settlement transaction failed on-chain");
  }

  const messageAccountKeys = transaction.transaction?.message?.accountKeys;
  if (!messageAccountKeys) {
    throw new Error("Settled transaction is missing account key metadata");
  }

  const accountKeys = messageAccountKeys.map((key) =>
    typeof key === "string" ? key : key.pubkey ?? ""
  );
  if (opts.expectedPayer) {
    const hasSignerMetadata = messageAccountKeys.some(
      (key) => typeof key !== "string" && "signer" in key
    );
    if (!hasSignerMetadata) {
      throw new Error(
        "Settled transaction is missing signer metadata for payer verification"
      );
    }
    const payerSigned = messageAccountKeys.some((key) => {
      if (typeof key === "string") return false;
      return key.pubkey === opts.expectedPayer && key.signer === true;
    });
    if (!payerSigned) {
      throw new Error("Settled transaction was not signed by the expected payer");
    }
  }

  if (opts.expectedMemo) {
    const memoProgramId = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
    const memoMatchedInstruction =
      transaction.transaction?.message?.instructions?.some((instruction) => {
        if (instruction.programId !== memoProgramId) return false;
        if (instruction.parsed === opts.expectedMemo) return true;
        if (
          instruction.parsed &&
          typeof instruction.parsed === "object" &&
          "memo" in instruction.parsed
        ) {
          return (
            (instruction.parsed as { memo?: unknown }).memo ===
            opts.expectedMemo
          );
        }
        return false;
      }) ?? false;
    const memoMatchedLog =
      transaction.meta.logMessages?.some(
        (line) =>
          line.includes(`"${opts.expectedMemo}"`) ||
          line.endsWith(opts.expectedMemo as string)
      ) ?? false;

    if (!memoMatchedInstruction && !memoMatchedLog) {
      throw new Error("Settled transaction memo does not match x402 requirement");
    }
  }
  const destinationIndex = accountKeys.findIndex(
    (accountKey) => accountKey === opts.destinationAta
  );

  if (destinationIndex < 0) {
    throw new Error(
      "Settled transaction does not reference the expected destination ATA"
    );
  }

  const preBalance = transaction.meta.preTokenBalances?.find(
    (balance) =>
      balance.accountIndex === destinationIndex &&
      balance.mint === opts.currencyMint
  );
  const postBalance = transaction.meta.postTokenBalances?.find(
    (balance) =>
      balance.accountIndex === destinationIndex &&
      balance.mint === opts.currencyMint
  );

  if (!postBalance) {
    throw new Error(
      "Settled transaction did not credit the expected destination ATA"
    );
  }

  const settledAmountMicros =
    getTokenBalanceAmount(postBalance) - getTokenBalanceAmount(preBalance);

  if (settledAmountMicros < opts.minimumAmountMicros) {
    throw new Error(
      `Settled amount ${settledAmountMicros.toString()} is below required ${opts.minimumAmountMicros.toString()}`
    );
  }

  if (
    opts.exactAmountMicros !== undefined &&
    settledAmountMicros !== opts.exactAmountMicros
  ) {
    throw new Error(
      `Settled amount ${settledAmountMicros.toString()} does not match required ${opts.exactAmountMicros.toString()}`
    );
  }

  return { settledAmountMicros };
}
