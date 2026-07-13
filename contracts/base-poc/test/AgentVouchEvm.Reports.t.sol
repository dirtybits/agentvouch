// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgentVouchEvm} from "../src/AgentVouchEvm.sol";
import {AgentVouchTypes} from "../src/libraries/AgentVouchTypes.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract ReportsTest is Test {
    uint256 internal constant PRICE = 10_000_000;
    uint256 internal constant BOND = 5_000_000;
    address internal constant ADMIN = address(0xA11CE);
    address internal constant AUTHOR = address(0xA0);
    address internal constant BUYER = address(0xB0);
    address internal constant BUYER_TWO = address(0xB2);
    address internal constant VOUCHER = address(0xC0);
    address internal constant RESERVE = address(0xD00D);
    address internal constant RESOLVER_TWO = address(0xE2);

    MockUSDC internal usdc;
    AgentVouchEvm internal av;
    bytes32 internal listing;
    bytes32 internal purchase;

    function setUp() public {
        vm.chainId(84532);
        usdc = new MockUSDC();
        av = new AgentVouchEvm(address(usdc), ADMIN);
        vm.prank(ADMIN);
        av.initializeConfig(_cfg());

        _seed(AUTHOR);
        _seed(BUYER);
        _seed(BUYER_TWO);
        _seed(VOUCHER);

        vm.prank(AUTHOR);
        listing = av.createSkillListing(keccak256("paid"), "ipfs://paid", "paid", "desc", PRICE);
        vm.prank(BUYER);
        purchase = av.purchaseSkill(listing);
    }

    function _cfg() internal view returns (AgentVouchTypes.Config memory c) {
        c.usdc = address(usdc);
        c.chainContext = "eip155:84532";
        c.minVouchStakeUsdcMicros = 1_000_000;
        c.disputeBondUsdcMicros = BOND;
        c.minAuthorBondForFreeListingUsdcMicros = 1_000_000;
        c.minPaidListingPriceUsdcMicros = 10_000;
        c.authorShareBps = 6_000;
        c.voucherShareBps = 4_000;
        c.slashPercentage = 50;
        c.refundClaimWindowSeconds = 7 days;
        c.treasuryRecipient = RESERVE;
    }

    function _seed(address who) internal {
        usdc.mint(who, 1_000_000_000);
        vm.startPrank(who);
        usdc.approve(address(av), type(uint256).max);
        av.registerAgent("ipfs://agent");
        vm.stopPrank();
    }

    function _open() internal returns (uint64 reportId) {
        vm.prank(BUYER);
        reportId = av.openPaidPurchaseReport(AUTHOR, listing, purchase, "ipfs://evidence");
    }

    function test_openPaidPurchaseReportConsumesReceiptAndExposesCompactReads() public {
        uint64 reportId = _open();
        (
            address buyer,
            address author,
            bytes32 listingId_,
            bytes32 purchaseId_,,
            uint64 reviewDeadline,,,
            uint8 status,
            uint8 outcome
        ) = av.getPaidPurchaseReportCore(reportId);
        assertEq(buyer, BUYER);
        assertEq(author, AUTHOR);
        assertEq(listingId_, listing);
        assertEq(purchaseId_, purchase);
        assertGt(reviewDeadline, block.timestamp);
        assertEq(status, uint8(AgentVouchTypes.PaidPurchaseReportStatus.Pending));
        assertEq(outcome, uint8(AgentVouchTypes.PaidPurchaseReportOutcome.None));
        assertEq(av.getPaidPurchaseReportEvidence(reportId), "ipfs://evidence");

        vm.prank(BUYER);
        vm.expectRevert(AgentVouchEvm.PaidPurchaseReceiptConsumed.selector);
        av.openPaidPurchaseReport(AUTHOR, listing, purchase, "ipfs://again");
    }

    function test_pendingLocksCollateralButAllowsPurchases() public {
        _open();
        vm.prank(VOUCHER);
        vm.expectRevert(AgentVouchEvm.DisputeLocked.selector);
        av.vouch(AUTHOR, 1_000_000);

        vm.prank(BUYER_TWO);
        av.purchaseSkill(listing);
    }

    function test_rejectRoutesBondToReserveAndStartsBuyerCooldown() public {
        uint64 reportId = _open();
        vm.prank(ADMIN);
        av.reviewPaidPurchaseReport(reportId, false);

        uint256 beforeReserve = usdc.balanceOf(RESERVE);
        vm.prank(RESERVE);
        av.claimRestitutionReserve();
        assertEq(usdc.balanceOf(RESERVE) - beforeReserve, BOND);
    }

    function test_resolverRoleCanBeHandedOffWithoutLeavingOldResolverAuthority() public {
        uint64 reportId = _open();
        vm.prank(BUYER);
        vm.expectRevert();
        av.reviewPaidPurchaseReport(reportId, true);

        vm.startPrank(ADMIN);
        av.grantRole(av.RESOLVER_ROLE(), RESOLVER_TWO);
        av.revokeRole(av.RESOLVER_ROLE(), ADMIN);
        vm.expectRevert();
        av.reviewPaidPurchaseReport(reportId, true);
        vm.stopPrank();

        vm.prank(RESOLVER_TWO);
        av.reviewPaidPurchaseReport(reportId, true);
        (,,,,,, uint64 acceptedAt,, uint8 status,) = av.getPaidPurchaseReportCore(reportId);
        assertGt(acceptedAt, 0);
        assertEq(status, uint8(AgentVouchTypes.PaidPurchaseReportStatus.Accepted));
    }

    function test_expiryFundsBuyerPullAtReviewDeadline() public {
        uint64 reportId = _open();
        (,,,,, uint64 deadline,,,,) = av.getPaidPurchaseReportCore(reportId);
        vm.warp(deadline);
        av.closePaidPurchaseReportCredit(reportId);

        uint256 beforeBuyer = usdc.balanceOf(BUYER);
        vm.prank(BUYER);
        av.claimPaidPurchaseReportCredit(reportId);
        assertEq(usdc.balanceOf(BUYER) - beforeBuyer, BOND);
    }

    function test_acceptBlocksAuthorPurchasesAndDismissReleases() public {
        uint64 reportId = _open();
        vm.prank(ADMIN);
        av.reviewPaidPurchaseReport(reportId, true);

        vm.prank(BUYER_TWO);
        vm.expectRevert(AgentVouchEvm.DisputeLocked.selector);
        av.purchaseSkill(listing);

        vm.prank(ADMIN);
        av.resolvePaidPurchaseReport(reportId, uint8(AgentVouchTypes.PaidPurchaseReportRuling.Dismissed));
        vm.prank(BUYER_TWO);
        av.purchaseSkill(listing);
    }

    function test_upholdSlashesBondAndVouchThenBuyerClaims() public {
        vm.startPrank(AUTHOR);
        av.depositAuthorBond(10_000_000);
        vm.stopPrank();
        vm.prank(VOUCHER);
        av.vouch(AUTHOR, 4_000_000);

        uint64 reportId = _open();
        vm.prank(ADMIN);
        av.reviewPaidPurchaseReport(reportId, true);
        vm.prank(ADMIN);
        av.resolvePaidPurchaseReport(reportId, uint8(AgentVouchTypes.PaidPurchaseReportRuling.Upheld));

        address[] memory page = new address[](1);
        page[0] = VOUCHER;
        av.slashPaidPurchaseReportVouches(reportId, page);
        (
            ,
            uint256 snapshottedStake,
            uint256 processedStake,
            uint256 authorBondSlash,
            uint256 voucherSlash,
            uint256 entitlement,
            uint256 credit,,
        ) = av.getPaidPurchaseReportSettlement(reportId);
        assertEq(snapshottedStake, 4_000_000);
        assertEq(processedStake, 4_000_000);
        assertEq(authorBondSlash, 5_000_000);
        assertEq(voucherSlash, 2_000_000);
        assertEq(entitlement, 7_000_000);
        assertEq(credit, BOND + 7_000_000);

        uint256 beforeBuyer = usdc.balanceOf(BUYER);
        vm.prank(BUYER);
        av.claimPaidPurchaseReportCredit(reportId);
        assertEq(usdc.balanceOf(BUYER) - beforeBuyer, BOND + 7_000_000);

        uint256 beforeVoucher = usdc.balanceOf(VOUCHER);
        vm.prank(VOUCHER);
        av.revokeVouch(AUTHOR);
        assertEq(usdc.balanceOf(VOUCHER) - beforeVoucher, 2_000_000);
    }

    function test_invalidRulingAndSettlementLaneReceiptRevert() public {
        vm.prank(AUTHOR);
        bytes32 secondListing = av.createSkillListing(keccak256("settlement"), "u", "n", "d", PRICE);
        bytes32 paymentRef = keccak256("payment");
        bytes32 settlementTx = keccak256("tx");
        vm.prank(ADMIN);
        bytes32 laneCPurchase = av.settleX402Purchase(secondListing, BUYER_TWO, PRICE, paymentRef, settlementTx);

        uint64 reportId = _open();
        vm.prank(ADMIN);
        av.reviewPaidPurchaseReport(reportId, true);
        vm.prank(ADMIN);
        vm.expectRevert(AgentVouchEvm.PaidPurchaseReportInvalidState.selector);
        av.resolvePaidPurchaseReport(reportId, 0);

        vm.prank(BUYER_TWO);
        vm.expectRevert(AgentVouchEvm.PurchaseLaneIneligible.selector);
        av.openPaidPurchaseReport(AUTHOR, secondListing, laneCPurchase, "evidence");
    }
}
