// Read-only ABI fragments for AgentVouchEvm on Base, as human-readable Solidity signatures.
//
// Kept as plain strings (NO viem import at module top) so importing this file never drags viem
// into a client bundle; read callers `parseAbi(...)` these inside a dynamic import. The
// SkillListing tuple mirrors `contracts/base-poc/src/libraries/AgentVouchTypes.sol` (struct
// SkillListing) field-for-field. NOTE: the minimal harness ABI
// (`contracts/base-poc/harness/src/abi.ts`) is WRITE-ONLY — it has no getListing/events, so do
// not use it for reads. See .agents/plans/base-port-chain-adapter.plan.md (Phase 3 read recon).

// struct SkillListing { ... } as a named tuple — viem returns it as an object with these keys.
export const AGENTVOUCH_EVM_SKILL_LISTING_TUPLE =
  "(address author, bytes32 skillIdHash, string uri, string name, string description, " +
  "uint256 priceUsdcMicros, uint64 currentRevision, uint256 totalDownloads, " +
  "uint256 totalRevenueUsdcMicros, uint8 status, bool lockedByDispute, bool exists)";

export const AGENTVOUCH_EVM_AGENT_PROFILE_TUPLE =
  "(bool registered, string metadataUri, uint256 reputationScore, " +
  "uint64 totalVouchesReceived, uint64 totalVouchesGiven, " +
  "uint256 totalVouchStakeReceivedUsdcMicros, uint256 authorBondUsdcMicros, " +
  "uint64 activeFreeListingCount, uint64 openDisputes, uint64 upheldDisputes, " +
  "uint64 dismissedDisputes, uint256 rewardIndexUsdcMicrosX1e12, " +
  "uint256 unclaimedVoucherRevenueUsdcMicros, uint64 registeredAt)";

export const AGENTVOUCH_EVM_AUTHOR_REPORT_TUPLE =
  "(bool exists, address reporter, address author, string evidenceUri, " +
  "uint256 bondUsdcMicros, uint256 forfeitedReporterBondUsdcMicros, uint256 slashedAuthorBondUsdcMicros, " +
  "uint8 status, uint8 ruling, uint64 openedAt, uint64 resolvedAt)";

export const AGENTVOUCH_EVM_CONFIG_TUPLE =
  "(address usdc, string chainContext, uint256 minVouchStakeUsdcMicros, " +
  "uint256 disputeBondUsdcMicros, uint256 minAuthorBondForFreeListingUsdcMicros, " +
  "uint256 minPaidListingPriceUsdcMicros, uint16 authorShareBps, uint16 voucherShareBps, " +
  "uint16 protocolFeeBps, uint8 slashPercentage, uint256 authorProceedsLockSeconds, " +
  "uint256 refundClaimWindowSeconds, uint16 challengerRewardBps, " +
  "uint256 challengerRewardCapUsdcMicros, uint32 stakeWeightPerUsdc, " +
  "uint256 riskComponentCap, uint32 vouchWeight, uint256 vouchComponentCap, " +
  "uint32 longevityBonusPerDay, uint256 longevityComponentCap, " +
  "uint256 upheldDisputePenalty, uint256 reputationScoreCap)";

export const AGENTVOUCH_EVM_ERROR_ABI: readonly string[] = [
  "error ZeroAddress()",
  "error AlreadyInitialized()",
  "error NotInitialized()",
  "error UsdcMismatch()",
  "error BadEconomics()",
  "error AlreadyRegistered()",
  "error EmptyMetadata()",
  "error NotRegistered()",
  "error ZeroAmount()",
  "error InsufficientBond()",
  "error BondExposureLocked()",
  "error DisputeLocked()",
  "error BelowMinVouchStake()",
  "error InvalidVouchee()",
  "error VouchAlreadyActive()",
  "error VouchSlashed()",
  "error NoActiveVouch()",
  "error ListingExists()",
  "error ListingNotFound()",
  "error NotListingAuthor()",
  "error BelowMinPaidPrice()",
  "error FreeListingBondFloor()",
  "error FreeSkillNotPurchased()",
  "error ListingNotActive()",
  "error SettlementNotInitialized()",
  "error SettlementLocked()",
  "error DuplicatePurchase()",
  "error VoucherPoolTooSmall()",
  "error NothingToClaim()",
  "error ProceedsTimeLocked()",
  "error InsufficientProceeds()",
  "error InvalidPaymentRef()",
  "error PaymentRefUsed()",
  "error SettlementTxUsed()",
  "error SettlementAmountMismatch()",
  "error ReportNotFound()",
  "error ReportNotOpen()",
  "error InvalidAuthor()",
];

export const AGENTVOUCH_EVM_READ_ABI: readonly string[] = [
  ...AGENTVOUCH_EVM_ERROR_ABI,
  "function PROTOCOL_VERSION() view returns (string)",
  `function getConfig() view returns (${AGENTVOUCH_EVM_CONFIG_TUPLE})`,
  `function getListing(bytes32 id) view returns (${AGENTVOUCH_EVM_SKILL_LISTING_TUPLE})`,
  `function getProfile(address agent) view returns (${AGENTVOUCH_EVM_AGENT_PROFILE_TUPLE})`,
  `function getAuthorReport(uint64 reportId) view returns (${AGENTVOUCH_EVM_AUTHOR_REPORT_TUPLE})`,
  // pure helper; lets a caller derive a listingId from (author, skillIdHash) for DB-driven reads.
  "function listingId(address author, bytes32 skillIdHash) pure returns (bytes32)",
  "event ProtocolVersionDeclared(string version)",
  "event SkillListingCreated(bytes32 indexed listingId, address indexed author, uint256 price, bool free)",
  "event SkillListingRemoved(bytes32 indexed listingId)",
  "event AuthorReportOpened(uint64 indexed reportId, address indexed reporter, address indexed author, uint256 bond, string evidenceUri)",
  "event AuthorReportResolved(uint64 indexed reportId, address indexed resolver, address indexed author, uint8 ruling, uint256 returnedReporterBond, uint256 forfeitedReporterBond, uint256 slashedAuthorBond)",
];

// ListingStatus enum (AgentVouchTypes.sol): Active = 0, Suspended = 1, Removed = 2.
// SkillListingView.active maps to status === Active, matching the Solana adapter's status-only rule.
export const LISTING_STATUS_ACTIVE = 0;
