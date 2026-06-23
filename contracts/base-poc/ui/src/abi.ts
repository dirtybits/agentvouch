import { parseAbi } from "viem";

// Minimal AgentVouchEvm ABI: only the calls this UI exercises (register -> list -> buy).
// Mirrors contracts/base-poc/harness/src/abi.ts. USDC approve/balanceOf come from viem's
// built-in erc20Abi. Bond/vouch/claim are intentionally omitted — not needed for a paid
// listing (see the plan, "Flow — 3 calls").
export const agentVouchAbi = parseAbi([
  "function registerAgent(string metadataUri)",
  "function createSkillListing(bytes32 skillIdHash, string uri, string name, string description, uint256 priceUsdcMicros) returns (bytes32)",
  "function purchaseSkill(bytes32 id) returns (bytes32)",
]);
