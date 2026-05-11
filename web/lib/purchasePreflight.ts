import { createSolanaRpc, type Address } from "@solana/kit";
import {
  fetchAssociatedTokenAccountState,
  formatUsdcMicrosValue,
} from "./agentvouchUsdc";
import { DEFAULT_SOLANA_RPC_URL } from "./solanaRpc";

const DEFAULT_RPC_URL = DEFAULT_SOLANA_RPC_URL;

export const PURCHASE_ACCOUNT_SPACE =
  8 + // discriminator
  32 + // buyer
  32 + // skill listing
  8 + // purchased at
  8 + // listing revision
  32 + // listing settlement
  8 + // price paid
  8 + // author share
  8 + // voucher pool
  32 + // USDC mint
  1; // bump
export const PURCHASE_FEE_BUFFER_LAMPORTS = 50_000n;

export type PurchasePreflightStatus =
  | "ok"
  | "buyerInsufficientBalance"
  | "buyerMissingUsdcAccount"
  | "authorMissingBacking"
  | "authorPayoutRentBlocked"
  | "estimateUnavailable";

export type BlockingPurchasePreflightStatus = Extract<
  PurchasePreflightStatus,
  | "buyerInsufficientBalance"
  | "buyerMissingUsdcAccount"
  | "authorMissingBacking"
  | "authorPayoutRentBlocked"
>;

export type SerializedPurchaseBlockError = {
  code: BlockingPurchasePreflightStatus;
  message: string;
};

export type SerializedPurchasePreflight = {
  creatorPriceUsdcMicros: number;
  estimatedPurchaseRentLamports: number;
  feeBufferLamports: number;
  estimatedBuyerTotalLamports: number;
  purchasePreflightStatus: PurchasePreflightStatus;
  purchasePreflightMessage: string | null;
  purchaseBlocked: boolean;
  purchaseBlockError: SerializedPurchaseBlockError | null;
  priceDisclosure: string | null;
};

export type PurchasePreflightAssessment = {
  creatorPriceUsdcMicros: bigint;
  estimatedPurchaseRentLamports: bigint;
  feeBufferLamports: bigint;
  estimatedBuyerTotalLamports: bigint;
  purchasePreflightStatus: PurchasePreflightStatus;
  purchasePreflightMessage: string | null;
  priceDisclosure: string | null;
  buyerUsdcAccount: Address | null;
  buyerUsdcBalanceMicros: bigint | null;
  buyerBalanceLamports: bigint | null;
  authorBalanceLamports: bigint | null;
  authorShareLamports: bigint;
  systemAccountRentExemptLamports: bigint | null;
};

export type PurchasePreflightContext = {
  buyer: Address | null;
  buyerUsdcAccount: Address | null;
  buyerUsdcBalanceMicros: bigint | null;
  buyerUsdcAccountExists: boolean | null;
  buyerBalanceLamports: bigint | null;
  purchaseRentLamports: bigint | null;
  systemAccountRentExemptLamports: bigint | null;
  authorBalanceLamportsByAddress: Map<string, bigint | null>;
};

type PurchasePreflightRpc = ReturnType<typeof createSolanaRpc>;

function coerceLamports(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (
    value &&
    typeof value === "object" &&
    "value" in value &&
    (value as { value?: unknown }).value !== undefined
  ) {
    return coerceLamports((value as { value: unknown }).value);
  }
  throw new Error("Unexpected lamports response from RPC");
}

function toSafeLamportsNumber(value: bigint): number {
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > maxSafe) {
    throw new Error("Lamports value exceeds Number.MAX_SAFE_INTEGER");
  }
  return Number(value);
}

function buildBuyerInsufficientMessage(
  buyerUsdcBalanceMicros: bigint,
  priceUsdcMicros: bigint
) {
  return `Connected wallet has ${formatUsdcMicrosValue(
    buyerUsdcBalanceMicros
  )} USDC available, but this purchase needs ${formatUsdcMicrosValue(
    priceUsdcMicros
  )} USDC.`;
}

export function createFreePurchasePreflight(): PurchasePreflightAssessment {
  return {
    creatorPriceUsdcMicros: 0n,
    estimatedPurchaseRentLamports: 0n,
    feeBufferLamports: 0n,
    estimatedBuyerTotalLamports: 0n,
    purchasePreflightStatus: "ok",
    purchasePreflightMessage: null,
    priceDisclosure: null,
    buyerUsdcAccount: null,
    buyerUsdcBalanceMicros: null,
    buyerBalanceLamports: null,
    authorBalanceLamports: null,
    authorShareLamports: 0n,
    systemAccountRentExemptLamports: null,
  };
}

export async function createPurchasePreflightContext({
  rpc = createSolanaRpc(DEFAULT_RPC_URL),
  buyer = null,
  usdcMint = null,
  authors = [],
}: {
  rpc?: PurchasePreflightRpc;
  buyer?: Address | null;
  usdcMint?: Address | null;
  authors?: Address[];
}): Promise<PurchasePreflightContext> {
  const uniqueAuthors = [...new Set(authors.map(String))] as Address[];
  const buyerUsdcAccountState =
    buyer && usdcMint
      ? await fetchAssociatedTokenAccountState(rpc, buyer, usdcMint).catch(
          () => null
        )
      : null;

  const [
    buyerBalanceLamports,
    purchaseRentLamports,
    systemAccountRentExemptLamports,
  ] = await Promise.all([
    buyer
      ? rpc
          .getBalance(buyer)
          .send()
          .then(coerceLamports)
          .catch(() => null)
      : Promise.resolve(null),
    rpc
      .getMinimumBalanceForRentExemption(BigInt(PURCHASE_ACCOUNT_SPACE))
      .send()
      .then(coerceLamports)
      .catch(() => null),
    rpc
      .getMinimumBalanceForRentExemption(0n)
      .send()
      .then(coerceLamports)
      .catch(() => null),
  ]);

  const authorBalanceLamportsByAddress = new Map<string, bigint | null>();

  await Promise.all(
    uniqueAuthors.map(async (author) => {
      const balance = await rpc
        .getBalance(author)
        .send()
        .then(coerceLamports)
        .catch(() => null);
      authorBalanceLamportsByAddress.set(String(author), balance);
    })
  );

  return {
    buyer,
    buyerUsdcAccount: buyerUsdcAccountState?.address ?? null,
    buyerUsdcBalanceMicros: buyerUsdcAccountState?.exists
      ? buyerUsdcAccountState.amount
      : null,
    buyerUsdcAccountExists:
      buyer && usdcMint ? !!buyerUsdcAccountState?.exists : null,
    buyerBalanceLamports,
    purchaseRentLamports,
    systemAccountRentExemptLamports,
    authorBalanceLamportsByAddress,
  };
}

export function assessPurchasePreflight({
  context,
  priceUsdcMicros,
  author,
  authorBackingUsdcMicros = null,
}: {
  context: PurchasePreflightContext;
  priceUsdcMicros: bigint;
  author: Address | null;
  authorBackingUsdcMicros?: bigint | null;
}): PurchasePreflightAssessment {
  const creatorPriceUsdcMicros = priceUsdcMicros;
  if (creatorPriceUsdcMicros <= 0n) {
    return createFreePurchasePreflight();
  }

  const estimatedPurchaseRentLamports = context.purchaseRentLamports ?? 0n;
  const estimatedBuyerTotalLamports =
    estimatedPurchaseRentLamports + PURCHASE_FEE_BUFFER_LAMPORTS;
  const authorShareLamports = 0n;
  const authorBalanceLamports = author
    ? context.authorBalanceLamportsByAddress.get(String(author)) ?? null
    : null;
  const priceDisclosure =
    "Buying this skill transfers USDC and creates an on-chain purchase receipt, so your wallet still needs a small amount of SOL for rent and network fees.";

  if (authorBackingUsdcMicros === 0n) {
    return {
      creatorPriceUsdcMicros,
      estimatedPurchaseRentLamports,
      feeBufferLamports: PURCHASE_FEE_BUFFER_LAMPORTS,
      estimatedBuyerTotalLamports,
      purchasePreflightStatus: "authorMissingBacking",
      purchasePreflightMessage:
        "This author needs active vouch backing before paid purchases are available.",
      priceDisclosure,
      buyerUsdcAccount: context.buyerUsdcAccount,
      buyerUsdcBalanceMicros: context.buyerUsdcBalanceMicros,
      buyerBalanceLamports: context.buyerBalanceLamports,
      authorBalanceLamports,
      authorShareLamports,
      systemAccountRentExemptLamports: context.systemAccountRentExemptLamports,
    };
  }

  if (context.buyerUsdcAccountExists === false) {
    return {
      creatorPriceUsdcMicros,
      estimatedPurchaseRentLamports,
      feeBufferLamports: PURCHASE_FEE_BUFFER_LAMPORTS,
      estimatedBuyerTotalLamports,
      purchasePreflightStatus: "buyerMissingUsdcAccount",
      purchasePreflightMessage:
        "Connected wallet does not have a USDC associated token account for the configured mint. Create or fund that token account and retry.",
      priceDisclosure,
      buyerUsdcAccount: context.buyerUsdcAccount,
      buyerUsdcBalanceMicros: context.buyerUsdcBalanceMicros,
      buyerBalanceLamports: context.buyerBalanceLamports,
      authorBalanceLamports,
      authorShareLamports,
      systemAccountRentExemptLamports: context.systemAccountRentExemptLamports,
    };
  }

  if (
    context.purchaseRentLamports === null ||
    context.systemAccountRentExemptLamports === null ||
    context.buyerUsdcBalanceMicros === null
  ) {
    return {
      creatorPriceUsdcMicros,
      estimatedPurchaseRentLamports,
      feeBufferLamports: 0n,
      estimatedBuyerTotalLamports,
      purchasePreflightStatus: "estimateUnavailable",
      purchasePreflightMessage:
        "Purchase availability could not be fully checked right now. Confirm the wallet has enough USDC plus a small amount of SOL for rent and network fees.",
      priceDisclosure,
      buyerUsdcAccount: context.buyerUsdcAccount,
      buyerUsdcBalanceMicros: context.buyerUsdcBalanceMicros,
      buyerBalanceLamports: context.buyerBalanceLamports,
      authorBalanceLamports,
      authorShareLamports,
      systemAccountRentExemptLamports: context.systemAccountRentExemptLamports,
    };
  }

  if (
    context.buyerUsdcBalanceMicros !== null &&
    context.buyerUsdcBalanceMicros < creatorPriceUsdcMicros
  ) {
    return {
      creatorPriceUsdcMicros,
      estimatedPurchaseRentLamports,
      feeBufferLamports: PURCHASE_FEE_BUFFER_LAMPORTS,
      estimatedBuyerTotalLamports,
      purchasePreflightStatus: "buyerInsufficientBalance",
      purchasePreflightMessage: buildBuyerInsufficientMessage(
        context.buyerUsdcBalanceMicros,
        creatorPriceUsdcMicros
      ),
      priceDisclosure,
      buyerUsdcAccount: context.buyerUsdcAccount,
      buyerUsdcBalanceMicros: context.buyerUsdcBalanceMicros,
      buyerBalanceLamports: context.buyerBalanceLamports,
      authorBalanceLamports,
      authorShareLamports,
      systemAccountRentExemptLamports: context.systemAccountRentExemptLamports,
    };
  }

  return {
    creatorPriceUsdcMicros,
    estimatedPurchaseRentLamports,
    feeBufferLamports: PURCHASE_FEE_BUFFER_LAMPORTS,
    estimatedBuyerTotalLamports,
    purchasePreflightStatus: "ok",
    purchasePreflightMessage: null,
    priceDisclosure,
    buyerUsdcAccount: context.buyerUsdcAccount,
    buyerUsdcBalanceMicros: context.buyerUsdcBalanceMicros,
    buyerBalanceLamports: context.buyerBalanceLamports,
    authorBalanceLamports,
    authorShareLamports,
    systemAccountRentExemptLamports: context.systemAccountRentExemptLamports,
  };
}

export function serializePurchasePreflight(
  assessment: PurchasePreflightAssessment
): SerializedPurchasePreflight {
  let purchaseBlockError: SerializedPurchaseBlockError | null = null;
  if (
    isPurchasePreflightBlocking(assessment.purchasePreflightStatus) &&
    assessment.purchasePreflightMessage
  ) {
    purchaseBlockError = {
      code: assessment.purchasePreflightStatus,
      message: assessment.purchasePreflightMessage,
    };
  }

  const purchaseBlocked = purchaseBlockError !== null;

  return {
    creatorPriceUsdcMicros: toSafeLamportsNumber(
      assessment.creatorPriceUsdcMicros
    ),
    estimatedPurchaseRentLamports: toSafeLamportsNumber(
      assessment.estimatedPurchaseRentLamports
    ),
    feeBufferLamports: toSafeLamportsNumber(assessment.feeBufferLamports),
    estimatedBuyerTotalLamports: toSafeLamportsNumber(
      assessment.estimatedBuyerTotalLamports
    ),
    purchasePreflightStatus: assessment.purchasePreflightStatus,
    purchasePreflightMessage: assessment.purchasePreflightMessage,
    purchaseBlocked,
    purchaseBlockError,
    priceDisclosure: assessment.priceDisclosure,
  };
}

export function isPurchasePreflightBlocking(
  status: PurchasePreflightStatus | null | undefined
): status is BlockingPurchasePreflightStatus {
  return (
    status === "buyerInsufficientBalance" ||
    status === "buyerMissingUsdcAccount" ||
    status === "authorMissingBacking" ||
    status === "authorPayoutRentBlocked"
  );
}
