// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AgentVouchTypes} from "./AgentVouchTypes.sol";

/// @notice Shared source-level helper for the facade and linked A1 settlement code.
/// @dev `pendingDistribution` is the author's funded, not-yet-materialized voucher
///      revenue. Materialized whole micros move to the profile's claimable ledger.
library VoucherRevenueAccounting {
    uint256 internal constant REWARD_INDEX_SCALE = 1e12;

    function accrue(
        AgentVouchTypes.AgentProfile storage authorProfile,
        AgentVouchTypes.Vouch storage v,
        uint256 pendingDistribution
    ) internal returns (uint256 pendingAfter) {
        uint256 authorIndex = authorProfile.rewardIndexUsdcMicrosX1e12;
        uint256 delta = authorIndex - v.entryRewardIndexUsdcMicrosX1e12;
        if (delta == 0 || v.stakeUsdcMicros == 0 || v.status != AgentVouchTypes.VouchStatus.Active) {
            v.entryRewardIndexUsdcMicrosX1e12 = authorIndex;
            return pendingDistribution;
        }

        uint256 accrued = (v.stakeUsdcMicros * delta) / REWARD_INDEX_SCALE;
        v.pendingRewardsUsdcMicros += accrued;
        authorProfile.unclaimedVoucherRevenueUsdcMicros += accrued;
        v.entryRewardIndexUsdcMicrosX1e12 = authorIndex;
        pendingAfter = pendingDistribution - accrued;
    }
}
