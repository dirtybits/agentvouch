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
  "function openReport(address author, string evidenceUri) returns (uint64)",
  "function resolveReport(uint64 reportId, uint8 ruling, bool forfeitReporterBond) returns (uint256 returnedReporterBond, uint256 forfeitedReporterBond, uint256 slashedAuthorBond)",
  // x402 Lane B (trust-minimized): the agent signs an EIP-3009 authorization off-chain;
  // a relayer submits this and the contract pulls USDC + records the purchase atomically.
  "function purchaseWithAuthorization(bytes32 id, address buyer, uint256 validAfter, uint256 validBefore, uint8 v, bytes32 r, bytes32 s) returns (bytes32)",
  "error AlreadyRegistered()",
  "error ListingNotFound()",
]);
