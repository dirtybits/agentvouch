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
import { AGENTVOUCH_EVM_A1_PAID_REPORT_WRITE_ABI } from "@/lib/adapters/agentVouchEvmAbi";
import {
  BASE_AGENTVOUCH_CONTRACT_ADDRESS,
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_RPC_URL,
} from "@/lib/adapters/baseConfig";
import {
  getExpectedBaseContract,
  requireBaseBytes32,
  requireBaseEvmAddress,
} from "@/lib/adapters/baseListing";
import { BASE_SEPOLIA_CHAIN_CONTEXT } from "@/lib/chains";
import {
  getEvmPaidPurchaseReceipt,
  recordEvmPaidPurchaseReportIndex,
  type EvmPaidPurchaseReportIndex,
} from "@/lib/usdcPurchases";

export const BASE_A1_PROTOCOL_VERSION = "base-v1-a1";
export const PAID_PURCHASE_REPORT_BOND_USDC_MICROS = 5_000_000n;

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const A1_ABI = parseAbi([...AGENTVOUCH_EVM_A1_PAID_REPORT_WRITE_ABI]);
type BasePublicClient = ReturnType<typeof createBasePublicClient>;

export type PaidReportSkillRow = {
  id: string;
  chain_context?: string | null;
  on_chain_protocol_version?: string | null;
  on_chain_program_id?: string | null;
  evm_listing_id?: string | null;
  evm_contract_address?: string | null;
};

type OpenedEvent = {
  reportId: bigint;
  buyer: Address;
  author: Address;
  listingId: Hex;
  purchaseId: Hex;
  bond: bigint;
  reviewDeadline: bigint;
  evidenceUri: string;
  logIndex: number;
};

type Purchase = {
  exists: boolean;
  buyer: Address;
  listingId: Hex;
  revision: bigint;
  priceUsdcMicros: bigint;
  authorShareUsdcMicros: bigint;
  voucherPoolUsdcMicros: bigint;
  timestamp: bigint;
  lane: number;
};

export type BasePaidPurchaseReportState = {
  reportId: string;
  buyerAddress: Address;
  authorAddress: Address;
  listingId: Hex;
  purchaseId: Hex;
  filedAt: string;
  reviewDeadline: string;
  acceptedAt: string;
  terminalAt: string;
  status: number;
  outcome: number;
  slashPercentage: number;
  activeVouchStakeUsdcMicros: string;
  processedPreSlashStakeUsdcMicros: string;
  authorBondSlashUsdcMicros: string;
  voucherSlashUsdcMicros: string;
  buyerEntitlementUsdcMicros: string;
  buyerCreditUsdcMicros: string;
  claimDeadline: string;
  creditHandled: boolean;
  evidenceUri: string;
};

export type VerifiedBasePaidPurchaseReport = {
  index: EvmPaidPurchaseReportIndex;
  state: BasePaidPurchaseReportState;
};

export type BasePaidPurchaseReportPreflight = {
  chainContext: typeof BASE_SEPOLIA_CHAIN_CONTEXT;
  contractAddress: Address;
  protocolVersion: typeof BASE_A1_PROTOCOL_VERSION;
  buyerAddress: Address;
  authorAddress: Address;
  listingId: Hex;
  purchaseId: Hex;
  purchaseRevision: string;
  purchasePriceUsdcMicros: string;
  purchaseTimestamp: string;
  filingDeadline: string;
  lane: number;
  paused: boolean;
  eligible: boolean;
  reason: string | null;
  requiresExactCallSimulation: boolean;
};

function requireTxHash(value: string): Hex {
  if (!TX_HASH_RE.test(value)) {
    throw new Error(
      "Paid-purchase report transaction hash must be a 32-byte hex value"
    );
  }
  return value as Hex;
}

function requireBigint(value: unknown, label: string): bigint {
  if (typeof value !== "bigint")
    throw new Error(`${label} has unexpected fields`);
  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number")
    throw new Error(`${label} has unexpected fields`);
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean")
    throw new Error(`${label} has unexpected fields`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string")
    throw new Error(`${label} has unexpected fields`);
  return value;
}

function field(value: unknown, name: string, index: number): unknown {
  const tuple = value as Record<string | number, unknown>;
  return tuple[name] ?? tuple[index];
}

export function normalizeA1Purchase(value: unknown): Purchase {
  return {
    exists: requireBoolean(field(value, "exists", 0), "A1 purchase"),
    buyer: requireBaseEvmAddress(
      requireString(field(value, "buyer", 1), "A1 purchase buyer"),
      "A1 purchase buyer"
    ),
    listingId: requireBaseBytes32(
      requireString(field(value, "listingId", 2), "A1 purchase listing id"),
      "A1 purchase listing id"
    ),
    revision: requireBigint(field(value, "revision", 3), "A1 purchase"),
    priceUsdcMicros: requireBigint(
      field(value, "priceUsdcMicros", 4),
      "A1 purchase"
    ),
    authorShareUsdcMicros: requireBigint(
      field(value, "authorShareUsdcMicros", 5),
      "A1 purchase"
    ),
    voucherPoolUsdcMicros: requireBigint(
      field(value, "voucherPoolUsdcMicros", 6),
      "A1 purchase"
    ),
    timestamp: requireBigint(field(value, "timestamp", 7), "A1 purchase"),
    lane: requireNumber(field(value, "lane", 8), "A1 purchase"),
  };
}

function normalizeReportState(input: {
  reportId: bigint;
  core: unknown;
  settlement: unknown;
  evidence: unknown;
}): BasePaidPurchaseReportState {
  return {
    reportId: input.reportId.toString(),
    buyerAddress: requireBaseEvmAddress(
      requireString(field(input.core, "buyer", 0), "Paid report buyer"),
      "Paid report buyer"
    ),
    authorAddress: requireBaseEvmAddress(
      requireString(field(input.core, "author", 1), "Paid report author"),
      "Paid report author"
    ),
    listingId: requireBaseBytes32(
      requireString(
        field(input.core, "listingId", 2),
        "Paid report listing id"
      ),
      "Paid report listing id"
    ),
    purchaseId: requireBaseBytes32(
      requireString(
        field(input.core, "purchaseId", 3),
        "Paid report purchase id"
      ),
      "Paid report purchase id"
    ),
    filedAt: requireBigint(
      field(input.core, "filedAt", 4),
      "Paid report core"
    ).toString(),
    reviewDeadline: requireBigint(
      field(input.core, "reviewDeadline", 5),
      "Paid report core"
    ).toString(),
    acceptedAt: requireBigint(
      field(input.core, "acceptedAt", 6),
      "Paid report core"
    ).toString(),
    terminalAt: requireBigint(
      field(input.core, "terminalAt", 7),
      "Paid report core"
    ).toString(),
    status: requireNumber(field(input.core, "status", 8), "Paid report core"),
    outcome: requireNumber(field(input.core, "outcome", 9), "Paid report core"),
    slashPercentage: requireNumber(
      field(input.settlement, "slashPercentage", 0),
      "Paid report settlement"
    ),
    activeVouchStakeUsdcMicros: requireBigint(
      field(input.settlement, "activeVouchStake", 1),
      "Paid report settlement"
    ).toString(),
    processedPreSlashStakeUsdcMicros: requireBigint(
      field(input.settlement, "processedPreSlashStake", 2),
      "Paid report settlement"
    ).toString(),
    authorBondSlashUsdcMicros: requireBigint(
      field(input.settlement, "authorBondSlash", 3),
      "Paid report settlement"
    ).toString(),
    voucherSlashUsdcMicros: requireBigint(
      field(input.settlement, "voucherSlash", 4),
      "Paid report settlement"
    ).toString(),
    buyerEntitlementUsdcMicros: requireBigint(
      field(input.settlement, "buyerEntitlement", 5),
      "Paid report settlement"
    ).toString(),
    buyerCreditUsdcMicros: requireBigint(
      field(input.settlement, "buyerCredit", 6),
      "Paid report settlement"
    ).toString(),
    claimDeadline: requireBigint(
      field(input.settlement, "claimDeadline", 7),
      "Paid report settlement"
    ).toString(),
    creditHandled: requireBoolean(
      field(input.settlement, "creditHandled", 8),
      "Paid report settlement"
    ),
    evidenceUri: requireString(input.evidence, "Paid report evidence"),
  };
}

function createBasePublicClient() {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(BASE_SEPOLIA_RPC_URL),
  });
}

async function assertBaseA1Deployment(
  client: BasePublicClient,
  contract: Address
): Promise<void> {
  const [chainId, protocolVersion] = await Promise.all([
    client.getChainId(),
    client.readContract({
      address: contract,
      abi: A1_ABI,
      functionName: "PROTOCOL_VERSION",
    }),
  ]);
  if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(
      `Paid-purchase report verification requires chain id ${BASE_SEPOLIA_CHAIN_ID}; RPC returned ${chainId}`
    );
  }
  if (protocolVersion !== BASE_A1_PROTOCOL_VERSION) {
    throw new Error("Selected Base deployment is not base-v1-a1");
  }
}

async function readFreshReportState(input: {
  client: BasePublicClient;
  contract: Address;
  reportId: bigint;
}): Promise<BasePaidPurchaseReportState> {
  const [core, settlement, evidence] = await Promise.all([
    input.client.readContract({
      address: input.contract,
      abi: A1_ABI,
      functionName: "getPaidPurchaseReportCore",
      args: [input.reportId],
    }),
    input.client.readContract({
      address: input.contract,
      abi: A1_ABI,
      functionName: "getPaidPurchaseReportSettlement",
      args: [input.reportId],
    }),
    input.client.readContract({
      address: input.contract,
      abi: A1_ABI,
      functionName: "getPaidPurchaseReportEvidence",
      args: [input.reportId],
    }),
  ]);
  return normalizeReportState({
    reportId: input.reportId,
    core,
    settlement,
    evidence,
  });
}

function decodeOpenedEvent(input: {
  receipt: Awaited<ReturnType<BasePublicClient["getTransactionReceipt"]>>;
  contract: Address;
  purchaseId: Hex;
}): OpenedEvent {
  const matches: OpenedEvent[] = [];
  for (const log of input.receipt.logs) {
    if (getAddress(log.address) !== input.contract) continue;
    try {
      const decoded = decodeEventLog({
        abi: A1_ABI,
        data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]],
      }) as unknown as { eventName: string; args: Record<string, unknown> };
      if (decoded.eventName !== "PaidPurchaseReportOpened") continue;
      const purchaseId = requireBaseBytes32(
        requireString(
          decoded.args.purchaseId,
          "Paid report opened purchase id"
        ),
        "Paid report opened purchase id"
      );
      if (purchaseId.toLowerCase() !== input.purchaseId.toLowerCase()) continue;
      matches.push({
        reportId: requireBigint(
          decoded.args.reportId,
          "Paid report opened event"
        ),
        buyer: requireBaseEvmAddress(
          requireString(decoded.args.buyer, "Paid report opened buyer"),
          "Paid report opened buyer"
        ),
        author: requireBaseEvmAddress(
          requireString(decoded.args.author, "Paid report opened author"),
          "Paid report opened author"
        ),
        listingId: requireBaseBytes32(
          requireString(
            decoded.args.listingId,
            "Paid report opened listing id"
          ),
          "Paid report opened listing id"
        ),
        purchaseId,
        bond: requireBigint(decoded.args.bond, "Paid report opened event"),
        reviewDeadline: requireBigint(
          decoded.args.reviewDeadline,
          "Paid report opened event"
        ),
        evidenceUri: requireString(
          decoded.args.evidenceUri,
          "Paid report opened evidence"
        ),
        logIndex: Number(log.logIndex),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        /unexpected fields|not a valid|must be/.test(error.message)
      ) {
        throw error;
      }
    }
  }
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? "Transaction did not emit PaidPurchaseReportOpened for the submitted purchase from the selected deployment"
        : "Transaction emitted multiple PaidPurchaseReportOpened events for the submitted purchase"
    );
  }
  return matches[0];
}

export function getBasePaidPurchaseReportContract(
  skill: PaidReportSkillRow
): Address {
  if (skill.chain_context !== BASE_SEPOLIA_CHAIN_CONTEXT) {
    throw new Error("Skill is linked to a different chain context");
  }
  if (skill.on_chain_protocol_version !== BASE_A1_PROTOCOL_VERSION) {
    throw new Error("Skill is not linked to the base-v1-a1 deployment");
  }
  return getExpectedBaseContract({
    skill,
    configuredContract: BASE_AGENTVOUCH_CONTRACT_ADDRESS,
  });
}

export async function verifyAndIndexBasePaidPurchaseReport(input: {
  skill: PaidReportSkillRow;
  txHash: string;
  purchaseId: string;
}): Promise<VerifiedBasePaidPurchaseReport> {
  const txHash = requireTxHash(input.txHash.trim());
  const submittedPurchaseId = requireBaseBytes32(
    input.purchaseId,
    "Paid report purchase id"
  );
  const contract = getBasePaidPurchaseReportContract(input.skill);
  const skillListingId = requireBaseBytes32(
    input.skill.evm_listing_id ?? "",
    "Skill Base listing id"
  );
  const client = createBasePublicClient();
  await assertBaseA1Deployment(client, contract);

  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error("Paid-purchase report transaction failed on-chain");
  }
  const stableBlock = await client.getBlock({ blockHash: receipt.blockHash });
  if (
    stableBlock.hash.toLowerCase() !== receipt.blockHash.toLowerCase() ||
    stableBlock.number !== receipt.blockNumber
  ) {
    throw new Error(
      "Paid-purchase report transaction block is no longer canonical"
    );
  }

  const opened = decodeOpenedEvent({
    receipt,
    contract,
    purchaseId: submittedPurchaseId,
  });
  if (opened.listingId.toLowerCase() !== skillListingId.toLowerCase()) {
    throw new Error("Paid report event listing does not match this skill");
  }
  if (opened.bond !== PAID_PURCHASE_REPORT_BOND_USDC_MICROS) {
    throw new Error(
      "Paid report event bond does not match the locked 5 USDC bond"
    );
  }

  const [rawPurchase, rawListing, state] = await Promise.all([
    client.readContract({
      address: contract,
      abi: A1_ABI,
      functionName: "getPurchase",
      args: [opened.purchaseId],
    }),
    client.readContract({
      address: contract,
      abi: A1_ABI,
      functionName: "getListing",
      args: [opened.listingId],
    }),
    readFreshReportState({ client, contract, reportId: opened.reportId }),
  ]);
  const purchase = normalizeA1Purchase(rawPurchase);
  const listingAuthor = requireBaseEvmAddress(
    requireString(field(rawListing, "author", 0), "A1 listing author"),
    "A1 listing author"
  );
  const listingExists = requireBoolean(
    field(rawListing, "exists", 11),
    "A1 listing"
  );
  if (
    !purchase.exists ||
    !listingExists ||
    purchase.priceUsdcMicros === 0n ||
    (purchase.lane !== 1 && purchase.lane !== 2)
  ) {
    throw new Error(
      "Paid report purchase is not an eligible Direct or Authorization receipt"
    );
  }
  if (
    getAddress(purchase.buyer) !== getAddress(opened.buyer) ||
    purchase.listingId.toLowerCase() !== opened.listingId.toLowerCase() ||
    getAddress(listingAuthor) !== getAddress(opened.author)
  ) {
    throw new Error(
      "Paid report event does not match the on-chain purchase and listing"
    );
  }
  if (
    getAddress(state.buyerAddress) !== getAddress(opened.buyer) ||
    getAddress(state.authorAddress) !== getAddress(opened.author) ||
    state.listingId.toLowerCase() !== opened.listingId.toLowerCase() ||
    state.purchaseId.toLowerCase() !== opened.purchaseId.toLowerCase() ||
    state.reviewDeadline !== opened.reviewDeadline.toString() ||
    state.evidenceUri !== opened.evidenceUri
  ) {
    throw new Error(
      "Paid report event does not match fresh on-chain report state"
    );
  }

  const purchaseReceipt = await getEvmPaidPurchaseReceipt({
    skillDbId: input.skill.id,
    chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
    contractAddress: contract,
    protocolVersion: BASE_A1_PROTOCOL_VERSION,
    buyerAddress: opened.buyer,
    listingId: opened.listingId,
    purchaseId: opened.purchaseId,
  });
  if (!purchaseReceipt) {
    throw new Error(
      "No deployment-qualified append-only purchase receipt matches this report"
    );
  }

  const index = await recordEvmPaidPurchaseReportIndex({
    skillDbId: input.skill.id,
    purchaseReceiptId: purchaseReceipt.id,
    chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
    contractAddress: contract,
    protocolVersion: BASE_A1_PROTOCOL_VERSION,
    buyerAddress: opened.buyer,
    authorAddress: opened.author,
    listingId: opened.listingId,
    purchaseId: opened.purchaseId,
    reportId: opened.reportId.toString(),
    openedTxHash: txHash,
    openedBlockHash: receipt.blockHash,
    openedBlockNumber: receipt.blockNumber.toString(),
    openedLogIndex: opened.logIndex.toString(),
    filedAt: state.filedAt,
    reviewDeadline: state.reviewDeadline,
    bondUsdcMicros: opened.bond.toString(),
    evidenceUri: opened.evidenceUri,
  });
  return { index, state };
}

export async function readBasePaidPurchaseReportState(input: {
  skill: PaidReportSkillRow;
  reportId: string;
}): Promise<BasePaidPurchaseReportState> {
  if (!/^\d+$/.test(input.reportId)) throw new Error("Invalid paid report id");
  const reportId = BigInt(input.reportId);
  if (reportId <= 0n || reportId > 18_446_744_073_709_551_615n) {
    throw new Error("Invalid paid report id");
  }
  const contract = getBasePaidPurchaseReportContract(input.skill);
  const client = createBasePublicClient();
  await assertBaseA1Deployment(client, contract);
  return readFreshReportState({ client, contract, reportId });
}

export async function readBasePaidPurchaseReportPreflight(input: {
  skill: PaidReportSkillRow;
  buyerAddress: string;
  purchaseId: string;
}): Promise<BasePaidPurchaseReportPreflight> {
  const contract = getBasePaidPurchaseReportContract(input.skill);
  const buyer = requireBaseEvmAddress(input.buyerAddress, "Buyer");
  const purchaseId = requireBaseBytes32(
    input.purchaseId,
    "Paid report purchase id"
  );
  const skillListingId = requireBaseBytes32(
    input.skill.evm_listing_id ?? "",
    "Skill Base listing id"
  );
  const client = createBasePublicClient();
  await assertBaseA1Deployment(client, contract);
  const [rawPurchase, rawListing, paused, latestBlock] = await Promise.all([
    client.readContract({
      address: contract,
      abi: A1_ABI,
      functionName: "getPurchase",
      args: [purchaseId],
    }),
    client.readContract({
      address: contract,
      abi: A1_ABI,
      functionName: "getListing",
      args: [skillListingId],
    }),
    client.readContract({
      address: contract,
      abi: A1_ABI,
      functionName: "paused",
    }),
    client.getBlock(),
  ]);
  const purchase = normalizeA1Purchase(rawPurchase);
  const isPaused = requireBoolean(paused, "A1 pause state");
  const author = requireBaseEvmAddress(
    requireString(field(rawListing, "author", 0), "A1 listing author"),
    "A1 listing author"
  );
  const listingExists = requireBoolean(
    field(rawListing, "exists", 11),
    "A1 listing"
  );
  const filingDeadline = purchase.timestamp + 7n * 24n * 60n * 60n;
  let reason: string | null = null;
  if (!purchase.exists) reason = "purchase-not-found";
  else if (!listingExists) reason = "listing-not-found";
  else if (getAddress(purchase.buyer) !== buyer) reason = "buyer-mismatch";
  else if (purchase.listingId.toLowerCase() !== skillListingId.toLowerCase()) {
    reason = "listing-mismatch";
  } else if (purchase.priceUsdcMicros === 0n) reason = "free-purchase";
  else if (purchase.lane !== 1 && purchase.lane !== 2) {
    reason = "purchase-lane-ineligible";
  } else if (latestBlock.timestamp > filingDeadline) {
    reason = "filing-window-expired";
  } else if (isPaused) reason = "deployment-paused";

  if (reason === null) {
    try {
      await client.simulateContract({
        account: buyer,
        address: contract,
        abi: A1_ABI,
        functionName: "openPaidPurchaseReport",
        args: [author, skillListingId, purchaseId, "preflight"],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/PaidPurchaseReceiptConsumed/i.test(message)) {
        reason = "purchase-already-reported";
      }
    }
  }

  return {
    chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
    contractAddress: contract,
    protocolVersion: BASE_A1_PROTOCOL_VERSION,
    buyerAddress: buyer,
    authorAddress: author,
    listingId: skillListingId,
    purchaseId,
    purchaseRevision: purchase.revision.toString(),
    purchasePriceUsdcMicros: purchase.priceUsdcMicros.toString(),
    purchaseTimestamp: purchase.timestamp.toString(),
    filingDeadline: filingDeadline.toString(),
    lane: purchase.lane,
    paused: isPaused,
    eligible: reason === null,
    reason,
    // Consumed-purchase, active-report, cooldown, registration, allowance, and bond failures
    // are not all exposed by frozen getters. The wallet must simulate the exact open call.
    requiresExactCallSimulation: reason === null,
  };
}
