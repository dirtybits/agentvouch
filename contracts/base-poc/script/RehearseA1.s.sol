// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console2} from "forge-std/console2.sol";
import {AgentVouchEvm} from "../src/AgentVouchEvm.sol";
import {AgentVouchTypes} from "../src/libraries/AgentVouchTypes.sol";
import {PaidPurchaseSettlement} from "../src/libraries/PaidPurchaseSettlement.sol";
import {MockUSDC} from "../test/mocks/MockUSDC.sol";
import {A1DeploymentConfig} from "./A1DeploymentConfig.sol";

/// @notice Local-only linked deployment and paid-purchase report rehearsal.
/// @dev Run only against a disposable Anvil node with chain ID 84532 and unlocked
///      accounts. The companion shell driver supplies distinct funded actors.
contract RehearseA1 is A1DeploymentConfig {
    uint256 internal constant ACTOR_BALANCE = 100_000_000;
    uint256 internal constant AUTHOR_BOND = 20_000_000;
    uint256 internal constant VOUCH_ONE_STAKE = 4_000_000;
    uint256 internal constant VOUCH_TWO_STAKE = 6_000_000;
    uint256 internal constant PRICE = 10_000_000;
    uint256 internal constant REPORT_BOND = 5_000_000;

    error RehearsalInvariant(string invariant);

    function run() external {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) revert RehearsalInvariant("chain-id");

        uint256 broadcasterPk = vm.envUint("LOCAL_A1_BROADCASTER_PRIVATE_KEY");
        uint256 stagingAdminPk = vm.envUint("LOCAL_A1_STAGING_ADMIN_PRIVATE_KEY");
        uint256 finalAdminPk = vm.envUint("LOCAL_A1_FINAL_ADMIN_PRIVATE_KEY");
        uint256 authorPk = vm.envUint("LOCAL_A1_AUTHOR_PRIVATE_KEY");
        uint256 buyerPk = vm.envUint("LOCAL_A1_BUYER_PRIVATE_KEY");
        uint256 voucherOnePk = vm.envUint("LOCAL_A1_VOUCHER_ONE_PRIVATE_KEY");
        uint256 voucherTwoPk = vm.envUint("LOCAL_A1_VOUCHER_TWO_PRIVATE_KEY");
        uint256 resolverPk = vm.envUint("LOCAL_A1_RESOLVER_PRIVATE_KEY");
        uint256 pauseAuthorityPk = vm.envUint("LOCAL_A1_PAUSE_AUTHORITY_PRIVATE_KEY");
        address broadcaster = vm.addr(broadcasterPk);
        address stagingAdmin = vm.addr(stagingAdminPk);
        address finalAdmin = vm.addr(finalAdminPk);
        address author = vm.addr(authorPk);
        address buyer = vm.addr(buyerPk);
        address voucherOne = vm.addr(voucherOnePk);
        address voucherTwo = vm.addr(voucherTwoPk);
        address resolver = vm.addr(resolverPk);
        address pauseAuthority = vm.addr(pauseAuthorityPk);
        address reserve = finalAdmin;
        _requireDistinct(
            broadcaster, stagingAdmin, finalAdmin, author, buyer, voucherOne, voucherTwo, resolver, pauseAuthority
        );

        address settlementLibrary = address(PaidPurchaseSettlement);
        (bytes32 expectedLibraryCodeHash, bytes32 actualLibraryCodeHash) =
            _assertExpectedSettlementLibrary(settlementLibrary);

        vm.startBroadcast(broadcasterPk);
        MockUSDC usdc = new MockUSDC();
        AgentVouchEvm av = new AgentVouchEvm(address(usdc), stagingAdmin);
        vm.stopBroadcast();

        _assertFreshDeployment(av, broadcaster, stagingAdmin, address(usdc));
        _assertExpectedAgentVouch(av, settlementLibrary, address(usdc));

        vm.startBroadcast(stagingAdminPk);
        av.setPaused(true);
        av.initializeConfig(_cfg(address(usdc), 50, reserve));
        av.grantRole(av.DEFAULT_ADMIN_ROLE(), finalAdmin);
        av.grantRole(av.CONFIG_ROLE(), finalAdmin);
        av.grantRole(av.RESOLVER_ROLE(), resolver);
        av.grantRole(av.SETTLEMENT_ROLE(), finalAdmin);
        av.grantRole(av.PAUSE_ROLE(), pauseAuthority);
        av.revokeRole(av.CONFIG_ROLE(), stagingAdmin);
        av.revokeRole(av.RESOLVER_ROLE(), stagingAdmin);
        av.revokeRole(av.SETTLEMENT_ROLE(), stagingAdmin);
        av.revokeRole(av.PAUSE_ROLE(), stagingAdmin);
        av.revokeRole(av.DEFAULT_ADMIN_ROLE(), stagingAdmin);
        vm.stopBroadcast();

        _assertFinalRoles(av, stagingAdmin, finalAdmin, finalAdmin, resolver, finalAdmin, pauseAuthority);
        if (!av.configInitialized() || !av.paused()) revert RehearsalInvariant("dormant-staging");

        vm.startBroadcast(broadcasterPk);
        usdc.mint(author, ACTOR_BALANCE);
        usdc.mint(buyer, ACTOR_BALANCE);
        usdc.mint(voucherOne, ACTOR_BALANCE);
        usdc.mint(voucherTwo, ACTOR_BALANCE);
        vm.stopBroadcast();

        _seed(av, usdc, authorPk, "ipfs://local-author");
        _seed(av, usdc, buyerPk, "ipfs://local-buyer");
        _seed(av, usdc, voucherOnePk, "ipfs://local-voucher-one");
        _seed(av, usdc, voucherTwoPk, "ipfs://local-voucher-two");

        vm.startBroadcast(pauseAuthorityPk);
        av.setPaused(false);
        vm.stopBroadcast();

        vm.startBroadcast(authorPk);
        av.depositAuthorBond(AUTHOR_BOND);
        bytes32 listingId = av.createSkillListing(
            keccak256("local-a1-rehearsal"),
            "ipfs://local-a1-skill",
            "Local A1 rehearsal",
            "Disposable Anvil fixture",
            PRICE
        );
        vm.stopBroadcast();

        vm.startBroadcast(voucherOnePk);
        av.vouch(author, VOUCH_ONE_STAKE);
        vm.stopBroadcast();
        vm.startBroadcast(voucherTwoPk);
        av.vouch(author, VOUCH_TWO_STAKE);
        vm.stopBroadcast();

        vm.startBroadcast(buyerPk);
        bytes32 purchaseId = av.purchaseSkill(listingId);
        uint64 reportId = av.openPaidPurchaseReport(author, listingId, purchaseId, "ipfs://local-a1-evidence");
        vm.stopBroadcast();

        vm.startBroadcast(resolverPk);
        av.reviewPaidPurchaseReport(reportId, true);
        vm.stopBroadcast();

        // Re-pause before terminal settlement. Resolution, slashing, funded-credit
        // claims, restitution reserve claims, and residual exits must remain live.
        vm.startBroadcast(pauseAuthorityPk);
        av.setPaused(true);
        vm.stopBroadcast();

        vm.startBroadcast(resolverPk);
        av.resolvePaidPurchaseReport(reportId, uint8(AgentVouchTypes.PaidPurchaseReportRuling.Upheld));
        vm.stopBroadcast();

        address[] memory firstPage = new address[](1);
        firstPage[0] = voucherOne;
        vm.startBroadcast(voucherOnePk);
        av.slashPaidPurchaseReportVouches(reportId, firstPage);
        vm.stopBroadcast();

        address[] memory secondPage = new address[](1);
        secondPage[0] = voucherTwo;
        vm.startBroadcast(voucherTwoPk);
        av.slashPaidPurchaseReportVouches(reportId, secondPage);
        vm.stopBroadcast();

        uint256 buyerBefore = usdc.balanceOf(buyer);
        vm.startBroadcast(buyerPk);
        av.claimPaidPurchaseReportCredit(reportId);
        vm.stopBroadcast();
        uint256 buyerCreditPaid = usdc.balanceOf(buyer) - buyerBefore;

        uint256 reserveBefore = usdc.balanceOf(reserve);
        vm.startBroadcast(finalAdminPk);
        av.claimRestitutionReserve();
        vm.stopBroadcast();
        uint256 reservePaid = usdc.balanceOf(reserve) - reserveBefore;

        uint256 voucherBefore = usdc.balanceOf(voucherOne);
        vm.startBroadcast(voucherOnePk);
        av.revokeVouch(author);
        vm.stopBroadcast();
        uint256 residualPaid = usdc.balanceOf(voucherOne) - voucherBefore;

        _assertSettlement(av, reportId, buyerCreditPaid, reservePaid, residualPaid);
        if (!av.paused()) revert RehearsalInvariant("terminal-path-unpaused");
        if (keccak256(bytes(av.PROTOCOL_VERSION())) != keccak256("base-v1-a1")) {
            revert RehearsalInvariant("protocol-version");
        }

        console2.log("LOCAL_A1_REHEARSAL_OK");
        console2.log("chainId", block.chainid);
        console2.log("PaidPurchaseSettlement", settlementLibrary);
        console2.log("expected library code hash");
        console2.logBytes32(expectedLibraryCodeHash);
        console2.log("actual library code hash");
        console2.logBytes32(actualLibraryCodeHash);
        console2.log("AgentVouchEvm", address(av));
        console2.logBytes32(address(av).codehash);
        console2.log("MockUSDC", address(usdc));
        console2.log("reportId", reportId);
        console2.log("buyerCreditPaid", buyerCreditPaid);
        console2.log("reservePaid", reservePaid);
        console2.log("voucherResidualPaid", residualPaid);
        console2.log("pausedAfterTerminalSettlement", av.paused());
    }

    function _seed(AgentVouchEvm av, MockUSDC usdc, uint256 actorPk, string memory metadataUri) private {
        vm.startBroadcast(actorPk);
        usdc.approve(address(av), type(uint256).max);
        av.registerAgent(metadataUri);
        vm.stopBroadcast();
    }

    function _assertSettlement(
        AgentVouchEvm av,
        uint64 reportId,
        uint256 buyerCreditPaid,
        uint256 reservePaid,
        uint256 residualPaid
    ) private view {
        (,,,,,,,, uint8 status, uint8 outcome) = av.getPaidPurchaseReportCore(reportId);
        (
            uint8 slashPercentage,
            uint256 activeVouchStake,
            uint256 processedPreSlashStake,
            uint256 authorBondSlash,
            uint256 voucherSlash,
            uint256 buyerEntitlement,
            uint256 fundedBuyerCredit,,
            bool creditHandled
        ) = av.getPaidPurchaseReportSettlement(reportId);

        if (status != uint8(AgentVouchTypes.PaidPurchaseReportStatus.Terminal)) {
            revert RehearsalInvariant("terminal-status");
        }
        if (outcome != uint8(AgentVouchTypes.PaidPurchaseReportOutcome.Upheld)) {
            revert RehearsalInvariant("upheld-outcome");
        }
        if (
            slashPercentage != 50 || activeVouchStake != 10_000_000 || processedPreSlashStake != 10_000_000
                || authorBondSlash != 10_000_000 || voucherSlash != 5_000_000 || buyerEntitlement != PRICE
                || fundedBuyerCredit != PRICE + REPORT_BOND || !creditHandled
        ) revert RehearsalInvariant("settlement-accounting");
        if (buyerCreditPaid != 15_000_000) revert RehearsalInvariant("buyer-credit");
        if (reservePaid != 5_000_000) revert RehearsalInvariant("reserve-credit");
        if (residualPaid != 2_000_000) revert RehearsalInvariant("voucher-residual");
    }

    function _requireDistinct(
        address a,
        address b,
        address c,
        address d,
        address e,
        address f,
        address g,
        address h,
        address ninth
    ) private pure {
        address[9] memory actors = [a, b, c, d, e, f, g, h, ninth];
        for (uint256 index; index < actors.length; ++index) {
            if (actors[index] == address(0)) revert RehearsalInvariant("zero-actor");
            for (uint256 j = index + 1; j < actors.length; ++j) {
                if (actors[index] == actors[j]) revert RehearsalInvariant("duplicate-actor");
            }
        }
    }
}
