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

    // Mirrors Solana AuthorDisputeStatus.
    enum DisputeStatus {
        Open,
        Resolved,
        SlashingVouchers
    }

    // Mirrors Solana AuthorDisputeLiabilityScope.
    enum LiabilityScope {
        AuthorBondOnly,
        AuthorBondThenVouchers
    }

    // Mirrors Solana AuthorDisputeRuling.
    enum Ruling {
        Upheld,
        Dismissed
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
    }
}
