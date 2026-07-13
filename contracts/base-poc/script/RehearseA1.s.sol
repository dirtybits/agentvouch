// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console2} from "forge-std/console2.sol";
import {AgentVouchEvm} from "../src/AgentVouchEvm.sol";
import {AgentVouchTypes} from "../src/libraries/AgentVouchTypes.sol";
import {PaidPurchaseSettlement} from "../src/libraries/PaidPurchaseSettlement.sol";
import {MockUSDC} from "../test/mocks/MockUSDC.sol";
import {LinkedLibraryVerifier} from "./LinkedLibraryVerifier.sol";

/// @notice Local-only linked deployment and paid-purchase report rehearsal.
/// @dev Run only against a disposable Anvil node with chain ID 84532 and unlocked
///      accounts. The companion shell driver supplies distinct funded actors.
contract RehearseA1 is LinkedLibraryVerifier {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;
    uint256 internal constant ACTOR_BALANCE = 100_000_000;
    uint256 internal constant AUTHOR_BOND = 20_000_000;
    uint256 internal constant VOUCH_ONE_STAKE = 4_000_000;
    uint256 internal constant VOUCH_TWO_STAKE = 6_000_000;
    uint256 internal constant PRICE = 10_000_000;
    uint256 internal constant REPORT_BOND = 5_000_000;

    error RehearsalInvariant(string invariant);

    function run() external {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) revert RehearsalInvariant("chain-id");

        address deployer = vm.envAddress("LOCAL_A1_DEPLOYER");
        address author = vm.envAddress("LOCAL_A1_AUTHOR");
        address buyer = vm.envAddress("LOCAL_A1_BUYER");
        address voucherOne = vm.envAddress("LOCAL_A1_VOUCHER_ONE");
        address voucherTwo = vm.envAddress("LOCAL_A1_VOUCHER_TWO");
        address resolver = vm.envAddress("LOCAL_A1_RESOLVER");
        address reserve = vm.envAddress("LOCAL_A1_RESERVE");
        _requireDistinct(deployer, author, buyer, voucherOne, voucherTwo, resolver, reserve);

        address settlementLibrary = address(PaidPurchaseSettlement);
        (bytes32 expectedLibraryCodeHash, bytes32 actualLibraryCodeHash) =
            _assertExpectedSettlementLibrary(settlementLibrary);

        vm.startBroadcast(deployer);
        MockUSDC usdc = new MockUSDC();
        AgentVouchEvm av = new AgentVouchEvm(address(usdc), deployer);
        av.initializeConfig(_cfg(address(usdc), reserve));
        av.grantRole(av.RESOLVER_ROLE(), resolver);
        av.revokeRole(av.RESOLVER_ROLE(), deployer);
        usdc.mint(author, ACTOR_BALANCE);
        usdc.mint(buyer, ACTOR_BALANCE);
        usdc.mint(voucherOne, ACTOR_BALANCE);
        usdc.mint(voucherTwo, ACTOR_BALANCE);
        vm.stopBroadcast();

        if (!av.hasRole(av.RESOLVER_ROLE(), resolver) || av.hasRole(av.RESOLVER_ROLE(), deployer)) {
            revert RehearsalInvariant("resolver-handoff");
        }
        _seed(av, usdc, author, "ipfs://local-author");
        _seed(av, usdc, buyer, "ipfs://local-buyer");
        _seed(av, usdc, voucherOne, "ipfs://local-voucher-one");
        _seed(av, usdc, voucherTwo, "ipfs://local-voucher-two");

        vm.startBroadcast(author);
        av.depositAuthorBond(AUTHOR_BOND);
        bytes32 listingId = av.createSkillListing(
            keccak256("local-a1-rehearsal"),
            "ipfs://local-a1-skill",
            "Local A1 rehearsal",
            "Disposable Anvil fixture",
            PRICE
        );
        vm.stopBroadcast();

        vm.startBroadcast(voucherOne);
        av.vouch(author, VOUCH_ONE_STAKE);
        vm.stopBroadcast();
        vm.startBroadcast(voucherTwo);
        av.vouch(author, VOUCH_TWO_STAKE);
        vm.stopBroadcast();

        vm.startBroadcast(buyer);
        bytes32 purchaseId = av.purchaseSkill(listingId);
        uint64 reportId = av.openPaidPurchaseReport(author, listingId, purchaseId, "ipfs://local-a1-evidence");
        vm.stopBroadcast();

        vm.startBroadcast(resolver);
        av.reviewPaidPurchaseReport(reportId, true);
        av.resolvePaidPurchaseReport(reportId, uint8(AgentVouchTypes.PaidPurchaseReportRuling.Upheld));
        vm.stopBroadcast();

        address[] memory firstPage = new address[](1);
        firstPage[0] = voucherOne;
        vm.startBroadcast(voucherOne);
        av.slashPaidPurchaseReportVouches(reportId, firstPage);
        vm.stopBroadcast();

        address[] memory secondPage = new address[](1);
        secondPage[0] = voucherTwo;
        vm.startBroadcast(voucherTwo);
        av.slashPaidPurchaseReportVouches(reportId, secondPage);
        vm.stopBroadcast();

        uint256 buyerBefore = usdc.balanceOf(buyer);
        vm.startBroadcast(buyer);
        av.claimPaidPurchaseReportCredit(reportId);
        vm.stopBroadcast();
        uint256 buyerCreditPaid = usdc.balanceOf(buyer) - buyerBefore;

        uint256 reserveBefore = usdc.balanceOf(reserve);
        vm.startBroadcast(reserve);
        av.claimRestitutionReserve();
        vm.stopBroadcast();
        uint256 reservePaid = usdc.balanceOf(reserve) - reserveBefore;

        uint256 voucherBefore = usdc.balanceOf(voucherOne);
        vm.startBroadcast(voucherOne);
        av.revokeVouch(author);
        vm.stopBroadcast();
        uint256 residualPaid = usdc.balanceOf(voucherOne) - voucherBefore;

        _assertSettlement(av, reportId, buyerCreditPaid, reservePaid, residualPaid);
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
    }

    function _seed(AgentVouchEvm av, MockUSDC usdc, address actor, string memory metadataUri) private {
        vm.startBroadcast(actor);
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

    function _cfg(address usdc, address reserve) private pure returns (AgentVouchTypes.Config memory c) {
        c.usdc = usdc;
        c.chainContext = "eip155:84532";
        c.minVouchStakeUsdcMicros = 1_000_000;
        c.disputeBondUsdcMicros = REPORT_BOND;
        c.minAuthorBondForFreeListingUsdcMicros = 1_000_000;
        c.minPaidListingPriceUsdcMicros = 10_000;
        c.authorShareBps = 6_000;
        c.voucherShareBps = 4_000;
        c.slashPercentage = 50;
        c.refundClaimWindowSeconds = 7 days;
        c.treasuryRecipient = reserve;
    }

    function _requireDistinct(address a, address b, address c, address d, address e, address f, address g)
        private
        pure
    {
        address[7] memory actors = [a, b, c, d, e, f, g];
        for (uint256 i; i < actors.length; ++i) {
            if (actors[i] == address(0)) revert RehearsalInvariant("zero-actor");
            for (uint256 j = i + 1; j < actors.length; ++j) {
                if (actors[i] == actors[j]) revert RehearsalInvariant("duplicate-actor");
            }
        }
    }
}
