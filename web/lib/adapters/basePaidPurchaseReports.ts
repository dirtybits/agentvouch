"use client";

import {
  decodeEventLog,
  getAddress,
  isAddress,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { BASE_SEPOLIA_CHAIN_CONTEXT } from "@/lib/chains";
import {
  BASE_NATIVE_USDC_ADDRESS,
  BASE_SEPOLIA_CHAIN_ID,
} from "./baseWalletConfig";
import type {
  ChainWallet,
  OpenPaidPurchaseReportInput,
  PaidPurchaseReportChainWallet,
  PaidPurchaseReportWalletCapability,
} from "./types";
import { AGENTVOUCH_EVM_A1_PAID_REPORT_WRITE_ABI } from "./agentVouchEvmAbi";

export const BASE_A1_PROTOCOL_VERSION = "base-v1-a1";
export const PAID_PURCHASE_REPORT_BOND_USDC_MICROS = 5_000_000n;
export const PAID_PURCHASE_REPORT_FILING_WINDOW_SECONDS = 7n * 24n * 60n * 60n;
export const PAID_PURCHASE_REPORT_MAX_EVIDENCE_BYTES = 256;
export const PURCHASE_LANE_DIRECT = 1;
export const PURCHASE_LANE_AUTHORIZATION = 2;
export const PAID_PURCHASE_REPORT_STATUS_TERMINAL = 4;

export const AGENTVOUCH_EVM_A1_PAID_REPORT_ABI = parseAbi([
  ...AGENTVOUCH_EVM_A1_PAID_REPORT_WRITE_ABI,
]);

export type BaseA1Purchase = {
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

export type BaseA1Listing = {
  author: Address;
  exists: boolean;
};

export type BaseA1Config = {
  usdc: Address;
  chainContext: string;
  disputeBondUsdcMicros: bigint;
  refundClaimWindowSeconds: bigint;
};

function tupleValue(
  tuple: Record<string | number, unknown>,
  key: string,
  index: number
): unknown {
  return tuple[key] ?? tuple[index];
}

export function normalizeBaseA1Purchase(value: unknown): BaseA1Purchase {
  const tuple = value as Record<string | number, unknown>;
  const buyer = String(tupleValue(tuple, "buyer", 1) ?? "");
  const listingId = String(tupleValue(tuple, "listingId", 2) ?? "");
  if (!isAddress(buyer)) throw new Error("Base A1 purchase buyer is invalid.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(listingId)) {
    throw new Error("Base A1 purchase listing id is invalid.");
  }
  return {
    exists: Boolean(tupleValue(tuple, "exists", 0)),
    buyer: getAddress(buyer),
    listingId: listingId.toLowerCase() as Hex,
    revision: BigInt(String(tupleValue(tuple, "revision", 3) ?? 0)),
    priceUsdcMicros: BigInt(
      String(tupleValue(tuple, "priceUsdcMicros", 4) ?? 0)
    ),
    authorShareUsdcMicros: BigInt(
      String(tupleValue(tuple, "authorShareUsdcMicros", 5) ?? 0)
    ),
    voucherPoolUsdcMicros: BigInt(
      String(tupleValue(tuple, "voucherPoolUsdcMicros", 6) ?? 0)
    ),
    timestamp: BigInt(String(tupleValue(tuple, "timestamp", 7) ?? 0)),
    lane: Number(tupleValue(tuple, "lane", 8) ?? 0),
  };
}

export function assertPaidPurchaseReportInput(input: {
  request: OpenPaidPurchaseReportInput;
  selectedContract: Address;
}): {
  contractAddress: Address;
  authorAddress: Address;
  listingId: Hex;
  purchaseId: Hex;
  evidenceBytes: number;
} {
  const { request } = input;
  if (request.chainContext !== BASE_SEPOLIA_CHAIN_CONTEXT) {
    throw new Error(
      `Paid-purchase reports require ${BASE_SEPOLIA_CHAIN_CONTEXT}.`
    );
  }
  if (request.chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(
      `Paid-purchase reports require chain id ${BASE_SEPOLIA_CHAIN_ID}.`
    );
  }
  if (!isAddress(request.contractAddress)) {
    throw new Error("Paid-purchase report contract address is invalid.");
  }
  const contractAddress = getAddress(request.contractAddress);
  if (contractAddress !== input.selectedContract) {
    throw new Error(
      "Paid-purchase report deployment does not match the selected Base contract."
    );
  }
  if (!isAddress(request.authorAddress)) {
    throw new Error("Paid-purchase report author address is invalid.");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(request.listingId)) {
    throw new Error("Paid-purchase report listing id is invalid.");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(request.purchaseId)) {
    throw new Error("Paid-purchase report purchase id is invalid.");
  }
  if (
    request.expectedBondUsdcMicros !== PAID_PURCHASE_REPORT_BOND_USDC_MICROS
  ) {
    throw new Error("Paid-purchase report bond must be exactly 5 USDC.");
  }
  const evidenceBytes = new TextEncoder().encode(request.evidenceUri).length;
  if (
    evidenceBytes === 0 ||
    evidenceBytes > PAID_PURCHASE_REPORT_MAX_EVIDENCE_BYTES
  ) {
    throw new Error(
      `Paid-purchase report evidence must be 1-${PAID_PURCHASE_REPORT_MAX_EVIDENCE_BYTES} UTF-8 bytes.`
    );
  }
  return {
    contractAddress,
    authorAddress: getAddress(request.authorAddress),
    listingId: request.listingId.toLowerCase() as Hex,
    purchaseId: request.purchaseId.toLowerCase() as Hex,
    evidenceBytes,
  };
}

export function assertBaseA1ReportPreflight(input: {
  protocolVersion: string;
  paused: boolean;
  code: Hex;
  config: BaseA1Config;
  buyer: Address;
  author: Address;
  listingId: Hex;
  purchase: BaseA1Purchase;
  listing: BaseA1Listing;
  nowSeconds: bigint;
}): void {
  if (input.code === "0x")
    throw new Error("Selected Base A1 contract has no code.");
  if (input.protocolVersion !== BASE_A1_PROTOCOL_VERSION) {
    throw new Error("Selected Base contract is not protocol base-v1-a1.");
  }
  if (input.paused) {
    throw new Error(
      "Paid-purchase reports are paused on the selected deployment."
    );
  }
  if (input.config.chainContext !== BASE_SEPOLIA_CHAIN_CONTEXT) {
    throw new Error("Base A1 config chain context is invalid.");
  }
  if (getAddress(input.config.usdc) !== getAddress(BASE_NATIVE_USDC_ADDRESS)) {
    throw new Error("Base A1 config does not use native Base Sepolia USDC.");
  }
  if (
    input.config.disputeBondUsdcMicros !== PAID_PURCHASE_REPORT_BOND_USDC_MICROS
  ) {
    throw new Error("Base A1 config report bond is not 5 USDC.");
  }
  if (input.config.refundClaimWindowSeconds !== 7n * 24n * 60n * 60n) {
    throw new Error("Base A1 buyer credit claim window is not seven days.");
  }
  if (!input.purchase.exists || input.purchase.priceUsdcMicros <= 0n) {
    throw new Error("The selected paid purchase does not exist.");
  }
  if (getAddress(input.purchase.buyer) !== getAddress(input.buyer)) {
    throw new Error("The connected wallet does not own this purchase.");
  }
  if (input.purchase.listingId !== input.listingId) {
    throw new Error("The purchase is bound to a different listing.");
  }
  if (
    !input.listing.exists ||
    getAddress(input.listing.author) !== input.author
  ) {
    throw new Error("The purchase author does not match the listing author.");
  }
  if (
    input.purchase.lane !== PURCHASE_LANE_DIRECT &&
    input.purchase.lane !== PURCHASE_LANE_AUTHORIZATION
  ) {
    throw new Error("Settlement-lane purchases cannot open paid reports.");
  }
  if (
    input.nowSeconds >
    input.purchase.timestamp + PAID_PURCHASE_REPORT_FILING_WINDOW_SECONDS
  ) {
    throw new Error(
      "The seven-day paid-purchase report filing window has closed."
    );
  }
}

export function isKnownUsdcAllowanceFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /ERC20InsufficientAllowance/i.test(message) ||
    /transfer amount exceeds allowance/i.test(message)
  );
}

export function findBasePaidReportEvent(
  logs: readonly { address: Address; topics: readonly Hex[]; data: Hex }[],
  contract: Address,
  eventName: "PaidPurchaseReportOpened" | "PaidPurchaseReportCreditClaimed"
): { eventName: string; args: Record<string, unknown> } | null {
  for (const log of logs) {
    if (getAddress(log.address) !== contract) continue;
    try {
      const decoded = decodeEventLog({
        abi: AGENTVOUCH_EVM_A1_PAID_REPORT_ABI,
        data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]],
      }) as unknown as { eventName: string; args: Record<string, unknown> };
      if (decoded.eventName === eventName) return decoded;
    } catch {
      // Ignore other exact-contract events in the same receipt.
    }
  }
  return null;
}

export function hasPaidPurchaseReportCapability(
  wallet: ChainWallet | null | undefined
): wallet is PaidPurchaseReportChainWallet {
  if (!wallet) return false;
  const candidate = wallet as ChainWallet &
    Partial<PaidPurchaseReportWalletCapability>;
  return (
    typeof candidate.openPaidPurchaseReport === "function" &&
    typeof candidate.claimPaidPurchaseReportCredit === "function"
  );
}
