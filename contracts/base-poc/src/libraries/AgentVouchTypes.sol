// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title AgentVouchTypes
/// @notice Shared enums and structs for the Base POC. Mirrors the Solana state
///         (`programs/agentvouch/src/state/*.rs`) by spec. Authority pubkeys from
///         the Solana `Config` are replaced by OpenZeppelin AccessControl roles and
///         are intentionally NOT stored here. No vault/rent-payer fields exist on
///         EVM: the contract custodies USDC and tracks all balances internally.
library AgentVouchTypes {
    enum VouchStatus {
        Active,
        Revoked,
        Slashed
    }

    enum ListingStatus {
        Active,
        Suspended,
        Removed
    }

    enum PurchaseLane {
        None,
        Direct,
        Authorization,
        Settlement
    }

    enum PaidPurchaseReportStatus {
        None,
        Pending,
        Accepted,
        SlashingVouchers,
        Terminal
    }

    enum PaidPurchaseReportOutcome {
        None,
        Rejected,
        Expired,
        Dismissed,
        Upheld
    }

    enum PaidPurchaseReportRuling {
        None,
        Dismissed,
        Upheld
    }

    /// @dev Mirrors Solana `Config` (state/config.rs) minus the authority pubkeys
    ///      (now AccessControl roles) and the SPL token-program/vault pointers.
    struct Config {
        address usdc; // 6-decimal USDC on the target Base network
        string chainContext; // CAIP-2, e.g. "eip155:8453" (Base) / "eip155:84532" (Sepolia)
        uint256 minVouchStakeUsdcMicros;
        uint256 disputeBondUsdcMicros;
        uint256 minAuthorBondForFreeListingUsdcMicros;
        uint256 minPaidListingPriceUsdcMicros;
        uint16 authorShareBps;
        uint16 voucherShareBps;
        // Reserved in the Base POC until purchaseSkill collects and routes protocol fees.
        uint16 protocolFeeBps;
        uint8 slashPercentage;
        uint256 authorProceedsLockSeconds;
        uint256 refundClaimWindowSeconds;
        uint16 challengerRewardBps;
        uint256 challengerRewardCapUsdcMicros;
        // Reputation-scoring params (parity placeholders; scoring ported later).
        uint32 stakeWeightPerUsdc;
        uint256 riskComponentCap;
        uint32 vouchWeight;
        uint256 vouchComponentCap;
        uint32 longevityBonusPerDay;
        uint256 longevityComponentCap;
        uint256 upheldDisputePenalty;
        uint256 reputationScoreCap;
        // Immutable destination for paid-purchase report residuals. Appended so the
        // deployment input cannot be confused with the legacy config layout.
        address treasuryRecipient;
    }

    /// @dev Mirrors Solana `AgentProfile` (state/agent.rs). `rewardIndexUsdcMicrosX1e12`
    ///      matches `reward_index_usdc_micros_x1e12` — author-wide reward-index accounting.
    struct AgentProfile {
        bool registered;
        string metadataUri;
        uint256 reputationScore;
        uint64 totalVouchesReceived;
        uint64 totalVouchesGiven;
        uint256 totalVouchStakeReceivedUsdcMicros;
        uint256 authorBondUsdcMicros;
        uint64 activeFreeListingCount;
        uint64 openDisputes;
        uint64 upheldDisputes;
        uint64 dismissedDisputes;
        uint256 rewardIndexUsdcMicrosX1e12;
        uint256 unclaimedVoucherRevenueUsdcMicros;
        uint64 registeredAt;
        // A1 aggregate counters. The clean-break `base-v1-a1` profile tuple exposes
        // them directly; clients must bind tuple decoding to PROTOCOL_VERSION because
        // the deployed pre-A1 candidate has the shorter legacy tuple.
        uint64 slashingReportCount;
        uint256 totalAuthorBondSlashedUsdcMicros;
        uint256 totalVouchStakeSlashedUsdcMicros;
    }

    /// @dev Mirrors Solana `Vouch` (state/vouch.rs). No vault/rent-payer fields.
    struct Vouch {
        address voucher;
        address vouchee;
        uint256 stakeUsdcMicros;
        VouchStatus status;
        uint256 cumulativeRevenueUsdcMicros;
        uint64 linkedListingCount;
        uint256 entryRewardIndexUsdcMicrosX1e12;
        uint256 pendingRewardsUsdcMicros;
        uint64 lastPayoutAt;
    }

    /// @dev Mirrors Solana `SkillListing` (state/skill_listing.rs). `exists` flags a
    ///      live slot since Solidity mappings have no membership concept.
    struct SkillListing {
        address author;
        bytes32 skillIdHash;
        string uri;
        string name;
        string description;
        uint256 priceUsdcMicros; // 0 == free listing
        uint64 currentRevision;
        uint256 totalDownloads;
        uint256 totalRevenueUsdcMicros;
        ListingStatus status;
        bool lockedByDispute;
        bool exists;
    }

    /// @dev Mirrors Solana `ListingSettlement` (state/settlement.rs). The
    ///      `author_proceeds_vault` becomes internal withdrawable accounting;
    ///      `slashedDeposit` is ring-fenced (refund-pool-only, set in Phase 5).
    struct ListingSettlement {
        bool initialized;
        uint64 createdAt;
        uint64 updatedAt; // refreshed on each purchase; basis for the author-proceeds time lock (Solana parity)
        uint256 authorProceedsUsdcMicros;
        uint256 slashedDepositUsdcMicros;
        bool locked;
    }

    /// @dev Mirrors Solana `Purchase` (state/purchase.rs). Revision-scoped receipt;
    ///      `exists` distinguishes a live receipt from an empty mapping slot.
    struct Purchase {
        bool exists;
        address buyer;
        bytes32 listingId;
        uint64 revision;
        uint256 priceUsdcMicros;
        uint256 authorShareUsdcMicros;
        uint256 voucherPoolUsdcMicros;
        uint64 timestamp;
        PurchaseLane lane;
    }

    struct PaidPurchaseReport {
        bool exists;
        address buyer;
        address author;
        bytes32 listingId;
        bytes32 purchaseId;
        string evidenceUri;
        uint64 filedAt;
        uint64 reviewDeadline;
        uint64 acceptedAt;
        uint64 terminalAt;
        PaidPurchaseReportStatus status;
        PaidPurchaseReportOutcome outcome;
        uint256 bondUsdcMicros;
        uint8 snapshottedSlashPercentage;
        uint256 snapshottedActiveVouchStakeUsdcMicros;
        uint256 processedPreSlashStakeUsdcMicros;
        uint256 authorBondSlashUsdcMicros;
        uint256 voucherSlashUsdcMicros;
        uint256 buyerEntitlementUsdcMicros;
        uint256 buyerCreditUsdcMicros;
        uint64 claimDeadline;
        bool creditHandled;
    }

    /// @dev All A1 state is owned by the facade and passed explicitly to the
    ///      linked settlement library as one frozen storage boundary.
    struct PaidPurchaseState {
        mapping(uint64 => PaidPurchaseReport) reports;
        mapping(bytes32 => uint64) reportIdByPurchase;
        mapping(address => uint64) activeReportByBuyer;
        mapping(address => uint64) activeReportByAuthor;
        mapping(bytes32 => uint64) activeReportByListing;
        mapping(address => uint64) buyerCooldownUntil;
        mapping(address => uint64) authorCooldownUntil;
        mapping(address => bool) purchaseLockedByAuthor;
        mapping(uint64 => mapping(address => bool)) vouchProcessed;
        uint64 nextReportId;
        uint256 restitutionReserveCreditUsdcMicros;
    }
}
