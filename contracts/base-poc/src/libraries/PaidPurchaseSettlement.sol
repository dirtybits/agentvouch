// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AgentVouchTypes} from "./AgentVouchTypes.sol";
import {VoucherRevenueAccounting} from "./VoucherRevenueAccounting.sol";

/// @title PaidPurchaseSettlement
/// @notice Linked paid-purchase enforcement and credit accounting.
/// @dev External library calls execute by DELEGATECALL against storage owned by
///      AgentVouchEvm. The library has no custody, roles, or independent state.
library PaidPurchaseSettlement {
    uint256 internal constant CREDIT_CLAIM_WINDOW = 7 days;
    uint256 internal constant REPORT_COOLDOWN = 7 days;
    uint256 internal constant MAX_SLASH_PAGE = 32;

    event PaidPurchaseReportRejected(
        uint64 indexed reportId,
        address indexed resolver,
        address indexed buyer,
        uint256 reserveCredit,
        uint64 buyerCooldownUntil
    );
    event PaidPurchaseReportExpired(
        uint64 indexed reportId,
        address indexed buyer,
        address indexed author,
        uint256 buyerCredit,
        uint64 claimDeadline,
        uint64 authorCooldownUntil
    );
    event PaidPurchaseReportParked(
        uint64 indexed reportId,
        address indexed resolver,
        address indexed author,
        uint8 slashPercentage,
        uint256 activeVouchStake,
        uint256 authorBondSlash
    );
    event PaidPurchaseReportVouchSlashed(
        uint64 indexed reportId,
        address indexed voucher,
        uint256 preSlashStake,
        uint256 slashAmount,
        uint256 processedPreSlashStake
    );
    event PaidPurchaseReportDismissed(
        uint64 indexed reportId,
        address indexed resolver,
        address indexed author,
        uint256 reserveCredit,
        uint64 buyerCooldownUntil
    );
    event PaidPurchaseReportFinalized(
        uint64 indexed reportId,
        address indexed author,
        address indexed buyer,
        uint256 buyerEntitlement,
        uint256 buyerCredit,
        uint256 reserveCredit,
        uint64 claimDeadline
    );
    event PaidPurchaseReportCreditClaimed(uint64 indexed reportId, address indexed buyer, uint256 amount);
    event PaidPurchaseReportCreditExpired(uint64 indexed reportId, uint256 reserveCredit);

    error PaidPurchaseReportNotFound();
    error PaidPurchaseReportInvalidState();
    error PaidPurchaseSlashPageTooLarge();
    error PaidPurchaseSlashSnapshotIncomplete();
    error PaidPurchaseCreditNotFunded();
    error PaidPurchaseCreditExpired();
    error PaidPurchaseCreditOpen();
    error PaidPurchaseCreditAlreadyHandled();
    error NoActiveVouch();
    error DisputeLocked();
    error NothingToClaim();
    error ListingNotFound();
    error NotListingAuthor();
    error ZeroAmount();
    error SettlementNotInitialized();
    error SettlementLocked();
    error ProceedsTimeLocked();
    error InsufficientProceeds();

    function takeAuthorProceeds(
        mapping(bytes32 => AgentVouchTypes.SkillListing) storage listings,
        mapping(
            bytes32
                => mapping(
                uint64 => AgentVouchTypes.ListingSettlement
            )
        ) storage settlements,
        mapping(address => uint256) storage roundingAuthorProceeds,
        bytes32 listingId,
        uint64 revision,
        address author,
        uint256 amount,
        uint256 lockSeconds
    ) external {
        AgentVouchTypes.SkillListing storage listing = listings[listingId];
        if (!listing.exists) revert ListingNotFound();
        if (listing.author != author) revert NotListingAuthor();
        if (amount == 0) revert ZeroAmount();

        AgentVouchTypes.ListingSettlement storage settlement = settlements[listingId][revision];
        if (!settlement.initialized) revert SettlementNotInitialized();
        if (settlement.locked) revert SettlementLocked();
        if (block.timestamp < uint256(settlement.updatedAt) + lockSeconds) revert ProceedsTimeLocked();

        uint256 listingProceeds = settlement.authorProceedsUsdcMicros;
        uint256 roundingProceeds = roundingAuthorProceeds[author];
        if (amount > listingProceeds + roundingProceeds) revert InsufficientProceeds();
        uint256 fromListing = amount < listingProceeds ? amount : listingProceeds;
        settlement.authorProceedsUsdcMicros = listingProceeds - fromListing;
        roundingAuthorProceeds[author] = roundingProceeds - (amount - fromListing);
    }

    function exitVouch(
        mapping(address => AgentVouchTypes.AgentProfile) storage profiles,
        mapping(bytes32 => AgentVouchTypes.Vouch) storage vouches,
        mapping(address => uint256) storage pendingDistribution,
        mapping(address => uint256) storage roundingAuthorProceeds,
        address voucher,
        address author
    ) external returns (uint256 stake) {
        AgentVouchTypes.Vouch storage v = vouches[keccak256(abi.encode(voucher, author))];
        if (v.voucher == address(0)) revert NoActiveVouch();
        AgentVouchTypes.AgentProfile storage authorProfile = profiles[author];
        if (authorProfile.openDisputes > 0) revert DisputeLocked();

        stake = v.stakeUsdcMicros;
        if (v.status == AgentVouchTypes.VouchStatus.Active) {
            pendingDistribution[author] = VoucherRevenueAccounting.accrue(authorProfile, v, pendingDistribution[author]);
            authorProfile.totalVouchStakeReceivedUsdcMicros -= stake;
            if (authorProfile.totalVouchStakeReceivedUsdcMicros == 0) {
                roundingAuthorProceeds[author] += pendingDistribution[author];
                pendingDistribution[author] = 0;
            }
        } else if (v.status != AgentVouchTypes.VouchStatus.Slashed) {
            revert NoActiveVouch();
        }

        v.status = AgentVouchTypes.VouchStatus.Revoked;
        v.stakeUsdcMicros = 0;
    }

    function materializeVoucherClaim(
        mapping(address => AgentVouchTypes.AgentProfile) storage profiles,
        mapping(bytes32 => AgentVouchTypes.Vouch) storage vouches,
        mapping(address => uint256) storage pendingDistribution,
        address voucher,
        address author
    ) external returns (uint256 claimable) {
        AgentVouchTypes.Vouch storage v = vouches[keccak256(abi.encode(voucher, author))];
        if (v.voucher == address(0)) revert NoActiveVouch();
        AgentVouchTypes.AgentProfile storage authorProfile = profiles[author];
        pendingDistribution[author] = VoucherRevenueAccounting.accrue(authorProfile, v, pendingDistribution[author]);
        claimable = v.pendingRewardsUsdcMicros;
        if (claimable == 0) revert NothingToClaim();

        authorProfile.unclaimedVoucherRevenueUsdcMicros -= claimable;
        v.pendingRewardsUsdcMicros = 0;
        v.cumulativeRevenueUsdcMicros += claimable;
        v.lastPayoutAt = uint64(block.timestamp);
    }

    function terminateWithoutSlash(
        AgentVouchTypes.PaidPurchaseState storage state,
        mapping(address => AgentVouchTypes.AgentProfile) storage profiles,
        mapping(bytes32 => AgentVouchTypes.SkillListing) storage listings,
        uint64 reportId,
        AgentVouchTypes.PaidPurchaseReportOutcome outcome
    ) external {
        AgentVouchTypes.PaidPurchaseReport storage report = _report(state, reportId);
        uint64 now_ = uint64(block.timestamp);

        if (outcome == AgentVouchTypes.PaidPurchaseReportOutcome.Rejected) {
            if (report.status != AgentVouchTypes.PaidPurchaseReportStatus.Pending) {
                revert PaidPurchaseReportInvalidState();
            }
            uint256 reserveCredit = report.bondUsdcMicros;
            state.restitutionReserveCreditUsdcMicros += reserveCredit;
            report.bondUsdcMicros = 0;
            report.outcome = outcome;
            report.status = AgentVouchTypes.PaidPurchaseReportStatus.Terminal;
            report.terminalAt = now_;
            state.buyerCooldownUntil[report.buyer] = uint64(block.timestamp + REPORT_COOLDOWN);
            _clearExposure(state, profiles, listings, reportId, report);
            emit PaidPurchaseReportRejected(
                reportId, msg.sender, report.buyer, reserveCredit, state.buyerCooldownUntil[report.buyer]
            );
            return;
        }

        if (outcome == AgentVouchTypes.PaidPurchaseReportOutcome.Expired) {
            if (report.status != AgentVouchTypes.PaidPurchaseReportStatus.Pending) {
                revert PaidPurchaseReportInvalidState();
            }
            report.buyerCreditUsdcMicros = report.bondUsdcMicros;
            report.bondUsdcMicros = 0;
            report.claimDeadline = uint64(block.timestamp + CREDIT_CLAIM_WINDOW);
            report.outcome = outcome;
            report.status = AgentVouchTypes.PaidPurchaseReportStatus.Terminal;
            report.terminalAt = now_;
            state.authorCooldownUntil[report.author] = uint64(block.timestamp + REPORT_COOLDOWN);
            _clearExposure(state, profiles, listings, reportId, report);
            emit PaidPurchaseReportExpired(
                reportId,
                report.buyer,
                report.author,
                report.buyerCreditUsdcMicros,
                report.claimDeadline,
                state.authorCooldownUntil[report.author]
            );
            return;
        }

        if (outcome == AgentVouchTypes.PaidPurchaseReportOutcome.Dismissed) {
            if (report.status != AgentVouchTypes.PaidPurchaseReportStatus.Accepted) {
                revert PaidPurchaseReportInvalidState();
            }
            uint256 reserveCredit = report.bondUsdcMicros;
            state.restitutionReserveCreditUsdcMicros += reserveCredit;
            report.bondUsdcMicros = 0;
            report.outcome = outcome;
            report.status = AgentVouchTypes.PaidPurchaseReportStatus.Terminal;
            report.terminalAt = now_;
            state.buyerCooldownUntil[report.buyer] = uint64(block.timestamp + REPORT_COOLDOWN);
            profiles[report.author].dismissedDisputes += 1;
            _clearExposure(state, profiles, listings, reportId, report);
            emit PaidPurchaseReportDismissed(
                reportId, msg.sender, report.author, reserveCredit, state.buyerCooldownUntil[report.buyer]
            );
            return;
        }

        revert PaidPurchaseReportInvalidState();
    }

    function uphold(
        AgentVouchTypes.PaidPurchaseState storage state,
        mapping(address => AgentVouchTypes.AgentProfile) storage profiles,
        mapping(bytes32 => AgentVouchTypes.SkillListing) storage listings,
        mapping(bytes32 => AgentVouchTypes.Purchase) storage purchases,
        AgentVouchTypes.Config storage config,
        uint64 reportId
    ) external {
        AgentVouchTypes.PaidPurchaseReport storage report = _report(state, reportId);
        if (report.status != AgentVouchTypes.PaidPurchaseReportStatus.Accepted) {
            revert PaidPurchaseReportInvalidState();
        }

        AgentVouchTypes.AgentProfile storage authorProfile = profiles[report.author];
        report.snapshottedSlashPercentage = config.slashPercentage;
        report.snapshottedActiveVouchStakeUsdcMicros = authorProfile.totalVouchStakeReceivedUsdcMicros;
        report.authorBondSlashUsdcMicros =
            Math.mulDiv(authorProfile.authorBondUsdcMicros, report.snapshottedSlashPercentage, 100);
        authorProfile.authorBondUsdcMicros -= report.authorBondSlashUsdcMicros;
        authorProfile.totalAuthorBondSlashedUsdcMicros += report.authorBondSlashUsdcMicros;

        if (report.snapshottedActiveVouchStakeUsdcMicros == 0) {
            _finalize(state, profiles, listings, purchases, reportId, report);
        } else {
            report.status = AgentVouchTypes.PaidPurchaseReportStatus.SlashingVouchers;
            emit PaidPurchaseReportParked(
                reportId,
                msg.sender,
                report.author,
                report.snapshottedSlashPercentage,
                report.snapshottedActiveVouchStakeUsdcMicros,
                report.authorBondSlashUsdcMicros
            );
        }
    }

    function slashVouches(
        AgentVouchTypes.PaidPurchaseState storage state,
        mapping(address => AgentVouchTypes.AgentProfile) storage profiles,
        mapping(bytes32 => AgentVouchTypes.Vouch) storage vouches,
        mapping(bytes32 => AgentVouchTypes.SkillListing) storage listings,
        mapping(bytes32 => AgentVouchTypes.Purchase) storage purchases,
        mapping(address => uint256) storage pendingDistribution,
        mapping(address => uint256) storage roundingAuthorProceeds,
        uint64 reportId,
        address[] calldata candidates
    ) external {
        if (candidates.length > MAX_SLASH_PAGE) revert PaidPurchaseSlashPageTooLarge();
        AgentVouchTypes.PaidPurchaseReport storage report = _report(state, reportId);
        if (report.status != AgentVouchTypes.PaidPurchaseReportStatus.SlashingVouchers) {
            revert PaidPurchaseReportInvalidState();
        }

        AgentVouchTypes.AgentProfile storage authorProfile = profiles[report.author];
        for (uint256 i; i < candidates.length; ++i) {
            address voucher = candidates[i];
            if (state.vouchProcessed[reportId][voucher]) continue;

            AgentVouchTypes.Vouch storage v = vouches[keccak256(abi.encode(voucher, report.author))];
            if (
                v.voucher == address(0) || v.vouchee != report.author || v.status != AgentVouchTypes.VouchStatus.Active
                    || v.stakeUsdcMicros == 0
            ) continue;

            pendingDistribution[report.author] =
                VoucherRevenueAccounting.accrue(authorProfile, v, pendingDistribution[report.author]);
            uint256 preSlashStake = v.stakeUsdcMicros;
            if (report.processedPreSlashStakeUsdcMicros + preSlashStake > report.snapshottedActiveVouchStakeUsdcMicros) revert PaidPurchaseSlashSnapshotIncomplete();
            uint256 slashAmount = Math.mulDiv(preSlashStake, report.snapshottedSlashPercentage, 100);

            state.vouchProcessed[reportId][voucher] = true;
            report.processedPreSlashStakeUsdcMicros += preSlashStake;
            report.voucherSlashUsdcMicros += slashAmount;
            authorProfile.totalVouchStakeReceivedUsdcMicros -= preSlashStake;
            authorProfile.totalVouchStakeSlashedUsdcMicros += slashAmount;
            v.stakeUsdcMicros = preSlashStake - slashAmount;
            v.status = AgentVouchTypes.VouchStatus.Slashed;

            if (authorProfile.totalVouchStakeReceivedUsdcMicros == 0) {
                roundingAuthorProceeds[report.author] += pendingDistribution[report.author];
                pendingDistribution[report.author] = 0;
            }

            emit PaidPurchaseReportVouchSlashed(
                reportId, voucher, preSlashStake, slashAmount, report.processedPreSlashStakeUsdcMicros
            );
        }

        if (report.processedPreSlashStakeUsdcMicros == report.snapshottedActiveVouchStakeUsdcMicros) {
            _finalize(state, profiles, listings, purchases, reportId, report);
        }
    }

    function claimCredit(AgentVouchTypes.PaidPurchaseState storage state, uint64 reportId, address buyer)
        external
        returns (uint256 amount)
    {
        AgentVouchTypes.PaidPurchaseReport storage report = _report(state, reportId);
        if (report.buyer != buyer) revert PaidPurchaseReportInvalidState();
        if (report.buyerCreditUsdcMicros == 0) revert PaidPurchaseCreditNotFunded();
        if (report.creditHandled) revert PaidPurchaseCreditAlreadyHandled();
        if (block.timestamp >= report.claimDeadline) revert PaidPurchaseCreditExpired();
        report.creditHandled = true;
        amount = report.buyerCreditUsdcMicros;
        emit PaidPurchaseReportCreditClaimed(reportId, buyer, amount);
    }

    function closeCredit(AgentVouchTypes.PaidPurchaseState storage state, uint64 reportId)
        external
        returns (uint256 amount)
    {
        AgentVouchTypes.PaidPurchaseReport storage report = _report(state, reportId);
        if (report.buyerCreditUsdcMicros == 0) revert PaidPurchaseCreditNotFunded();
        if (report.creditHandled) revert PaidPurchaseCreditAlreadyHandled();
        if (block.timestamp < report.claimDeadline) revert PaidPurchaseCreditOpen();
        report.creditHandled = true;
        amount = report.buyerCreditUsdcMicros;
        state.restitutionReserveCreditUsdcMicros += amount;
        emit PaidPurchaseReportCreditExpired(reportId, amount);
    }

    function takeReserveCredit(AgentVouchTypes.PaidPurchaseState storage state) external returns (uint256 amount) {
        amount = state.restitutionReserveCreditUsdcMicros;
        if (amount == 0) revert PaidPurchaseCreditNotFunded();
        state.restitutionReserveCreditUsdcMicros = 0;
    }

    function _finalize(
        AgentVouchTypes.PaidPurchaseState storage state,
        mapping(address => AgentVouchTypes.AgentProfile) storage profiles,
        mapping(bytes32 => AgentVouchTypes.SkillListing) storage listings,
        mapping(bytes32 => AgentVouchTypes.Purchase) storage purchases,
        uint64 reportId,
        AgentVouchTypes.PaidPurchaseReport storage report
    ) private {
        if (report.processedPreSlashStakeUsdcMicros != report.snapshottedActiveVouchStakeUsdcMicros) {
            revert PaidPurchaseSlashSnapshotIncomplete();
        }

        uint256 totalSlash = report.authorBondSlashUsdcMicros + report.voucherSlashUsdcMicros;
        uint256 purchasePrice = purchases[report.purchaseId].priceUsdcMicros;
        report.buyerEntitlementUsdcMicros = totalSlash < purchasePrice ? totalSlash : purchasePrice;
        report.buyerCreditUsdcMicros = report.bondUsdcMicros + report.buyerEntitlementUsdcMicros;
        report.bondUsdcMicros = 0;
        uint256 reserveCredit = totalSlash - report.buyerEntitlementUsdcMicros;
        state.restitutionReserveCreditUsdcMicros += reserveCredit;
        report.claimDeadline = uint64(block.timestamp + CREDIT_CLAIM_WINDOW);
        report.terminalAt = uint64(block.timestamp);
        report.status = AgentVouchTypes.PaidPurchaseReportStatus.Terminal;
        report.outcome = AgentVouchTypes.PaidPurchaseReportOutcome.Upheld;

        AgentVouchTypes.AgentProfile storage authorProfile = profiles[report.author];
        authorProfile.upheldDisputes += 1;
        authorProfile.slashingReportCount += 1;
        _clearExposure(state, profiles, listings, reportId, report);
        emit PaidPurchaseReportFinalized(
            reportId,
            report.author,
            report.buyer,
            report.buyerEntitlementUsdcMicros,
            report.buyerCreditUsdcMicros,
            reserveCredit,
            report.claimDeadline
        );
    }

    function _clearExposure(
        AgentVouchTypes.PaidPurchaseState storage state,
        mapping(address => AgentVouchTypes.AgentProfile) storage profiles,
        mapping(bytes32 => AgentVouchTypes.SkillListing) storage listings,
        uint64 reportId,
        AgentVouchTypes.PaidPurchaseReport storage report
    ) private {
        if (state.activeReportByBuyer[report.buyer] == reportId) {
            state.activeReportByBuyer[report.buyer] = 0;
        }
        if (state.activeReportByAuthor[report.author] == reportId) state.activeReportByAuthor[report.author] = 0;
        if (state.activeReportByListing[report.listingId] == reportId) {
            state.activeReportByListing[report.listingId] = 0;
        }
        state.purchaseLockedByAuthor[report.author] = false;
        listings[report.listingId].lockedByDispute = false;
        profiles[report.author].openDisputes -= 1;
    }

    function _report(AgentVouchTypes.PaidPurchaseState storage state, uint64 reportId)
        private
        view
        returns (AgentVouchTypes.PaidPurchaseReport storage report)
    {
        report = state.reports[reportId];
        if (!report.exists) revert PaidPurchaseReportNotFound();
    }
}
