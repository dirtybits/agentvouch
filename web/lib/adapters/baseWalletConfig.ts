"use client";

import { BASE_SEPOLIA_CHAIN_CONTEXT } from "@/lib/chains";

const DEFAULT_AGENTVOUCH_ADDRESS = "0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854";
const DEFAULT_USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const DEFAULT_RPC_URL = "https://base-sepolia-rpc.publicnode.com";

export const BASE_PASSKEY_WALLET_NAME = "Coinbase Smart Wallet";
export const BASE_PASSKEY_WALLET_SOURCE = "coinbase-smart-wallet-passkey";
export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const BASE_SEPOLIA_CHAIN_LABEL = "Base Sepolia";
export const BASE_SEPOLIA_EXPLORER_URL = "https://sepolia.basescan.org";

export const BASE_SEPOLIA_RPC_URL =
  process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || DEFAULT_RPC_URL;

export const BASE_AGENTVOUCH_CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_BASE_AGENTVOUCH_ADDRESS || DEFAULT_AGENTVOUCH_ADDRESS;

export const BASE_USDC_ADDRESS =
  process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || DEFAULT_USDC_ADDRESS;

// Public CDP Paymaster & Bundler endpoint for Phase 5 writes. This is intentionally optional in
// Phase 4 because passkey connect can be proven without sending UserOps.
export const BASE_CDP_PAYMASTER_RPC_URL =
  process.env.NEXT_PUBLIC_BASE_CDP_PAYMASTER_RPC_URL ||
  process.env.NEXT_PUBLIC_CDP_RPC_URL ||
  "";

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
  } as const;
}

export function shortenEvmAddress(value: string): string {
  if (value.length <= 13) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function baseSepoliaExplorerAddressUrl(address: string): string {
  return `${BASE_SEPOLIA_EXPLORER_URL}/address/${address}`;
}
