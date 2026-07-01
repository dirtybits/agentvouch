// AgentVouchEvm (Base) connection constants for the read path. Pure values — no viem, no
// "use client" — safe to import anywhere. Mirrors contracts/base-poc/ui/src/config.ts.
//
// Target is Base Sepolia today (the POC contract is Sepolia; mainnet config is intentionally not
// exposed yet — see .agents/plans/base-port-chain-adapter.plan.md).

import {
  DEFAULT_BASE_AGENTVOUCH_ADDRESS,
  DEFAULT_BASE_SEPOLIA_RPC_URL,
  DEFAULT_BASE_SEPOLIA_USDC_ADDRESS,
} from "./baseConstants";

// F-1-fixed AgentVouchEvm (Lane B uses receiveWithAuthorization). See docs/BASE_POC_GASFREE_REPORT.md.
export const BASE_AGENTVOUCH_CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_BASE_AGENTVOUCH_ADDRESS ||
  DEFAULT_BASE_AGENTVOUCH_ADDRESS;

export const BASE_USDC_ADDRESS =
  process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS ||
  DEFAULT_BASE_SEPOLIA_USDC_ADDRESS;

export {
  BASE_MAINNET_CHAIN_ID,
  BASE_NATIVE_USDC_ADDRESS,
  BASE_SEPOLIA_CHAIN_ID,
} from "./baseConstants";

// Reads RPC. Public sepolia.base.org is load-balanced and lags on read-after-write (plan gotcha),
// so default to publicnode for reads; override per environment.
export const BASE_SEPOLIA_RPC_URL =
  process.env.BASE_SEPOLIA_RPC_URL ||
  process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ||
  DEFAULT_BASE_SEPOLIA_RPC_URL;

// Block to scan SkillListingCreated from for event-driven enumeration. Defaults to 0; set this to
// the contract's deploy block in production so the eth_getLogs range stays within public-RPC
// limits. (The marketplace's preferred enumeration is DB-driven — see Phase 3b in the plan.)
export const BASE_AGENTVOUCH_FROM_BLOCK = BigInt(
  process.env.BASE_AGENTVOUCH_FROM_BLOCK ||
    process.env.NEXT_PUBLIC_BASE_AGENTVOUCH_FROM_BLOCK ||
    "0"
);

// Event-log enumeration is intentionally opt-in because public Base Sepolia RPCs often reject
// historical eth_getLogs without an archive token. Phase 3b should use DB-driven enumeration.
export const BASE_AGENTVOUCH_EVENT_SCAN_ENABLED =
  process.env.BASE_AGENTVOUCH_EVENT_SCAN_ENABLED === "1" ||
  process.env.NEXT_PUBLIC_BASE_AGENTVOUCH_EVENT_SCAN_ENABLED === "1";
