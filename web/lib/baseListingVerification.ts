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
  computeListingId,
  getExpectedBaseContract,
  getExpectedBaseCurrency,
  requireBaseBytes32,
  requireBaseEvmAddress,
  skillIdHashFrom,
} from "@/lib/adapters/baseListing";
import {
  BASE_SEPOLIA_CHAIN_CONTEXT,
  normalizeInputChainContext,
} from "@/lib/chains";

export const BASE_AGENTVOUCH_PROTOCOL_VERSION = "base-poc-v0";

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

const AGENTVOUCH_EVM_LISTING_ABI = parseAbi([
  ...AGENTVOUCH_EVM_READ_ABI,
  "event SkillListingCreated(bytes32 indexed listingId, address indexed author, uint256 price, bool free)",
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

type SkillListingCreatedEvent = {
  listingId: Hex;
  author: Address;
  price: bigint;
  free: boolean;
};

export type BaseSkillListingRow = {
  id: string;
  skill_id: string;
  author_pubkey: string | null;
  name: string;
  description: string | null;
  price_usdc_micros: string | null;
  currency_mint: string | null;
  chain_context: string | null;
  on_chain_protocol_version: string | null;
  on_chain_program_id: string | null;
  evm_listing_id: string | null;
  evm_contract_address: string | null;
};

export type VerifyBaseSkillListingInput = {
  skill: BaseSkillListingRow;
  txHash?: string | null;
  authorAddress?: string | null;
  expectedPriceUsdcMicros?: string | null;
  expectedUri?: string | null;
};

export type BaseSkillListingVerificationResult = {
  authorAddress: Address;
  txHash: Hex | null;
  listingId: Hex;
  skillIdHash: Hex;
  priceUsdcMicros: string | null;
  currencyMint: Address;
  protocolVersion: string;
  onChainProgramId: Address;
  chainContext: typeof BASE_SEPOLIA_CHAIN_CONTEXT;
  listingRevision: string;
};

function requireTxHash(value: string): Hex {
  if (!TX_HASH_RE.test(value)) {
    throw new Error(
      "Base listing transaction hash must be a 32-byte hex value"
    );
  }
  return value as Hex;
}

function normalizeMicrosAllowZero(
  value: string | null | undefined
): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  return BigInt(trimmed).toString();
}

export function isSameSkillRawUri(input: {
  actual: string;
  expected: string;
}): boolean {
  if (input.actual === input.expected) return true;
  try {
    const actualUrl = new URL(input.actual);
    const expectedUrl = new URL(input.expected);
    return (
      actualUrl.pathname === expectedUrl.pathname &&
      actualUrl.search === expectedUrl.search
    );
  } catch {
    return false;
  }
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
      `Base listing verification requires chain id ${BASE_SEPOLIA_CHAIN_ID}; RPC returned ${chainId}`
    );
  }

  const listing = (await publicClient.readContract({
    address: input.contract,
    abi: AGENTVOUCH_EVM_LISTING_ABI,
    functionName: "getListing",
    args: [input.listingId],
  })) as unknown as RawListing;

  if (!listing.exists) {
    throw new Error("Base listing was not found on-chain");
  }
  if (listing.status !== LISTING_STATUS_ACTIVE || listing.lockedByDispute) {
    throw new Error("Base listing is not active");
  }
  return listing;
}

async function findSkillListingCreatedEvent(input: {
  contract: Address;
  txHash: Hex;
}): Promise<SkillListingCreatedEvent> {
  const receipt = await createBasePublicClient().getTransactionReceipt({
    hash: input.txHash,
  });
  if (receipt.status !== "success") {
    throw new Error("Base listing transaction failed on-chain");
  }

  for (const log of receipt.logs) {
    if (getAddress(log.address) !== input.contract) continue;
    try {
      const decoded = decodeEventLog({
        abi: AGENTVOUCH_EVM_LISTING_ABI,
        data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]],
      }) as unknown as {
        eventName: string;
        args: Record<string, unknown>;
      };
      if (decoded.eventName !== "SkillListingCreated") continue;

      const { listingId, author, price, free } = decoded.args;
      if (
        typeof listingId !== "string" ||
        typeof author !== "string" ||
        typeof price !== "bigint" ||
        typeof free !== "boolean"
      ) {
        throw new Error("Base listing event has unexpected fields");
      }

      return {
        listingId: requireBaseBytes32(listingId, "Base listing id"),
        author: requireBaseEvmAddress(author, "Base author"),
        price,
        free,
      };
    } catch (error) {
      if (error instanceof Error && /unexpected fields/.test(error.message)) {
        throw error;
      }
    }
  }

  throw new Error("Base listing transaction did not emit SkillListingCreated");
}

export async function verifyBaseSkillListing(
  input: VerifyBaseSkillListingInput
): Promise<BaseSkillListingVerificationResult> {
  const rawTxHash = input.txHash?.trim() ?? "";
  const txHash = rawTxHash ? requireTxHash(rawTxHash) : null;
  const chainContext = normalizeInputChainContext(input.skill.chain_context);
  if (chainContext !== BASE_SEPOLIA_CHAIN_CONTEXT) {
    throw new Error("Skill is linked to a different chain context");
  }
  if (!input.skill.author_pubkey) {
    throw new Error("Base skill is missing an author address");
  }

  const author = requireBaseEvmAddress(
    input.skill.author_pubkey,
    "Skill author"
  );
  if (
    input.authorAddress &&
    author !== requireBaseEvmAddress(input.authorAddress, "Submitted author")
  ) {
    throw new Error("Submitted Base author does not match this skill");
  }

  const expectedPriceMicros = normalizeMicrosAllowZero(
    input.expectedPriceUsdcMicros ?? input.skill.price_usdc_micros ?? "0"
  );
  if (expectedPriceMicros === null) {
    throw new Error("Submitted Base listing price is invalid");
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
    usage: "listings",
  });
  const skillIdHash = skillIdHashFrom(input.skill.skill_id);
  const expectedListingId = computeListingId(author, skillIdHash);

  const [listing, event] = await Promise.all([
    fetchLiveListing({ contract, listingId: expectedListingId }),
    txHash ? findSkillListingCreatedEvent({ contract, txHash }) : null,
  ]);

  if (event && event.listingId !== expectedListingId) {
    throw new Error("Base listing event does not match this skill");
  }
  if ((event && event.author !== author) || listing.author !== author) {
    throw new Error("Base listing author does not match this skill");
  }
  if (
    (event && event.price !== expectedPrice) ||
    listing.priceUsdcMicros !== expectedPrice
  ) {
    throw new Error("Base listing price does not match this skill");
  }
  if (event && event.free !== (expectedPrice === 0n)) {
    throw new Error("Base listing free flag does not match its price");
  }
  if (listing.skillIdHash !== skillIdHash) {
    throw new Error("Base listing skill id hash does not match this skill");
  }
  if (listing.name !== input.skill.name) {
    throw new Error("Base listing name does not match this skill");
  }
  if (listing.description !== (input.skill.description ?? "")) {
    throw new Error("Base listing description does not match this skill");
  }
  if (
    input.expectedUri &&
    !isSameSkillRawUri({
      actual: listing.uri,
      expected: input.expectedUri,
    })
  ) {
    throw new Error("Base listing URI does not match this skill");
  }

  return {
    authorAddress: author,
    txHash,
    listingId: expectedListingId,
    skillIdHash,
    priceUsdcMicros: expectedPrice > 0n ? expectedPriceMicros : null,
    currencyMint: currency,
    protocolVersion:
      input.skill.on_chain_protocol_version ?? BASE_AGENTVOUCH_PROTOCOL_VERSION,
    onChainProgramId: contract,
    chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
    listingRevision: listing.currentRevision.toString(),
  };
}
