// AgentVouchEvm (Base) connection constants for the read path. Pure values — no viem, no
// "use client" — safe to import anywhere. Mirrors contracts/base-poc/ui/src/config.ts.
//
// Target is Base Sepolia today (the POC contract is Sepolia; mainnet is an open question — see
// .agents/plans/base-port-chain-adapter.plan.md). Values are env-overridable for mainnet later.

// F-1-fixed AgentVouchEvm (Lane B uses receiveWithAuthorization). See docs/BASE_POC_GASFREE_REPORT.md.
export const BASE_AGENTVOUCH_CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_BASE_AGENTVOUCH_ADDRESS ||
  "0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854";

export const BASE_USDC_ADDRESS =
  process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS ||
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const BASE_MAINNET_CHAIN_ID = 8453;

// Reads RPC. Public sepolia.base.org is load-balanced and lags on read-after-write (plan gotcha),
// so default to publicnode for reads; override per environment.
export const BASE_SEPOLIA_RPC_URL =
  process.env.BASE_SEPOLIA_RPC_URL ||
  process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ||
  "https://base-sepolia-rpc.publicnode.com";

// Block to scan SkillListingCreated from for event-driven enumeration. Defaults to 0; set this to
// the contract's deploy block in production so the eth_getLogs range stays within public-RPC
// limits. (The marketplace's preferred enumeration is DB-driven — see Phase 3b in the plan.)
export const BASE_AGENTVOUCH_FROM_BLOCK = BigInt(
  process.env.NEXT_PUBLIC_BASE_AGENTVOUCH_FROM_BLOCK || "0"
);
