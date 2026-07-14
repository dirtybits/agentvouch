"use client";

import { BASE_SEPOLIA_CHAIN_CONTEXT } from "@/lib/chains";
import {
  BASE_NATIVE_USDC_ADDRESS,
  BASE_PASSKEY_WALLET_NAME,
  BASE_PASSKEY_WALLET_SOURCE,
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_LABEL,
  BASE_SEPOLIA_EXPLORER_URL,
  BASE_USDC_DECIMALS,
  BASE_WALLET_UNCONFIGURED_MESSAGE,
  DEFAULT_BASE_AGENTVOUCH_ADDRESS,
  DEFAULT_BASE_SEPOLIA_RPC_URL,
  DEFAULT_BASE_SEPOLIA_USDC_ADDRESS,
} from "./baseConstants";

const configuredClientRpcUrl =
  process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL?.trim() ?? "";

export {
  BASE_NATIVE_USDC_ADDRESS,
  BASE_PASSKEY_WALLET_NAME,
  BASE_PASSKEY_WALLET_SOURCE,
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_LABEL,
  BASE_SEPOLIA_EXPLORER_URL,
  BASE_USDC_DECIMALS,
  BASE_WALLET_UNCONFIGURED_MESSAGE,
};

export const BASE_SEPOLIA_RPC_URL =
  configuredClientRpcUrl || DEFAULT_BASE_SEPOLIA_RPC_URL;
export const BASE_WALLET_CONFIGURED = Boolean(configuredClientRpcUrl);

export const BASE_AGENTVOUCH_CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_BASE_AGENTVOUCH_ADDRESS ||
  DEFAULT_BASE_AGENTVOUCH_ADDRESS;

export const BASE_USDC_ADDRESS =
  process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS ||
  DEFAULT_BASE_SEPOLIA_USDC_ADDRESS;

// Public CDP Paymaster & Bundler endpoint for Phase 5 writes. This is intentionally optional in
// Phase 4 because passkey connect can be proven without sending UserOps.
export const BASE_CDP_PAYMASTER_RPC_URL =
  process.env.NEXT_PUBLIC_BASE_CDP_PAYMASTER_RPC_URL ||
  process.env.NEXT_PUBLIC_CDP_RPC_URL ||
  "";

// UX-only gate. The on-chain global pause is the authority for exposure.
// This defaults off so merging the client cannot activate paid reports.
export const BASE_PAID_PURCHASE_REPORTS_ENABLED =
  process.env.NEXT_PUBLIC_BASE_PAID_PURCHASE_REPORTS_ENABLED === "true";

export function getBaseWalletConfig() {
  return {
    chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
    chainId: BASE_SEPOLIA_CHAIN_ID,
    chainLabel: BASE_SEPOLIA_CHAIN_LABEL,
    rpcUrl: BASE_SEPOLIA_RPC_URL,
    agentVouchAddress: BASE_AGENTVOUCH_CONTRACT_ADDRESS,
    usdcAddress: BASE_USDC_ADDRESS,
    paymasterRpcUrl: BASE_CDP_PAYMASTER_RPC_URL,
    explorerUrl: BASE_SEPOLIA_EXPLORER_URL,
    paidPurchaseReportsEnabled: BASE_PAID_PURCHASE_REPORTS_ENABLED,
    configured: BASE_WALLET_CONFIGURED,
  } as const;
}

export function shortenEvmAddress(value: string): string {
  if (value.length <= 13) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
