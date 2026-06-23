import { parseAbi } from "viem";

/// Minimal AgentVouchEvm ABI: the write functions the gas-free flow exercises.
/// (USDC approve/balanceOf/decimals come from viem's built-in `erc20Abi`.)
export const agentVouchAbi = parseAbi([
  "function registerAgent(string metadataUri)",
  "function depositAuthorBond(uint256 amount)",
  "function vouch(address vouchee, uint256 stake)",
  "function createSkillListing(bytes32 skillIdHash, string uri, string name, string description, uint256 priceUsdcMicros) returns (bytes32)",
  "function purchaseSkill(bytes32 id) returns (bytes32)",
  "function claimVoucherRevenue(address author)",
  "function withdrawAuthorProceeds(bytes32 id, uint64 revision, uint256 amount)",
]);
