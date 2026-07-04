import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import { BASE_SEPOLIA_CHAIN_CONTEXT } from "@/lib/chains";
import {
  AGENTVOUCH_EVM_READ_ABI,
  LISTING_STATUS_ACTIVE,
} from "@/lib/adapters/agentVouchEvmAbi";
import {
  BASE_AGENTVOUCH_CONTRACT_ADDRESS,
  BASE_NATIVE_USDC_ADDRESS,
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_RPC_URL,
  BASE_USDC_ADDRESS,
} from "@/lib/adapters/baseConfig";
import {
  getExpectedBaseContract,
  getExpectedBaseCurrency,
  requireBaseBytes32,
  requireBaseEvmAddress,
} from "@/lib/adapters/baseListing";
import {
  DIRECT_PURCHASE_PAYMENT_FLOW,
  recordUsdcPurchaseReceipt,
} from "@/lib/usdcPurchases";

const BASE_AGENTVOUCH_PROTOCOL_VERSION = "base-poc-v0";
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

const AGENTVOUCH_EVM_PURCHASE_ABI = parseAbi([
  ...AGENTVOUCH_EVM_READ_ABI,
  "function purchaseId(address buyer, bytes32 id, uint64 revision) pure returns (bytes32)",
  "function getPurchase(bytes32 pId) view returns (bool exists, address buyer, bytes32 listingId, uint64 revision, uint256 priceUsdcMicros, uint256 authorShareUsdcMicros, uint256 voucherPoolUsdcMicros, uint64 timestamp)",
  "event SkillPurchased(bytes32 indexed purchaseId, bytes32 indexed listingId, address indexed buyer, uint64 revision, uint256 price, uint256 authorShare, uint256 voucherPool)",
]);

type RawListing = {
  author: Address;
  skillIdHash: Hex;
  uri: string;
  name: string;
  description: string;
  priceUsdcMicros: bigint;
  currentRevision: bigint;
  totalDownloads: bigint;
  totalRevenueUsdcMicros: bigint;
  status: number;
  lockedByDispute: boolean;
  exists: boolean;
};

type RawPurchase = {
  exists: boolean;
  buyer: Address;
  listingId: Hex;
  revision: bigint;
  priceUsdcMicros: bigint;
  authorShareUsdcMicros: bigint;
  voucherPoolUsdcMicros: bigint;
  timestamp: bigint;
};

type RawPurchaseTuple = Partial<RawPurchase> & {
  [index: number]: unknown;
};

type SkillPurchasedEvent = {
  purchaseId: Hex;
  listingId: Hex;
  buyer: Address;
  revision: bigint;
  price: bigint;
};

export type BaseDirectPurchaseSkillRow = {
  id: string;
  price_usdc_micros: string | null;
  currency_mint: string | null;
  chain_context: string | null;
  on_chain_protocol_version: string | null;
  on_chain_program_id: string | null;
  evm_listing_id: string | null;
  evm_contract_address: string | null;
};

export type BaseDirectPurchaseVerificationResult = {
  buyerAddress: Address;
  txHash: string;
  listingId: Hex;
  purchaseId: Hex;
  amountMicros: string;
  currencyMint: Address;
  paymentFlow: typeof DIRECT_PURCHASE_PAYMENT_FLOW;
  protocolVersion: string;
  onChainProgramId: Address;
  chainContext: typeof BASE_SEPOLIA_CHAIN_CONTEXT;
  listingRevision: string;
};

export type BaseDirectPurchaseTxVerificationResult =
  BaseDirectPurchaseVerificationResult & {
    txHash: Hex;
  };

type VerifyBaseDirectPurchaseInput = {
  skill: BaseDirectPurchaseSkillRow;
  txHash: string;
  buyerAddress?: string | null;
  listingId?: string | null;
  expectedPriceUsdcMicros?: string | null;
};

type VerifyBaseExistingPurchaseInput = Omit<
  VerifyBaseDirectPurchaseInput,
  "txHash"
> & {
  buyerAddress: string;
};

function requireTxHash(value: string): Hex {
  if (!TX_HASH_RE.test(value)) {
    throw new Error(
      "Base purchase transaction hash must be a 32-byte hex value"
    );
  }
  return value as Hex;
}

function normalizeMicros(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  return BigInt(trimmed) > 0n ? trimmed : null;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} has unexpected fields`);
  }
  return value;
}

function requireBigint(value: unknown, label: string): bigint {
  if (typeof value !== "bigint") {
    throw new Error(`${label} has unexpected fields`);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} has unexpected fields`);
  }
  return value;
}

function tupleField<T extends keyof RawPurchase>(
  tuple: RawPurchaseTuple,
  field: T,
  index: number
): RawPurchase[T] | unknown {
  return tuple[field] ?? tuple[index];
}

export function normalizeBasePurchaseTuple(value: unknown): RawPurchase {
  const tuple = value as RawPurchaseTuple;
  return {
    exists: requireBoolean(
      tupleField(tuple, "exists", 0),
      "Base purchase receipt"
    ),
    buyer: requireBaseEvmAddress(
      requireString(tupleField(tuple, "buyer", 1), "Base purchase buyer"),
      "Base purchase buyer"
    ),
    listingId: requireBaseBytes32(
      requireString(
        tupleField(tuple, "listingId", 2),
        "Base purchase listing id"
      ),
      "Base purchase listing id"
    ),
    revision: requireBigint(
      tupleField(tuple, "revision", 3),
      "Base purchase receipt"
    ),
    priceUsdcMicros: requireBigint(
      tupleField(tuple, "priceUsdcMicros", 4),
      "Base purchase receipt"
    ),
    authorShareUsdcMicros: requireBigint(
      tupleField(tuple, "authorShareUsdcMicros", 5),
      "Base purchase receipt"
    ),
    voucherPoolUsdcMicros: requireBigint(
      tupleField(tuple, "voucherPoolUsdcMicros", 6),
      "Base purchase receipt"
    ),
    timestamp: requireBigint(
      tupleField(tuple, "timestamp", 7),
      "Base purchase receipt"
    ),
  };
}

function createBasePublicClient() {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(BASE_SEPOLIA_RPC_URL),
  });
}

async function fetchLiveListing(input: {
  contract: Address;
  listingId: Hex;
}): Promise<RawListing> {
  const publicClient = createBasePublicClient();
  const chainId = await publicClient.getChainId();
  if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(
      `Base verification requires chain id ${BASE_SEPOLIA_CHAIN_ID}; RPC returned ${chainId}`
    );
  }

  const listing = (await publicClient.readContract({
    address: input.contract,
    abi: AGENTVOUCH_EVM_PURCHASE_ABI,
    functionName: "getListing",
    args: [input.listingId],
  })) as unknown as RawListing;

  if (!listing.exists) {
    throw new Error("Base listing was not found on-chain");
  }
  if (listing.status !== LISTING_STATUS_ACTIVE || listing.lockedByDispute) {
    throw new Error("Base listing is not purchasable");
  }
  return listing;
}

async function findSkillPurchasedEvent(input: {
  contract: Address;
  txHash: Hex;
}): Promise<SkillPurchasedEvent> {
  const receipt = await createBasePublicClient().getTransactionReceipt({
    hash: input.txHash,
  });
  if (receipt.status !== "success") {
    throw new Error("Base purchase transaction failed on-chain");
  }

  for (const log of receipt.logs) {
    if (getAddress(log.address) !== input.contract) continue;
    try {
      const decoded = decodeEventLog({
        abi: AGENTVOUCH_EVM_PURCHASE_ABI,
        data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]],
      }) as unknown as {
        eventName: string;
        args: Record<string, unknown>;
      };
      if (decoded.eventName !== "SkillPurchased") continue;

      const { purchaseId, listingId, buyer, revision, price } = decoded.args;
      if (
        typeof purchaseId !== "string" ||
        typeof listingId !== "string" ||
        typeof buyer !== "string" ||
        typeof revision !== "bigint" ||
        typeof price !== "bigint"
      ) {
        throw new Error("Base purchase event has unexpected fields");
      }

      return {
        purchaseId: requireBaseBytes32(purchaseId, "Base purchase id"),
        listingId: requireBaseBytes32(listingId, "Base listing id"),
        buyer: requireBaseEvmAddress(buyer, "Base buyer"),
        revision,
        price,
      };
    } catch (error) {
      if (error instanceof Error && /unexpected fields/.test(error.message)) {
        throw error;
      }
    }
  }

  throw new Error("Base purchase transaction did not emit SkillPurchased");
}

export async function verifyBaseDirectPurchase(
  input: VerifyBaseDirectPurchaseInput
): Promise<BaseDirectPurchaseTxVerificationResult> {
  const txHash = requireTxHash(input.txHash.trim());
  const chainContext = input.skill.chain_context;
  if (chainContext !== BASE_SEPOLIA_CHAIN_CONTEXT) {
    throw new Error("Skill is linked to a different chain context");
  }

  const listingId = requireBaseBytes32(
    input.listingId ?? input.skill.evm_listing_id ?? "",
    "Base listing id"
  );
  if (!input.skill.evm_listing_id || input.skill.evm_listing_id !== listingId) {
    throw new Error("Base listing does not match this skill");
  }

  const expectedPriceMicros = normalizeMicros(input.skill.price_usdc_micros);
  if (!expectedPriceMicros) {
    throw new Error("Skill is missing paid Base USDC price metadata");
  }
  if (
    input.expectedPriceUsdcMicros &&
    normalizeMicros(input.expectedPriceUsdcMicros) !== expectedPriceMicros
  ) {
    throw new Error("Submitted Base purchase price does not match this skill");
  }
  const expectedPrice = BigInt(expectedPriceMicros);
  const contract = getExpectedBaseContract({
    skill: input.skill,
    configuredContract: BASE_AGENTVOUCH_CONTRACT_ADDRESS,
  });
  const currency = getExpectedBaseCurrency({
    skill: input.skill,
    configuredUsdc: BASE_USDC_ADDRESS,
    nativeUsdc: BASE_NATIVE_USDC_ADDRESS,
    usage: "purchases",
  });

  const [listing, event] = await Promise.all([
    fetchLiveListing({ contract, listingId }),
    findSkillPurchasedEvent({ contract, txHash }),
  ]);

  if (listing.priceUsdcMicros !== expectedPrice) {
    throw new Error("Live Base listing price does not match this skill");
  }
  if (event.listingId !== listingId) {
    throw new Error("Base purchase event listing does not match this skill");
  }
  if (event.price !== expectedPrice) {
    throw new Error("Base purchase event price does not match this skill");
  }
  if (
    input.buyerAddress &&
    getAddress(event.buyer) !==
      requireBaseEvmAddress(input.buyerAddress, "Buyer")
  ) {
    throw new Error("Base purchase buyer does not match the submitted wallet");
  }

  return {
    buyerAddress: event.buyer,
    txHash,
    listingId,
    purchaseId: event.purchaseId,
    amountMicros: expectedPriceMicros,
    currencyMint: currency,
    paymentFlow: DIRECT_PURCHASE_PAYMENT_FLOW,
    protocolVersion:
      input.skill.on_chain_protocol_version ?? BASE_AGENTVOUCH_PROTOCOL_VERSION,
    onChainProgramId: contract,
    chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
    listingRevision: event.revision.toString(),
  };
}

export async function verifyBaseExistingPurchase(
  input: VerifyBaseExistingPurchaseInput
): Promise<BaseDirectPurchaseVerificationResult> {
  const chainContext = input.skill.chain_context;
  if (chainContext !== BASE_SEPOLIA_CHAIN_CONTEXT) {
    throw new Error("Skill is linked to a different chain context");
  }

  const listingId = requireBaseBytes32(
    input.listingId ?? input.skill.evm_listing_id ?? "",
    "Base listing id"
  );
  if (!input.skill.evm_listing_id || input.skill.evm_listing_id !== listingId) {
    throw new Error("Base listing does not match this skill");
  }

  const expectedPriceMicros = normalizeMicros(input.skill.price_usdc_micros);
  if (!expectedPriceMicros) {
    throw new Error("Skill is missing paid Base USDC price metadata");
  }
  if (
    input.expectedPriceUsdcMicros &&
    normalizeMicros(input.expectedPriceUsdcMicros) !== expectedPriceMicros
  ) {
    throw new Error("Submitted Base purchase price does not match this skill");
  }

  const buyer = requireBaseEvmAddress(input.buyerAddress, "Buyer");
  const expectedPrice = BigInt(expectedPriceMicros);
  const contract = getExpectedBaseContract({
    skill: input.skill,
    configuredContract: BASE_AGENTVOUCH_CONTRACT_ADDRESS,
  });
  const currency = getExpectedBaseCurrency({
    skill: input.skill,
    configuredUsdc: BASE_USDC_ADDRESS,
    nativeUsdc: BASE_NATIVE_USDC_ADDRESS,
    usage: "purchases",
  });
  const listing = await fetchLiveListing({ contract, listingId });
  if (listing.priceUsdcMicros !== expectedPrice) {
    throw new Error("Live Base listing price does not match this skill");
  }

  const publicClient = createBasePublicClient();
  const purchaseId = (await publicClient.readContract({
    address: contract,
    abi: AGENTVOUCH_EVM_PURCHASE_ABI,
    functionName: "purchaseId",
    args: [buyer, listingId, listing.currentRevision],
  })) as Hex;
  const purchase = (await publicClient.readContract({
    address: contract,
    abi: AGENTVOUCH_EVM_PURCHASE_ABI,
    functionName: "getPurchase",
    args: [purchaseId],
  })) as unknown;
  const normalizedPurchase = normalizeBasePurchaseTuple(purchase);

  if (!normalizedPurchase.exists) {
    throw new Error("Base purchase receipt was not found on-chain");
  }
  if (
    getAddress(normalizedPurchase.buyer) !== buyer ||
    normalizedPurchase.listingId !== listingId ||
    normalizedPurchase.revision !== listing.currentRevision ||
    normalizedPurchase.priceUsdcMicros !== expectedPrice
  ) {
    throw new Error("Base purchase receipt does not match this skill");
  }

  return {
    buyerAddress: buyer,
    txHash: `base-existing:${purchaseId}`,
    listingId,
    purchaseId,
    amountMicros: expectedPriceMicros,
    currencyMint: currency,
    paymentFlow: DIRECT_PURCHASE_PAYMENT_FLOW,
    protocolVersion:
      input.skill.on_chain_protocol_version ?? BASE_AGENTVOUCH_PROTOCOL_VERSION,
    onChainProgramId: contract,
    chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
    listingRevision: normalizedPurchase.revision.toString(),
  };
}

export async function verifyAndRecordBaseDirectPurchase(
  input: VerifyBaseDirectPurchaseInput
): Promise<BaseDirectPurchaseTxVerificationResult> {
  const verification = await verifyBaseDirectPurchase(input);

  await recordUsdcPurchaseReceipt({
    skillDbId: input.skill.id,
    buyerPubkey: verification.buyerAddress.toLowerCase(),
    buyerChainContext: verification.chainContext,
    buyerAddress: verification.buyerAddress,
    paymentTxSignature: verification.txHash,
    recipientAta: verification.onChainProgramId,
    recipientChainContext: verification.chainContext,
    recipientAddress: verification.onChainProgramId,
    currencyMint: verification.currencyMint,
    assetChainContext: verification.chainContext,
    assetAddress: verification.currencyMint,
    amountMicros: verification.amountMicros,
    paymentFlow: DIRECT_PURCHASE_PAYMENT_FLOW,
    protocolVersion: verification.protocolVersion,
    onChainProgramId: verification.onChainProgramId,
    chainContext: verification.chainContext,
    onChainAddress: null,
    evmListingId: verification.listingId,
    evmPurchaseId: verification.purchaseId,
    purchasePda: null,
    listingRevision: verification.listingRevision,
    settlementPda: null,
    authorProceedsVault: verification.onChainProgramId,
    refundStatus: "none",
    legacyRefundEligible: false,
  });

  console.info(
    `[purchase-verify] recorded Base purchase entitlement: skill=${input.skill.id} listing=${verification.listingId} buyer=${verification.buyerAddress} tx=${verification.txHash}`
  );

  return verification;
}

export async function verifyAndRecordBaseExistingPurchase(
  input: VerifyBaseExistingPurchaseInput
): Promise<BaseDirectPurchaseVerificationResult> {
  const verification = await verifyBaseExistingPurchase(input);

  await recordUsdcPurchaseReceipt({
    skillDbId: input.skill.id,
    buyerPubkey: verification.buyerAddress.toLowerCase(),
    buyerChainContext: verification.chainContext,
    buyerAddress: verification.buyerAddress,
    paymentTxSignature: verification.txHash,
    recipientAta: verification.onChainProgramId,
    recipientChainContext: verification.chainContext,
    recipientAddress: verification.onChainProgramId,
    currencyMint: verification.currencyMint,
    assetChainContext: verification.chainContext,
    assetAddress: verification.currencyMint,
    amountMicros: verification.amountMicros,
    paymentFlow: DIRECT_PURCHASE_PAYMENT_FLOW,
    protocolVersion: verification.protocolVersion,
    onChainProgramId: verification.onChainProgramId,
    chainContext: verification.chainContext,
    onChainAddress: null,
    evmListingId: verification.listingId,
    evmPurchaseId: verification.purchaseId,
    purchasePda: null,
    listingRevision: verification.listingRevision,
    settlementPda: null,
    authorProceedsVault: verification.onChainProgramId,
    refundStatus: "none",
    legacyRefundEligible: false,
  });

  console.info(
    `[purchase-verify] recorded existing Base purchase entitlement: skill=${input.skill.id} listing=${verification.listingId} buyer=${verification.buyerAddress} purchase=${verification.purchaseId}`
  );

  return verification;
}
