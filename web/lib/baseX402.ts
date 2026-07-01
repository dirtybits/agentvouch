import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodePacked,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseAbi,
  parseAbiParameters,
  parseSignature,
  recoverAddress,
  serializeSignature,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
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
import { BASE_SEPOLIA_CHAIN_CONTEXT } from "@/lib/chains";
import { getErrorMessage } from "@/lib/errors";
import { verifyBaseDirectPurchase } from "@/lib/basePurchaseVerification";
import { recordUsdcPurchaseReceipt } from "@/lib/usdcPurchases";
import type { X402PaymentPayload, X402PaymentRequirements } from "@/lib/x402";

export const BASE_X402_PURCHASE_PAYMENT_FLOW = "base-x402-purchase-skill";

const RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
  stringToHex(
    "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
  )
);
const MAX_AUTHORIZATION_SECONDS = 3600n;

const AGENTVOUCH_EVM_X402_ABI = parseAbi([
  ...AGENTVOUCH_EVM_READ_ABI,
  "function purchaseWithAuthorization(bytes32 id, address buyer, uint256 validAfter, uint256 validBefore, uint8 v, bytes32 r, bytes32 s) returns (bytes32)",
]);

const USDC_EIP3009_ABI = parseAbi([
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
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

export type BaseX402Skill = {
  id: string;
  price_usdc_micros: string | null;
  currency_mint: string | null;
  chain_context: string | null;
  on_chain_protocol_version: string | null;
  on_chain_program_id: string | null;
  evm_listing_id: string | null;
  evm_contract_address: string | null;
};

export type VerifiedBaseX402Payload = {
  buyerAddress: Address;
  listingId: Hex;
  listingRevision: string;
  priceUsdcMicros: bigint;
  validAfter: bigint;
  validBefore: bigint;
  v: number;
  r: Hex;
  s: Hex;
  signature: Hex;
  authorizationNonce: Hex;
  paymentRefHashHex: string;
};

export type BaseX402SettlementResult = {
  transaction: Hex;
  payer: Address;
  listingId: Hex;
  purchaseId: Hex;
  paymentRefHashHex: string;
  listingRevision: string;
};

function createBasePublicClient() {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(BASE_SEPOLIA_RPC_URL),
  });
}

function parseBigNumberish(value: unknown, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  throw new Error(`${label} must be an unsigned integer`);
}

function parseSignaturePayload(payload: Record<string, unknown>): {
  signature: Hex;
  v: number;
  r: Hex;
  s: Hex;
} {
  if (
    typeof payload.signature === "string" &&
    /^0x[0-9a-fA-F]{130}$/.test(payload.signature)
  ) {
    const signature = payload.signature as Hex;
    const parsed = parseSignature(signature);
    const v =
      parsed.v !== undefined
        ? Number(parsed.v)
        : Number(parsed.yParity ?? 0) + 27;
    return {
      signature,
      v,
      r: parsed.r,
      s: parsed.s,
    };
  }

  if (
    typeof payload.r === "string" &&
    /^0x[0-9a-fA-F]{64}$/.test(payload.r) &&
    typeof payload.s === "string" &&
    /^0x[0-9a-fA-F]{64}$/.test(payload.s)
  ) {
    const rawV = parseBigNumberish(payload.v, "EIP-3009 v");
    const v = Number(rawV);
    if (v !== 27 && v !== 28) {
      throw new Error("EIP-3009 v must be 27 or 28");
    }
    const signature = serializeSignature({
      r: payload.r as Hex,
      s: payload.s as Hex,
      v: BigInt(v),
    });
    return {
      signature,
      v,
      r: payload.r as Hex,
      s: payload.s as Hex,
    };
  }

  throw new Error("PAYMENT-SIGNATURE is missing an EIP-3009 signature");
}

function buildAuthorizationNonce(input: {
  buyer: Address;
  listingId: Hex;
  listingRevision: bigint;
  priceUsdcMicros: bigint;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("address, bytes32, uint64, uint256"),
      [
        input.buyer,
        input.listingId,
        input.listingRevision,
        input.priceUsdcMicros,
      ]
    )
  );
}

async function getUsdcDomainSeparator(usdcAddress: Address): Promise<Hex> {
  return (await createBasePublicClient().readContract({
    address: usdcAddress,
    abi: USDC_EIP3009_ABI,
    functionName: "DOMAIN_SEPARATOR",
  })) as Hex;
}

function buildAuthorizationDigest(input: {
  buyer: Address;
  contract: Address;
  domainSeparator: Hex;
  priceUsdcMicros: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}): Hex {
  const structHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32, address, address, uint256, uint256, uint256, bytes32"
      ),
      [
        RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
        input.buyer,
        input.contract,
        input.priceUsdcMicros,
        input.validAfter,
        input.validBefore,
        input.nonce,
      ]
    )
  );
  return keccak256(
    encodePacked(
      ["bytes2", "bytes32", "bytes32"],
      ["0x1901", input.domainSeparator, structHash]
    )
  );
}

async function fetchLiveListing(input: {
  contract: Address;
  listingId: Hex;
}): Promise<RawListing> {
  const publicClient = createBasePublicClient();
  const chainId = await publicClient.getChainId();
  if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(
      `Base x402 requires chain id ${BASE_SEPOLIA_CHAIN_ID}; RPC returned ${chainId}`
    );
  }

  const listing = (await publicClient.readContract({
    address: input.contract,
    abi: AGENTVOUCH_EVM_X402_ABI,
    functionName: "getListing",
    args: [input.listingId],
  })) as unknown as RawListing;

  if (!listing.exists) throw new Error("Base listing was not found on-chain");
  if (listing.status !== LISTING_STATUS_ACTIVE || listing.lockedByDispute) {
    throw new Error("Base listing is not purchasable");
  }
  if (listing.priceUsdcMicros <= 0n) {
    throw new Error("Base x402 cannot purchase a free listing");
  }
  return listing;
}

function getRelayerPrivateKey(): Hex {
  const value =
    process.env.BASE_X402_RELAYER_PRIVATE_KEY ||
    process.env.AGENTVOUCH_BASE_RELAYER_PRIVATE_KEY ||
    "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(
      "Base x402 settlement requires BASE_X402_RELAYER_PRIVATE_KEY or AGENTVOUCH_BASE_RELAYER_PRIVATE_KEY"
    );
  }
  return value as Hex;
}

export function buildBaseX402Requirement(input: {
  skillDbId: string;
  listingId: Hex;
  priceUsdcMicros: bigint;
  listingRevision: bigint;
}): X402PaymentRequirements {
  return {
    scheme: "exact",
    network: BASE_SEPOLIA_CHAIN_CONTEXT,
    amount: input.priceUsdcMicros.toString(),
    asset: getAddress(BASE_NATIVE_USDC_ADDRESS),
    payTo: getAddress(BASE_AGENTVOUCH_CONTRACT_ADDRESS),
    maxTimeoutSeconds: Number(MAX_AUTHORIZATION_SECONDS),
    extra: {
      agentvouch_payment_flow: BASE_X402_PURCHASE_PAYMENT_FLOW,
      agentvouch_skill_db_id: input.skillDbId,
      agentvouch_listing_id: input.listingId,
      agentvouch_contract: getAddress(BASE_AGENTVOUCH_CONTRACT_ADDRESS),
      eip3009_authorization: "receiveWithAuthorization",
      authorization_to: getAddress(BASE_AGENTVOUCH_CONTRACT_ADDRESS),
      authorization_nonce:
        "keccak256(abi.encode(buyer, listingId, revision, priceUsdcMicros))",
      listing_revision: input.listingRevision.toString(),
      valid_before_max_seconds: Number(MAX_AUTHORIZATION_SECONDS),
    },
  };
}

export async function buildBaseX402PaymentRequirement(input: {
  skillDbId: string;
  skill: BaseX402Skill;
  priceUsdcMicros: bigint;
}): Promise<X402PaymentRequirements> {
  if (input.skill.chain_context !== BASE_SEPOLIA_CHAIN_CONTEXT) {
    throw new Error("Base x402 skill is linked to a different chain");
  }
  const listingId = requireBaseBytes32(
    input.skill.evm_listing_id ?? "",
    "Base listing id"
  );
  const contract = getExpectedBaseContract({
    skill: input.skill,
    configuredContract: BASE_AGENTVOUCH_CONTRACT_ADDRESS,
  });
  const listing = await fetchLiveListing({ contract, listingId });
  if (listing.priceUsdcMicros !== input.priceUsdcMicros) {
    throw new Error("Live Base listing price does not match this skill");
  }
  getExpectedBaseCurrency({
    skill: input.skill,
    configuredUsdc: BASE_USDC_ADDRESS,
    nativeUsdc: BASE_NATIVE_USDC_ADDRESS,
    usage: "x402",
  });

  return buildBaseX402Requirement({
    skillDbId: input.skillDbId,
    listingId,
    priceUsdcMicros: input.priceUsdcMicros,
    listingRevision: listing.currentRevision,
  });
}

function validateAcceptedRequirement(
  payload: X402PaymentPayload,
  requirement: X402PaymentRequirements
): string | null {
  const accepted = payload.accepted;
  if (accepted.scheme !== requirement.scheme) return "x402 scheme mismatch";
  if (accepted.network !== requirement.network) return "x402 network mismatch";
  if (accepted.amount !== requirement.amount) return "x402 amount mismatch";
  if (!isAddress(accepted.asset)) return "x402 asset is not an EVM address";
  if (!isAddress(accepted.payTo)) return "x402 payTo is not an EVM address";
  if (getAddress(accepted.asset) !== getAddress(requirement.asset)) {
    return "x402 asset mismatch";
  }
  if (getAddress(accepted.payTo) !== getAddress(requirement.payTo)) {
    return "x402 payTo mismatch";
  }
  if (
    accepted.extra?.agentvouch_listing_id !==
    requirement.extra.agentvouch_listing_id
  ) {
    return "x402 listing mismatch";
  }
  if (
    accepted.extra?.agentvouch_payment_flow !== BASE_X402_PURCHASE_PAYMENT_FLOW
  ) {
    return "x402 payment flow mismatch";
  }
  return null;
}

export async function verifyBaseX402PaymentPayload(input: {
  skillDbId: string;
  skill: BaseX402Skill;
  priceUsdcMicros: bigint;
  payload: X402PaymentPayload;
}): Promise<VerifiedBaseX402Payload> {
  if (input.skill.chain_context !== BASE_SEPOLIA_CHAIN_CONTEXT) {
    throw new Error("Base x402 skill is linked to a different chain");
  }
  const listingId = requireBaseBytes32(
    input.skill.evm_listing_id ?? "",
    "Base listing id"
  );
  const contract = getExpectedBaseContract({
    skill: input.skill,
    configuredContract: BASE_AGENTVOUCH_CONTRACT_ADDRESS,
  });
  const usdcAddress = getExpectedBaseCurrency({
    skill: input.skill,
    configuredUsdc: BASE_USDC_ADDRESS,
    nativeUsdc: BASE_NATIVE_USDC_ADDRESS,
    usage: "x402",
  });
  const [listing, domainSeparator] = await Promise.all([
    fetchLiveListing({ contract, listingId }),
    getUsdcDomainSeparator(usdcAddress),
  ]);
  if (listing.priceUsdcMicros !== input.priceUsdcMicros) {
    throw new Error("Live Base listing price does not match this skill");
  }

  const requirement = buildBaseX402Requirement({
    skillDbId: input.skillDbId,
    listingId,
    priceUsdcMicros: input.priceUsdcMicros,
    listingRevision: listing.currentRevision,
  });
  const mismatch = validateAcceptedRequirement(input.payload, requirement);
  if (mismatch) throw new Error(mismatch);

  const buyer = requireBaseEvmAddress(
    String(input.payload.payload.buyer ?? ""),
    "Base x402 buyer"
  );
  const validAfter = parseBigNumberish(
    input.payload.payload.validAfter ?? 0,
    "EIP-3009 validAfter"
  );
  const validBefore = parseBigNumberish(
    input.payload.payload.validBefore,
    "EIP-3009 validBefore"
  );
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (validAfter > now) {
    throw new Error("EIP-3009 authorization is not valid yet");
  }
  if (validBefore <= now) {
    throw new Error("EIP-3009 authorization expired");
  }
  if (validBefore - now > MAX_AUTHORIZATION_SECONDS) {
    throw new Error("EIP-3009 authorization window is too long");
  }

  const authorizationNonce = buildAuthorizationNonce({
    buyer,
    listingId,
    listingRevision: listing.currentRevision,
    priceUsdcMicros: input.priceUsdcMicros,
  });
  const submittedNonce = input.payload.payload.nonce;
  if (
    typeof submittedNonce === "string" &&
    submittedNonce !== authorizationNonce
  ) {
    throw new Error("EIP-3009 nonce does not match the Base listing");
  }

  const signature = parseSignaturePayload(input.payload.payload);
  const digest = buildAuthorizationDigest({
    buyer,
    contract,
    domainSeparator,
    priceUsdcMicros: input.priceUsdcMicros,
    validAfter,
    validBefore,
    nonce: authorizationNonce,
  });
  const recovered = await recoverAddress({
    hash: digest,
    signature: signature.signature,
  });
  if (getAddress(recovered) !== buyer) {
    throw new Error("EIP-3009 signature does not match the buyer");
  }

  const paymentRefHashHex = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "address, bytes32, uint256, uint256, uint256, bytes32"
      ),
      [
        buyer,
        listingId,
        input.priceUsdcMicros,
        validAfter,
        validBefore,
        authorizationNonce,
      ]
    )
  ).slice(2);

  return {
    buyerAddress: buyer,
    listingId,
    listingRevision: listing.currentRevision.toString(),
    priceUsdcMicros: input.priceUsdcMicros,
    validAfter,
    validBefore,
    v: signature.v,
    r: signature.r,
    s: signature.s,
    signature: signature.signature,
    authorizationNonce,
    paymentRefHashHex,
  };
}

export async function relayAndRecordBaseX402Purchase(input: {
  skillDbId: string;
  skill: BaseX402Skill;
  verified: VerifiedBaseX402Payload;
}): Promise<BaseX402SettlementResult> {
  const relayer = privateKeyToAccount(getRelayerPrivateKey());
  const publicClient = createBasePublicClient();
  const contract = getExpectedBaseContract({
    skill: input.skill,
    configuredContract: BASE_AGENTVOUCH_CONTRACT_ADDRESS,
  });
  const walletClient = createWalletClient({
    account: relayer,
    chain: baseSepolia,
    transport: http(BASE_SEPOLIA_RPC_URL),
  });

  const args = [
    input.verified.listingId,
    input.verified.buyerAddress,
    input.verified.validAfter,
    input.verified.validBefore,
    input.verified.v,
    input.verified.r,
    input.verified.s,
  ] as const;

  try {
    await publicClient.simulateContract({
      address: contract,
      abi: AGENTVOUCH_EVM_X402_ABI,
      functionName: "purchaseWithAuthorization",
      args,
      account: relayer.address,
    });
  } catch (error) {
    throw new Error(`Base x402 simulation failed: ${getErrorMessage(error)}`);
  }

  const txHash = await walletClient.writeContract({
    address: contract,
    abi: AGENTVOUCH_EVM_X402_ABI,
    functionName: "purchaseWithAuthorization",
    args,
    gas: 500_000n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  if (receipt.status !== "success") {
    throw new Error("Base x402 settlement transaction failed on-chain");
  }

  const verification = await verifyBaseDirectPurchase({
    skill: input.skill,
    txHash,
    buyerAddress: input.verified.buyerAddress,
    listingId: input.verified.listingId,
    expectedPriceUsdcMicros: input.verified.priceUsdcMicros.toString(),
  });

  await recordUsdcPurchaseReceipt({
    skillDbId: input.skillDbId,
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
    paymentFlow: BASE_X402_PURCHASE_PAYMENT_FLOW,
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
    x402PaymentRefHash: input.verified.paymentRefHashHex,
    x402SettlementSignatureHash: verification.txHash.slice(2),
    x402SettlementReceiptPda: null,
    x402SettlementVault: verification.onChainProgramId,
    refundStatus: "none",
    legacyRefundEligible: false,
  });

  return {
    transaction: verification.txHash,
    payer: verification.buyerAddress,
    listingId: verification.listingId,
    purchaseId: verification.purchaseId,
    paymentRefHashHex: input.verified.paymentRefHashHex,
    listingRevision: verification.listingRevision,
  };
}
