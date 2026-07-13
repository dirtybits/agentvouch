import { beforeEach, describe, expect, it, vi } from "vitest";

import { BASE_SEPOLIA_CHAIN_CONTEXT } from "@/lib/chains";
import {
  BASE_AGENTVOUCH_CONTRACT_ADDRESS,
  BASE_NATIVE_USDC_ADDRESS,
} from "@/lib/adapters/baseConfig";
import {
  normalizeBasePurchaseTuple,
  verifyBaseDirectPurchase,
  verifyBaseExistingPurchase,
  type BaseDirectPurchaseSkillRow,
} from "@/lib/basePurchaseVerification";

const viemMocks = vi.hoisted(() => ({
  createPublicClient: vi.fn(),
  decodeEventLog: vi.fn(),
}));

const protocolMocks = vi.hoisted(() => ({
  fetchBaseAgentVouchProtocolVersion: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: viemMocks.createPublicClient,
    decodeEventLog: viemMocks.decodeEventLog,
  };
});

vi.mock("@/lib/baseProtocolVersion", () => protocolMocks);

const BUYER = "0x3fc722ba956f17b521087984F2c5c0BA47Df3c6B";
const LISTING_ID =
  "0x9987077f66345ab282f7698aa90b486787fe3043f880d9f18556bca5ec2fd89e";
const PURCHASE_ID =
  "0xcf7cbe3e55c964334cb3f010368423852c6f75733314a9d3eeba5b753b05687f";
const TX_HASH =
  "0xfba67b3793f7c518694ae9d793264aaf7a3db84468538b7255b77e50b1078b1c";
const PRICE_MICROS = "1000000";

function baseSkill(
  protocolVersion: string | null = null
): BaseDirectPurchaseSkillRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    price_usdc_micros: PRICE_MICROS,
    currency_mint: BASE_NATIVE_USDC_ADDRESS,
    chain_context: BASE_SEPOLIA_CHAIN_CONTEXT,
    on_chain_protocol_version: protocolVersion,
    on_chain_program_id: BASE_AGENTVOUCH_CONTRACT_ADDRESS,
    evm_listing_id: LISTING_ID,
    evm_contract_address: BASE_AGENTVOUCH_CONTRACT_ADDRESS,
  };
}

function mockPurchaseClient() {
  const client = {
    getChainId: vi.fn().mockResolvedValue(84532),
    getTransactionReceipt: vi.fn().mockResolvedValue({
      status: "success",
      logs: [
        {
          address: BASE_AGENTVOUCH_CONTRACT_ADDRESS,
          data: "0x",
          topics: ["0x"],
        },
      ],
    }),
    readContract: vi.fn().mockImplementation(({ functionName }) => {
      if (functionName === "getListing") {
        return Promise.resolve({
          author: "0x1111111111111111111111111111111111111111",
          skillIdHash:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          uri: "https://agentvouch.xyz/api/skills/base/raw",
          name: "Base Purchase Test",
          description: "Exercises Base purchase verification provenance",
          priceUsdcMicros: BigInt(PRICE_MICROS),
          currentRevision: 2n,
          totalDownloads: 0n,
          totalRevenueUsdcMicros: 0n,
          status: 0,
          lockedByDispute: false,
          exists: true,
        });
      }
      if (functionName === "purchaseId") {
        return Promise.resolve(PURCHASE_ID);
      }
      if (functionName === "getPurchase") {
        return Promise.resolve({
          exists: true,
          buyer: BUYER,
          listingId: LISTING_ID,
          revision: 2n,
          priceUsdcMicros: BigInt(PRICE_MICROS),
          authorShareUsdcMicros: 600_000n,
          voucherPoolUsdcMicros: 400_000n,
          timestamp: 1_783_000_000n,
        });
      }
      throw new Error(`Unexpected readContract call: ${String(functionName)}`);
    }),
  };
  viemMocks.createPublicClient.mockReturnValue(client);
  viemMocks.decodeEventLog.mockReturnValue({
    eventName: "SkillPurchased",
    args: {
      purchaseId: PURCHASE_ID,
      listingId: LISTING_ID,
      buyer: BUYER,
      revision: 2n,
      price: BigInt(PRICE_MICROS),
    },
  });
  return client;
}

describe("Base purchase receipt tuple normalization", () => {
  it("accepts viem positional tuple results", () => {
    const receipt = normalizeBasePurchaseTuple([
      true,
      BUYER,
      LISTING_ID,
      2n,
      1_000_000n,
      600_000n,
      400_000n,
      1_783_000_000n,
    ]);

    expect(receipt.exists).toBe(true);
    expect(receipt.buyer).toBe(BUYER);
    expect(receipt.listingId).toBe(LISTING_ID);
    expect(receipt.revision).toBe(2n);
    expect(receipt.priceUsdcMicros).toBe(1_000_000n);
  });

  it("accepts named tuple results", () => {
    const receipt = normalizeBasePurchaseTuple({
      exists: true,
      buyer: BUYER,
      listingId: LISTING_ID,
      revision: 3n,
      priceUsdcMicros: 1_000_000n,
      authorShareUsdcMicros: 600_000n,
      voucherPoolUsdcMicros: 400_000n,
      timestamp: 1_783_000_001n,
    });

    expect(receipt.exists).toBe(true);
    expect(receipt.buyer).toBe(BUYER);
    expect(receipt.listingId).toBe(LISTING_ID);
    expect(receipt.revision).toBe(3n);
    expect(receipt.priceUsdcMicros).toBe(1_000_000n);
  });
});

describe("Base purchase verification protocol provenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    protocolMocks.fetchBaseAgentVouchProtocolVersion.mockResolvedValue(
      "base-v1-candidate"
    );
  });

  it("reads live contract protocol version for direct purchases when the DB row has no stored version", async () => {
    mockPurchaseClient();

    const result = await verifyBaseDirectPurchase({
      skill: baseSkill(null),
      txHash: TX_HASH,
      buyerAddress: BUYER,
      expectedPriceUsdcMicros: PRICE_MICROS,
    });

    expect(result.protocolVersion).toBe("base-v1-candidate");
    expect(
      protocolMocks.fetchBaseAgentVouchProtocolVersion
    ).toHaveBeenCalledWith({
      contract: BASE_AGENTVOUCH_CONTRACT_ADDRESS,
    });
  });

  it("preserves stored protocol version for direct purchases without a live protocol read", async () => {
    mockPurchaseClient();

    const result = await verifyBaseDirectPurchase({
      skill: baseSkill("base-poc-v0"),
      txHash: TX_HASH,
      buyerAddress: BUYER,
      expectedPriceUsdcMicros: PRICE_MICROS,
    });

    expect(result.protocolVersion).toBe("base-poc-v0");
    expect(
      protocolMocks.fetchBaseAgentVouchProtocolVersion
    ).not.toHaveBeenCalled();
  });

  it("reads live contract protocol version for existing purchases when the DB row has no stored version", async () => {
    mockPurchaseClient();

    const result = await verifyBaseExistingPurchase({
      skill: baseSkill(null),
      buyerAddress: BUYER,
      expectedPriceUsdcMicros: PRICE_MICROS,
    });

    expect(result.protocolVersion).toBe("base-v1-candidate");
    expect(
      protocolMocks.fetchBaseAgentVouchProtocolVersion
    ).toHaveBeenCalledWith({
      contract: BASE_AGENTVOUCH_CONTRACT_ADDRESS,
    });
  });

  it("preserves stored protocol version for existing purchases without a live protocol read", async () => {
    mockPurchaseClient();

    const result = await verifyBaseExistingPurchase({
      skill: baseSkill("base-poc-v0"),
      buyerAddress: BUYER,
      expectedPriceUsdcMicros: PRICE_MICROS,
    });

    expect(result.protocolVersion).toBe("base-poc-v0");
    expect(
      protocolMocks.fetchBaseAgentVouchProtocolVersion
    ).not.toHaveBeenCalled();
  });
});
