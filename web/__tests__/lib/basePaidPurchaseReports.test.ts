import { describe, expect, it } from "vitest";
import { getAddress, type Hex } from "viem";

import {
  PAID_PURCHASE_REPORT_BOND_USDC_MICROS,
  assertBaseA1ReportPreflight,
  assertPaidPurchaseReportInput,
  hasPaidPurchaseReportCapability,
  isKnownUsdcAllowanceFailure,
  normalizeBaseA1Purchase,
} from "@/lib/adapters/basePaidPurchaseReports";
import { BASE_NATIVE_USDC_ADDRESS } from "@/lib/adapters/baseWalletConfig";

const contract = getAddress("0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854");
const buyer = getAddress("0x00000000000000000000000000000000000000B1");
const author = getAddress("0x00000000000000000000000000000000000000A1");
const listingId = `0x${"11".repeat(32)}` as Hex;
const purchaseId = `0x${"22".repeat(32)}` as Hex;

describe("Base paid-purchase report identity", () => {
  it("binds the exact deployment, purchase, bond, and UTF-8 evidence bytes", () => {
    const result = assertPaidPurchaseReportInput({
      selectedContract: contract,
      request: {
        chainContext: "eip155:84532",
        chainId: 84532,
        contractAddress: contract,
        authorAddress: author,
        listingId,
        purchaseId,
        evidenceUri: "ipfs://evidence",
        expectedBondUsdcMicros: PAID_PURCHASE_REPORT_BOND_USDC_MICROS,
      },
    });

    expect(result.contractAddress).toBe(contract);
    expect(result.evidenceBytes).toBe(15);
  });

  it("counts multi-byte evidence by UTF-8 bytes", () => {
    expect(() =>
      assertPaidPurchaseReportInput({
        selectedContract: contract,
        request: {
          chainContext: "eip155:84532",
          chainId: 84532,
          contractAddress: contract,
          authorAddress: author,
          listingId,
          purchaseId,
          evidenceUri: "😀".repeat(65),
          expectedBondUsdcMicros: 5_000_000n,
        },
      })
    ).toThrow(/1-256 UTF-8 bytes/);
  });

  it("rejects a different selected contract and any non-5-USDC bond", () => {
    const request = {
      chainContext: "eip155:84532",
      chainId: 84532,
      contractAddress: contract,
      authorAddress: author,
      listingId,
      purchaseId,
      evidenceUri: "ipfs://evidence",
      expectedBondUsdcMicros: 4_999_999n,
    };
    expect(() =>
      assertPaidPurchaseReportInput({ selectedContract: contract, request })
    ).toThrow(/exactly 5 USDC/);
    expect(() =>
      assertPaidPurchaseReportInput({
        selectedContract: getAddress(
          "0x0000000000000000000000000000000000000001"
        ),
        request: { ...request, expectedBondUsdcMicros: 5_000_000n },
      })
    ).toThrow(/does not match/);
  });
});

describe("Base paid-purchase report protocol preflight", () => {
  const purchase = normalizeBaseA1Purchase({
    exists: true,
    buyer,
    listingId,
    revision: 1n,
    priceUsdcMicros: 1_000_000n,
    authorShareUsdcMicros: 1_000_000n,
    voucherPoolUsdcMicros: 0n,
    timestamp: 1_000n,
    lane: 1,
  });
  const base = {
    protocolVersion: "base-v1-a1",
    paused: false,
    code: "0x01" as Hex,
    config: {
      usdc: getAddress(BASE_NATIVE_USDC_ADDRESS),
      chainContext: "eip155:84532",
      disputeBondUsdcMicros: 5_000_000n,
      refundClaimWindowSeconds: 604_800n,
    },
    buyer,
    author,
    listingId,
    purchase,
    listing: { author, exists: true },
  };

  it("allows filing at exactly seven days and rejects one second later", () => {
    expect(() =>
      assertBaseA1ReportPreflight({
        ...base,
        nowSeconds: 1_000n + 604_800n,
      })
    ).not.toThrow();
    expect(() =>
      assertBaseA1ReportPreflight({
        ...base,
        nowSeconds: 1_000n + 604_801n,
      })
    ).toThrow(/filing window has closed/);
  });

  it("rejects Settlement-lane receipts and paused exposure", () => {
    expect(() =>
      assertBaseA1ReportPreflight({
        ...base,
        purchase: { ...purchase, lane: 3 },
        nowSeconds: 1_001n,
      })
    ).toThrow(/Settlement-lane/);
    expect(() =>
      assertBaseA1ReportPreflight({
        ...base,
        paused: true,
        nowSeconds: 1_001n,
      })
    ).toThrow(/paused/);
  });
});

describe("Base paid-purchase wallet capability", () => {
  it("detects the optional capability without expanding every ChainWallet", () => {
    expect(
      hasPaidPurchaseReportCapability({
        openPaidPurchaseReport: async () => ({} as never),
        claimPaidPurchaseReportCredit: async () => ({} as never),
      } as never)
    ).toBe(true);
    expect(hasPaidPurchaseReportCapability({} as never)).toBe(false);
  });

  it("recognizes only known USDC allowance failures", () => {
    expect(
      isKnownUsdcAllowanceFailure(new Error("ERC20InsufficientAllowance"))
    ).toBe(true);
    expect(
      isKnownUsdcAllowanceFailure(new Error("PaidPurchaseBuyerBusy"))
    ).toBe(false);
  });
});
