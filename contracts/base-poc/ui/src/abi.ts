import { parseAbi } from "viem";

// Minimal AgentVouchEvm ABI for the Base v1 candidate demo surface.
// Mirrors contracts/base-poc/harness/src/abi.ts. USDC approve/balanceOf come
// from viem's built-in erc20Abi.
export const agentVouchAbi = parseAbi([
  "function registerAgent(string metadataUri)",
  "function depositAuthorBond(uint256 amount)",
  "function vouch(address vouchee, uint256 stake)",
  "function createSkillListing(bytes32 skillIdHash, string uri, string name, string description, uint256 priceUsdcMicros) returns (bytes32)",
  "function updateSkillListing(bytes32 id, string uri, string name, string description, uint256 priceUsdcMicros) returns (uint64)",
  "function purchaseSkill(bytes32 id) returns (bytes32)",
  "function claimVoucherRevenue(address author)",
  "function withdrawAuthorProceeds(bytes32 id, uint64 revision, uint256 amount)",
  "function openReport(address author, string evidenceUri) returns (uint64)",
  "function resolveReport(uint64 reportId, uint8 ruling, bool forfeitReporterBond) returns (uint256 returnedReporterBond, uint256 forfeitedReporterBond, uint256 slashedAuthorBond)",
  "function purchaseWithAuthorization(bytes32 id, address buyer, uint256 validAfter, uint256 validBefore, uint8 v, bytes32 r, bytes32 s) returns (bytes32)",
  "function PROTOCOL_VERSION() view returns (string)",
  "function getProfile(address agent) view returns ((bool registered, string metadataUri, uint256 reputationScore, uint64 totalVouchesReceived, uint64 totalVouchesGiven, uint256 totalVouchStakeReceivedUsdcMicros, uint256 authorBondUsdcMicros, uint64 activeFreeListingCount, uint64 openDisputes, uint64 upheldDisputes, uint64 dismissedDisputes, uint256 rewardIndexUsdcMicrosX1e12, uint256 unclaimedVoucherRevenueUsdcMicros, uint64 registeredAt))",
  "function getAuthorReport(uint64 reportId) view returns ((bool exists, address reporter, address author, string evidenceUri, uint256 bondUsdcMicros, uint256 forfeitedReporterBondUsdcMicros, uint256 slashedAuthorBondUsdcMicros, uint8 status, uint8 ruling, uint64 openedAt, uint64 resolvedAt))",
  "event SkillListingUpdated(bytes32 indexed listingId, address indexed author, uint64 revision, uint256 price, bool free, bool revisionChanged)",
  "event AuthorReportOpened(uint64 indexed reportId, address indexed reporter, address indexed author, uint256 bond, string evidenceUri)",
  "event AuthorReportResolved(uint64 indexed reportId, address indexed resolver, address indexed author, uint8 ruling, uint256 returnedReporterBond, uint256 forfeitedReporterBond, uint256 slashedAuthorBond)",
  "error AlreadyRegistered()",
  "error ListingNotFound()",
  "error ReportNotFound()",
  "error ReportNotOpen()",
]);
