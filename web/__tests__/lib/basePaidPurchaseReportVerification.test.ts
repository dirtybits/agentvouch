import { beforeEach, describe, expect, it, vi } from "vitest";
import { BASE_AGENTVOUCH_CONTRACT_ADDRESS } from "@/lib/adapters/baseConfig";
import { BASE_SEPOLIA_CHAIN_CONTEXT } from "@/lib/chains";
import {
  BASE_A1_PROTOCOL_VERSION,
  normalizeA1Purchase,
  readBasePaidPurchaseReportPreflight,
  verifyAndIndexBasePaidPurchaseReport,
  type PaidReportSkillRow,
} from "@/lib/basePaidPurchaseReportVerification";

const viemMocks = vi.hoisted(() => ({
  createPublicClient: vi.fn(),
  decodeEventLog: vi.fn(),
}));

const purchaseMocks = vi.hoisted(() => ({
  getEvmPaidPurchaseReceipt: vi.fn(),
  recordEvmPaidPurchaseReportIndex: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: viemMocks.createPublicClient,
    decodeEventLog: viemMocks.decodeEventLog,
  };
});

vi.mock("@/lib/usdcPurchases", () => purchaseMocks);

const BUYER = "0x3fc722ba956f17b521087984F2c5c0BA47Df3c6B";
const AUTHOR = "0x1111111111111111111111111111111111111111";
const LISTING_ID =
  "0x9987077f66345ab282f7698aa90b486787fe3043f880d9f18556bca5ec2fd89e";
const PURCHASE_ID =
  "0xcf7cbe3e55c964334cb3f010368423852c6f75733314a9d3eeba5b753b05687f";
const TX_HASH =
  "0xfba67b3793f7c518694ae9d793264aaf7a3db84468538b7255b77e50b1078b1c";
const BLOCK_HASH =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const EVIDENCE = "ipfs://paid-report-evidence";

function skill(): PaidReportSkillRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    chain_context: BASE_SEPOLIA_CHAIN_CONTEXT,
    on_chain_protocol_version: BASE_A1_PROTOCOL_VERSION,
    on_chain_program_id: BASE_AGENTVOUCH_CONTRACT_ADDRESS,
    evm_listing_id: LISTING_ID,
    evm_contract_address: BASE_AGENTVOUCH_CONTRACT_ADDRESS,
  };
}

function mockClient(
  options: {
    lane?: number;
    protocolVersion?: string;
    simulationError?: Error;
  } = {}
) {
  const filedAt = 1_783_000_000n;
  const reviewDeadline = filedAt + 259_200n;
  const client = {
    getChainId: vi.fn().mockResolvedValue(84532),
    getTransactionReceipt: vi.fn().mockResolvedValue({
      status: "success",
      blockHash: BLOCK_HASH,
      blockNumber: 123n,
      logs: [
        {
          address: BASE_AGENTVOUCH_CONTRACT_ADDRESS,
          data: "0x",
          topics: ["0x"],
          logIndex: 7,
        },
      ],
    }),
    getBlock: vi.fn().mockResolvedValue({
      hash: BLOCK_HASH,
      number: 123n,
      timestamp: filedAt,
    }),
    simulateContract: options.simulationError
      ? vi.fn().mockRejectedValue(options.simulationError)
      : vi.fn().mockResolvedValue({ result: 1n }),
    readContract: vi.fn().mockImplementation(({ functionName }) => {
      switch (functionName) {
        case "PROTOCOL_VERSION":
          return Promise.resolve(
            options.protocolVersion ?? BASE_A1_PROTOCOL_VERSION
          );
        case "getPurchase":
          return Promise.resolve({
            exists: true,
            buyer: BUYER,
            listingId: LISTING_ID,
            revision: 1n,
            priceUsdcMicros: 10_000_000n,
            authorShareUsdcMicros: 6_000_000n,
            voucherPoolUsdcMicros: 4_000_000n,
            timestamp: filedAt - 60n,
            lane: options.lane ?? 1,
          });
        case "getListing":
          return Promise.resolve({ author: AUTHOR, exists: true });
        case "paused":
          return Promise.resolve(false);
        case "getPaidPurchaseReportCore":
          return Promise.resolve({
            buyer: BUYER,
            author: AUTHOR,
            listingId: LISTING_ID,
            purchaseId: PURCHASE_ID,
            filedAt,
            reviewDeadline,
            acceptedAt: 0n,
            terminalAt: 0n,
            status: 1,
            outcome: 0,
          });
        case "getPaidPurchaseReportSettlement":
          return Promise.resolve({
            slashPercentage: 0,
            activeVouchStake: 0n,
            processedPreSlashStake: 0n,
            authorBondSlash: 0n,
            voucherSlash: 0n,
            buyerEntitlement: 0n,
            buyerCredit: 0n,
            claimDeadline: 0n,
            creditHandled: false,
          });
        case "getPaidPurchaseReportEvidence":
          return Promise.resolve(EVIDENCE);
        default:
          throw new Error(`Unexpected read: ${String(functionName)}`);
      }
    }),
  };
  viemMocks.createPublicClient.mockReturnValue(client);
  viemMocks.decodeEventLog.mockReturnValue({
    eventName: "PaidPurchaseReportOpened",
    args: {
      reportId: 1n,
      buyer: BUYER,
      author: AUTHOR,
      listingId: LISTING_ID,
      purchaseId: PURCHASE_ID,
      bond: 5_000_000n,
      reviewDeadline,
      evidenceUri: EVIDENCE,
    },
  });
  return client;
}

describe("A1 purchase tuple normalization", () => {
  it("requires and preserves the purchase lane", () => {
    const purchase = normalizeA1Purchase([
      true,
      BUYER,
      LISTING_ID,
      2n,
      10_000_000n,
      6_000_000n,
      4_000_000n,
      1_783_000_000n,
      2,
    ]);
    expect(purchase.lane).toBe(2);
    expect(purchase.priceUsdcMicros).toBe(10_000_000n);
  });
});

describe("paid-purchase report preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports a consumed purchase even when the database report index is missing", async () => {
    const client = mockClient({
      simulationError: new Error(
        "The contract function reverted with PaidPurchaseReceiptConsumed"
      ),
    });

    const result = await readBasePaidPurchaseReportPreflight({
      skill: skill(),
      buyerAddress: BUYER,
      purchaseId: PURCHASE_ID,
    });

    expect(result).toMatchObject({
      eligible: false,
      reason: "purchase-already-reported",
      requiresExactCallSimulation: false,
    });
    expect(client.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({
        account: BUYER,
        functionName: "openPaidPurchaseReport",
        args: [AUTHOR, LISTING_ID, PURCHASE_ID, "preflight"],
      })
    );
  });

  it("keeps admission open when only the exact wallet call can decide", async () => {
    mockClient({
      simulationError: new Error("ERC20InsufficientAllowance"),
    });

    const result = await readBasePaidPurchaseReportPreflight({
      skill: skill(),
      buyerAddress: BUYER,
      purchaseId: PURCHASE_ID,
    });

    expect(result).toMatchObject({
      eligible: true,
      reason: null,
      requiresExactCallSimulation: true,
    });
  });
});

describe("paid-purchase report verification and indexing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    purchaseMocks.getEvmPaidPurchaseReceipt.mockResolvedValue({
      id: "22222222-2222-2222-2222-222222222222",
    });
    purchaseMocks.recordEvmPaidPurchaseReportIndex.mockImplementation(
      async (input) => input
    );
  });

  it("indexes only after matching the exact deployment, receipt, purchase, event, and fresh state", async () => {
    mockClient();
    const result = await verifyAndIndexBasePaidPurchaseReport({
      skill: skill(),
      txHash: TX_HASH,
      purchaseId: PURCHASE_ID,
    });

    expect(result.index).toMatchObject({
      chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
      contractAddress: BASE_AGENTVOUCH_CONTRACT_ADDRESS,
      protocolVersion: BASE_A1_PROTOCOL_VERSION,
      buyerAddress: BUYER,
      listingId: LISTING_ID,
      purchaseId: PURCHASE_ID,
      reportId: "1",
      openedBlockNumber: "123",
      openedLogIndex: "7",
      bondUsdcMicros: "5000000",
    });
    expect(purchaseMocks.getEvmPaidPurchaseReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        skillDbId: skill().id,
        contractAddress: BASE_AGENTVOUCH_CONTRACT_ADDRESS,
        protocolVersion: BASE_A1_PROTOCOL_VERSION,
        buyerAddress: BUYER,
        listingId: LISTING_ID,
        purchaseId: PURCHASE_ID,
      })
    );
    expect(
      purchaseMocks.recordEvmPaidPurchaseReportIndex
    ).toHaveBeenCalledOnce();
  });

  it("rejects the Settlement lane before indexing", async () => {
    mockClient({ lane: 3 });
    await expect(
      verifyAndIndexBasePaidPurchaseReport({
        skill: skill(),
        txHash: TX_HASH,
        purchaseId: PURCHASE_ID,
      })
    ).rejects.toThrow("Direct or Authorization");
    expect(
      purchaseMocks.recordEvmPaidPurchaseReportIndex
    ).not.toHaveBeenCalled();
  });

  it("rejects a missing append-only receipt before indexing", async () => {
    mockClient();
    purchaseMocks.getEvmPaidPurchaseReceipt.mockResolvedValue(null);
    await expect(
      verifyAndIndexBasePaidPurchaseReport({
        skill: skill(),
        txHash: TX_HASH,
        purchaseId: PURCHASE_ID,
      })
    ).rejects.toThrow("append-only purchase receipt");
    expect(
      purchaseMocks.recordEvmPaidPurchaseReportIndex
    ).not.toHaveBeenCalled();
  });

  it("rejects a deployment whose live protocol version is not base-v1-a1", async () => {
    mockClient({ protocolVersion: "base-v1-candidate" });
    await expect(
      verifyAndIndexBasePaidPurchaseReport({
        skill: skill(),
        txHash: TX_HASH,
        purchaseId: PURCHASE_ID,
      })
    ).rejects.toThrow("not base-v1-a1");
    expect(purchaseMocks.getEvmPaidPurchaseReceipt).not.toHaveBeenCalled();
  });

  it("rejects a submitted purchase id that differs from the opened event", async () => {
    mockClient();
    const otherPurchase =
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    await expect(
      verifyAndIndexBasePaidPurchaseReport({
        skill: skill(),
        txHash: TX_HASH,
        purchaseId: otherPurchase,
      })
    ).rejects.toThrow("submitted purchase");
    expect(purchaseMocks.getEvmPaidPurchaseReceipt).not.toHaveBeenCalled();
  });
});
