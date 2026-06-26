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

export const AGENTVOUCH_EVM_READ_ABI: readonly string[] = [
  `function getListing(bytes32 id) view returns (${AGENTVOUCH_EVM_SKILL_LISTING_TUPLE})`,
  // pure helper; lets a caller derive a listingId from (author, skillIdHash) for DB-driven reads.
  "function listingId(address author, bytes32 skillIdHash) pure returns (bytes32)",
  "event SkillListingCreated(bytes32 indexed listingId, address indexed author, uint256 price, bool free)",
  "event SkillListingRemoved(bytes32 indexed listingId)",
];

// ListingStatus enum (AgentVouchTypes.sol): Active = 0, Suspended = 1, Removed = 2.
// SkillListingView.active maps to status === Active, matching the Solana adapter's status-only rule.
export const LISTING_STATUS_ACTIVE = 0;
