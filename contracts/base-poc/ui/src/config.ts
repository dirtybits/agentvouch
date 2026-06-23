import { createPublicClient, http, getAddress, type Address } from "viem";
import { baseSepolia } from "viem/chains";

// Deployed AgentVouchEvm + Circle USDC on Base Sepolia (see the plan / harness .env).
const DEFAULT_AGENTVOUCH = "0x5D90BB39aCaF0DF7462F552D430dc1ff1f24913E";
const DEFAULT_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

export const chain = baseSepolia;

export const baseSepoliaRpcUrl =
  import.meta.env.VITE_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

// CDP Paymaster & Bundler URL. Required to send sponsored UserOps; reads work without it.
export const cdpRpcUrl = import.meta.env.VITE_CDP_RPC_URL;

export const agentVouchAddress: Address = getAddress(
  import.meta.env.VITE_AGENTVOUCH_ADDRESS || DEFAULT_AGENTVOUCH,
);
export const usdcAddress: Address = getAddress(
  import.meta.env.VITE_USDC_ADDRESS || DEFAULT_USDC,
);

// Optional pre-funded throwaway owner keys (local-key mode only) so demos skip the faucet.
export const prefundedOwnerPks = {
  author: import.meta.env.VITE_AUTHOR_OWNER_PK,
  buyer: import.meta.env.VITE_BUYER_OWNER_PK,
};

export const publicClient = createPublicClient({
  chain,
  transport: http(baseSepoliaRpcUrl),
});

export const USDC_DECIMALS = 6;
export const MIN_PAID_PRICE_USDC = 1; // contract config: minPaidListingPriceUsdcMicros = 1 USDC

export const explorerTxUrl = (txHash: string) =>
  `https://sepolia.basescan.org/tx/${txHash}`;
export const explorerAddressUrl = (address: string) =>
  `https://sepolia.basescan.org/address/${address}`;
export const circleFaucetUrl = "https://faucet.circle.com";
