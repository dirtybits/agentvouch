// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgentVouchEvm} from "../src/AgentVouchEvm.sol";
import {AgentVouchTypes} from "../src/libraries/AgentVouchTypes.sol";
import {PaidPurchaseSettlement} from "../src/libraries/PaidPurchaseSettlement.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract PaidPurchaseAdversarialTest is Test {
    uint256 internal constant PRICE = 10_000_000;
    uint256 internal constant BOND = 5_000_000;
    address internal constant ADMIN = address(0xA11CE);
    address internal constant AUTHOR = address(0xA0);
    address internal constant AUTHOR_TWO = address(0xA2);
    address internal constant BUYER = address(0xB0);
    address internal constant BUYER_TWO = address(0xB2);
    address internal constant VOUCHER_ONE = address(0xC1);
    address internal constant VOUCHER_TWO = address(0xC2);
    address internal constant RESERVE = address(0xD00D);

    MockUSDC internal usdc;
    AgentVouchEvm internal av;
    bytes32 internal listing;
    bytes32 internal purchase;

    function setUp() public {
        vm.chainId(84532);
        usdc = new MockUSDC();
        av = new AgentVouchEvmA1Harness(address(usdc), ADMIN);
        vm.prank(ADMIN);
        av.initializeConfig(_cfg());

        _seed(AUTHOR);
        _seed(AUTHOR_TWO);
        _seed(BUYER);
        _seed(BUYER_TWO);
        _seed(VOUCHER_ONE);
        _seed(VOUCHER_TWO);
        listing = _createListing(AUTHOR, "primary");
        purchase = _purchase(BUYER, listing);
    }

    function test_filingWindowIsInclusiveAndOneSecondLaterIsStale() public {
        vm.warp(block.timestamp + 7 days);
        uint64 reportId = _open(BUYER, AUTHOR, listing, purchase, new string(256));
        assertEq(reportId, 1);
    }

    function test_filingAfterWindowReverts() public {
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(BUYER);
        vm.expectRevert(AgentVouchEvm.PaidPurchaseReceiptIneligible.selector);
        av.openPaidPurchaseReport(AUTHOR, listing, purchase, "evidence");
    }

    function test_evidenceBoundsFailBeforeBondPull() public {
        uint256 beforeBalance = usdc.balanceOf(BUYER);
        vm.startPrank(BUYER);
        vm.expectRevert(AgentVouchEvm.PaidPurchaseReceiptIneligible.selector);
        av.openPaidPurchaseReport(AUTHOR, listing, purchase, "");
        vm.expectRevert(AgentVouchEvm.PaidPurchaseEvidenceTooLong.selector);
        av.openPaidPurchaseReport(AUTHOR, listing, purchase, new string(257));
        vm.stopPrank();
        assertEq(usdc.balanceOf(BUYER), beforeBalance);
    }

    function test_removedListingHistoricalReceiptRemainsEligible() public {
        vm.prank(AUTHOR);
        av.removeSkillListing(listing);
        uint64 reportId = _open(BUYER, AUTHOR, listing, purchase, "evidence");
        (address buyer, address author,,,,,,,,) = av.getPaidPurchaseReportCore(reportId);
        assertEq(buyer, BUYER);
        assertEq(author, AUTHOR);
    }

    function test_wrongBuyerAndWrongAuthorRevert() public {
        vm.prank(BUYER_TWO);
        vm.expectRevert(AgentVouchEvm.PaidPurchaseReceiptIneligible.selector);
        av.openPaidPurchaseReport(AUTHOR, listing, purchase, "evidence");

        vm.prank(BUYER);
        vm.expectRevert(AgentVouchEvm.PaidPurchaseReceiptIneligible.selector);
        av.openPaidPurchaseReport(AUTHOR_TWO, listing, purchase, "evidence");
    }

    function test_activeBuyerListingAndAuthorSlotsEachRejectConcurrency() public {
        bytes32 buyerTwoPrimaryPurchase = _purchase(BUYER_TWO, listing);
        bytes32 secondAuthorListing = _createListing(AUTHOR, "same-author-second-listing");
        bytes32 buyerTwoSecondPurchase = _purchase(BUYER_TWO, secondAuthorListing);
        bytes32 otherAuthorListing = _createListing(AUTHOR_TWO, "other-author");
        bytes32 buyerOtherAuthorPurchase = _purchase(BUYER, otherAuthorListing);
        _open(BUYER, AUTHOR, listing, purchase, "evidence");

        vm.prank(BUYER_TWO);
        vm.expectRevert(AgentVouchEvm.PaidPurchaseListingBusy.selector);
        av.openPaidPurchaseReport(AUTHOR, listing, buyerTwoPrimaryPurchase, "listing busy");

        vm.prank(BUYER_TWO);
        vm.expectRevert(AgentVouchEvm.PaidPurchaseAuthorBusy.selector);
        av.openPaidPurchaseReport(AUTHOR, secondAuthorListing, buyerTwoSecondPurchase, "author busy");

        vm.prank(BUYER);
        vm.expectRevert(AgentVouchEvm.PaidPurchaseBuyerBusy.selector);
        av.openPaidPurchaseReport(AUTHOR_TWO, otherAuthorListing, buyerOtherAuthorPurchase, "buyer busy");
    }

    function test_reviewDeadlineClosesBothResolverBranchesAndEnablesExpiry() public {
        uint64 reportId = _open(BUYER, AUTHOR, listing, purchase, "evidence");
        (,,,,, uint64 reviewDeadline,,,,) = av.getPaidPurchaseReportCore(reportId);
        vm.warp(reviewDeadline);

        vm.startPrank(ADMIN);
        vm.expectRevert(AgentVouchEvm.PaidPurchaseReviewExpired.selector);
        av.reviewPaidPurchaseReport(reportId, true);
        vm.expectRevert(AgentVouchEvm.PaidPurchaseReviewExpired.selector);
        av.reviewPaidPurchaseReport(reportId, false);
        vm.stopPrank();

        av.closePaidPurchaseReportCredit(reportId);
        (,,,,,,,, uint8 status, uint8 outcome) = av.getPaidPurchaseReportCore(reportId);
        assertEq(status, uint8(AgentVouchTypes.PaidPurchaseReportStatus.Terminal));
        assertEq(outcome, uint8(AgentVouchTypes.PaidPurchaseReportOutcome.Expired));
    }

    function test_claimBoundaryAndPermissionlessReserveConversion() public {
        uint64 reportId = _expirePending();
        (,,,,,,, uint64 claimDeadline,) = av.getPaidPurchaseReportSettlement(reportId);
        vm.warp(claimDeadline);

        vm.prank(BUYER);
        vm.expectRevert(AgentVouchEvm.PaidPurchaseCreditExpired.selector);
        av.claimPaidPurchaseReportCredit(reportId);

        vm.prank(BUYER_TWO);
        av.closePaidPurchaseReportCredit(reportId);
        uint256 beforeReserve = usdc.balanceOf(RESERVE);
        vm.prank(RESERVE);
        av.claimRestitutionReserve();
        assertEq(usdc.balanceOf(RESERVE) - beforeReserve, BOND);
    }

    function test_buyerCreditAndReserveAreEachSingleUse() public {
        uint64 reportId = _expirePending();
        vm.prank(BUYER);
        av.claimPaidPurchaseReportCredit(reportId);
        vm.prank(BUYER);
        vm.expectRevert(AgentVouchEvm.PaidPurchaseCreditAlreadyHandled.selector);
        av.claimPaidPurchaseReportCredit(reportId);

        bytes32 secondListing = _createListing(AUTHOR_TWO, "reserve-single-use");
        bytes32 secondPurchase = _purchase(BUYER_TWO, secondListing);
        uint64 secondReport = _open(BUYER_TWO, AUTHOR_TWO, secondListing, secondPurchase, "evidence");
        vm.prank(ADMIN);
        av.reviewPaidPurchaseReport(secondReport, false);
        vm.prank(RESERVE);
        av.claimRestitutionReserve();
        vm.prank(RESERVE);
        vm.expectRevert(AgentVouchEvm.PaidPurchaseCreditNotFunded.selector);
        av.claimRestitutionReserve();
    }

    function test_buyerCooldownIsGlobalAndReleasesExactly() public {
        bytes32 secondListing = _createListing(AUTHOR_TWO, "second-author");
        bytes32 secondPurchase = _purchase(BUYER, secondListing);
        uint64 reportId = _open(BUYER, AUTHOR, listing, purchase, "evidence");
        vm.prank(ADMIN);
        av.reviewPaidPurchaseReport(reportId, false);

        vm.warp(block.timestamp + 7 days - 1);
        vm.prank(BUYER);
        vm.expectRevert(AgentVouchEvm.PaidPurchaseBuyerCooldown.selector);
        av.openPaidPurchaseReport(AUTHOR_TWO, secondListing, secondPurchase, "evidence");

        vm.warp(block.timestamp + 1);
        _open(BUYER, AUTHOR_TWO, secondListing, secondPurchase, "evidence");
    }

    function test_authorCooldownReleasesExactlyForFreshReceipt() public {
        _expirePending();
        vm.warp(block.timestamp + 7 days - 1);
        bytes32 secondListing = _createListing(AUTHOR, "second-listing");
        bytes32 secondPurchase = _purchase(BUYER_TWO, secondListing);

        vm.prank(BUYER_TWO);
        vm.expectRevert(AgentVouchEvm.PaidPurchaseAuthorCooldown.selector);
        av.openPaidPurchaseReport(AUTHOR, secondListing, secondPurchase, "evidence");

        vm.warp(block.timestamp + 1);
        _open(BUYER_TWO, AUTHOR, secondListing, secondPurchase, "evidence");
    }

    function test_pauseBlocksFilingAndAcceptanceButNotTerminalPaths() public {
        uint64 reportId = _open(BUYER, AUTHOR, listing, purchase, "evidence");
        vm.prank(ADMIN);
        av.setPaused(true);

        vm.prank(ADMIN);
        vm.expectRevert();
        av.reviewPaidPurchaseReport(reportId, true);

        vm.prank(ADMIN);
        av.reviewPaidPurchaseReport(reportId, false);
        vm.prank(RESERVE);
        av.claimRestitutionReserve();
    }

    function test_upholdAndClaimsRemainLiveWhilePaused() public {
        vm.prank(AUTHOR);
        av.depositAuthorBond(10_000_000);
        uint64 reportId = _open(BUYER, AUTHOR, listing, purchase, "evidence");
        vm.prank(ADMIN);
        av.reviewPaidPurchaseReport(reportId, true);
        vm.prank(ADMIN);
        av.setPaused(true);

        vm.prank(ADMIN);
        av.resolvePaidPurchaseReport(reportId, uint8(AgentVouchTypes.PaidPurchaseReportRuling.Upheld));
        vm.prank(BUYER);
        av.claimPaidPurchaseReportCredit(reportId);
    }

    function test_successorDeploymentCannotReplayReceiptAndOldCreditRemainsClaimable() public {
        uint64 reportId = _expirePending();
        AgentVouchEvm successor = new AgentVouchEvm(address(usdc), ADMIN);
        vm.prank(ADMIN);
        successor.initializeConfig(_cfg());
        vm.prank(AUTHOR);
        successor.registerAgent("ipfs://author-v2");
        vm.startPrank(BUYER);
        successor.registerAgent("ipfs://buyer-v2");
        usdc.approve(address(successor), type(uint256).max);
        vm.expectRevert(AgentVouchEvm.PaidPurchaseReceiptIneligible.selector);
        successor.openPaidPurchaseReport(AUTHOR, listing, purchase, "replay");
        vm.expectRevert(AgentVouchEvm.PaidPurchaseReportNotFound.selector);
        successor.claimPaidPurchaseReportCredit(reportId);
        vm.stopPrank();

        uint256 beforeBuyer = usdc.balanceOf(BUYER);
        vm.prank(BUYER);
        av.claimPaidPurchaseReportCredit(reportId);
        assertEq(usdc.balanceOf(BUYER) - beforeBuyer, BOND);
    }

    function test_postFilingBondDepositIsIncludedInUpholdSlash() public {
        vm.prank(AUTHOR);
        av.depositAuthorBond(2_000_000);
        uint64 reportId = _open(BUYER, AUTHOR, listing, purchase, "evidence");
        vm.prank(AUTHOR);
        av.depositAuthorBond(8_000_000);
        _acceptAndUphold(reportId);

        (,,, uint256 authorBondSlash,,,,,) = av.getPaidPurchaseReportSettlement(reportId);
        assertEq(authorBondSlash, 5_000_000);
    }

    function test_multiPageSlashIsDuplicateSafeAndCompletesExactly() public {
        vm.prank(VOUCHER_ONE);
        av.vouch(AUTHOR, 4_000_000);
        vm.prank(VOUCHER_TWO);
        av.vouch(AUTHOR, 6_000_000);
        uint64 reportId = _open(BUYER, AUTHOR, listing, purchase, "evidence");
        _acceptAndUphold(reportId);

        address[] memory firstPage = new address[](3);
        firstPage[0] = VOUCHER_ONE;
        firstPage[1] = VOUCHER_ONE;
        firstPage[2] = address(0xDEAD);
        av.slashPaidPurchaseReportVouches(reportId, firstPage);
        (, uint256 snapshot, uint256 processed,,,,,,) = av.getPaidPurchaseReportSettlement(reportId);
        assertEq(snapshot, 10_000_000);
        assertEq(processed, 4_000_000);

        address[] memory secondPage = new address[](1);
        secondPage[0] = VOUCHER_TWO;
        av.slashPaidPurchaseReportVouches(reportId, secondPage);
        (,, processed,,,,,,) = av.getPaidPurchaseReportSettlement(reportId);
        assertEq(processed, snapshot);
        (,,,,,,,, uint8 status, uint8 outcome) = av.getPaidPurchaseReportCore(reportId);
        assertEq(status, uint8(AgentVouchTypes.PaidPurchaseReportStatus.Terminal));
        assertEq(outcome, uint8(AgentVouchTypes.PaidPurchaseReportOutcome.Upheld));
    }

    function test_slashPageMaximumIsEnforced() public {
        vm.prank(VOUCHER_ONE);
        av.vouch(AUTHOR, 4_000_000);
        uint64 reportId = _open(BUYER, AUTHOR, listing, purchase, "evidence");
        _acceptAndUphold(reportId);
        address[] memory oversized = new address[](33);
        vm.expectRevert(AgentVouchEvm.PaidPurchaseSlashPageTooLarge.selector);
        av.slashPaidPurchaseReportVouches(reportId, oversized);
    }

    function test_maximumSlashPageStaysBelowTenMillionGas() public {
        address[] memory page = new address[](32);
        for (uint256 i; i < page.length; ++i) {
            address voucher = address(uint160(0x1000 + i));
            page[i] = voucher;
            _seed(voucher);
            vm.prank(voucher);
            av.vouch(AUTHOR, 1_000_000);
        }

        uint64 reportId = _open(BUYER, AUTHOR, listing, purchase, "evidence");
        _acceptAndUphold(reportId);
        uint256 gasBefore = gasleft();
        av.slashPaidPurchaseReportVouches(reportId, page);
        uint256 gasUsed = gasBefore - gasleft();

        assertLt(gasUsed, 10_000_000, "32-voucher crank exceeds local gas budget");
        (,,,,,,,, uint8 status,) = av.getPaidPurchaseReportCore(reportId);
        assertEq(status, uint8(AgentVouchTypes.PaidPurchaseReportStatus.Terminal));
    }

    function test_rawMutatingCallToLinkedLibraryFails() public {
        // External library functions receive storage-slot references as words.
        // Solidity's library guard must reject CALL even with otherwise valid calldata;
        // only the facade's compiler-emitted DELEGATECALL path may mutate its storage.
        (bool ok,) = address(PaidPurchaseSettlement).call(abi.encodePacked(bytes4(0xee90f5f0), bytes32(0)));
        assertFalse(ok);
    }

    function test_roundingResidueMovesToAuthorProceedsAfterFinalVouchExit() public {
        vm.prank(VOUCHER_ONE);
        av.vouch(AUTHOR, 1_000_001);
        vm.prank(VOUCHER_TWO);
        av.vouch(AUTHOR, 1_000_001);

        bytes32 secondListing = _createListing(AUTHOR, "rounding");
        bytes32 secondPurchase = _purchase(BUYER_TWO, secondListing);
        AgentVouchTypes.Purchase memory receipt = av.getPurchase(secondPurchase);
        assertEq(receipt.authorShareUsdcMicros, 6_000_001);
        assertEq(receipt.voucherPoolUsdcMicros, 3_999_999);

        uint256 paidOne = usdc.balanceOf(VOUCHER_ONE);
        uint256 paidTwo = usdc.balanceOf(VOUCHER_TWO);
        vm.prank(VOUCHER_ONE);
        av.claimVoucherRevenue(AUTHOR);
        vm.prank(VOUCHER_TWO);
        av.claimVoucherRevenue(AUTHOR);
        paidOne = usdc.balanceOf(VOUCHER_ONE) - paidOne;
        paidTwo = usdc.balanceOf(VOUCHER_TWO) - paidTwo;
        assertEq(paidOne + paidTwo, 3_999_998);

        vm.prank(VOUCHER_ONE);
        av.revokeVouch(AUTHOR);
        vm.prank(VOUCHER_TWO);
        av.revokeVouch(AUTHOR);

        uint256 beforeAuthor = usdc.balanceOf(AUTHOR);
        vm.prank(AUTHOR);
        av.withdrawAuthorProceeds(secondListing, 1, 6_000_002);
        assertEq(usdc.balanceOf(AUTHOR) - beforeAuthor, 6_000_002);
        assertEq(paidOne + paidTwo + 6_000_002, PRICE);
    }

    function test_slashPathAlsoMovesFinalRoundingResidueToAuthorProceeds() public {
        vm.prank(VOUCHER_ONE);
        av.vouch(AUTHOR, 1_000_001);
        vm.prank(VOUCHER_TWO);
        av.vouch(AUTHOR, 1_000_001);
        bytes32 secondListing = _createListing(AUTHOR, "slash-rounding");
        bytes32 secondPurchase = _purchase(BUYER_TWO, secondListing);
        uint64 reportId = _open(BUYER_TWO, AUTHOR, secondListing, secondPurchase, "evidence");
        _acceptAndUphold(reportId);

        address[] memory page = new address[](2);
        page[0] = VOUCHER_ONE;
        page[1] = VOUCHER_TWO;
        av.slashPaidPurchaseReportVouches(reportId, page);

        uint256 beforeAuthor = usdc.balanceOf(AUTHOR);
        vm.prank(AUTHOR);
        av.withdrawAuthorProceeds(secondListing, 1, 6_000_002);
        assertEq(usdc.balanceOf(AUTHOR) - beforeAuthor, 6_000_002);
    }

    function testFuzz_slashClaimAndResidualExitOrderingConservesEveryMicro(
        uint96 stakeOneSeed,
        uint96 stakeTwoSeed,
        uint96 priceSeed,
        bool reverseSlashOrder,
        bool claimOneBeforeSlash,
        bool claimTwoBeforeSlash
    ) public {
        uint256 stakeOne = bound(uint256(stakeOneSeed), 1_000_000, 200_000_000);
        uint256 stakeTwo = bound(uint256(stakeTwoSeed), 1_000_000, 200_000_000);
        uint256 price = bound(uint256(priceSeed), 1_000_000, 400_000_000);

        vm.prank(VOUCHER_ONE);
        av.vouch(AUTHOR, stakeOne);
        vm.prank(VOUCHER_TWO);
        av.vouch(AUTHOR, stakeTwo);

        bytes32 fuzzListing;
        vm.prank(AUTHOR);
        fuzzListing = av.createSkillListing(
            keccak256(abi.encode(stakeOne, stakeTwo, price)), "ipfs://fuzz", "fuzz", "desc", price
        );
        bytes32 fuzzPurchase = _purchase(BUYER_TWO, fuzzListing);

        if (claimOneBeforeSlash) {
            vm.prank(VOUCHER_ONE);
            av.claimVoucherRevenue(AUTHOR);
        }
        if (claimTwoBeforeSlash) {
            vm.prank(VOUCHER_TWO);
            av.claimVoucherRevenue(AUTHOR);
        }

        uint64 reportId = _open(BUYER_TWO, AUTHOR, fuzzListing, fuzzPurchase, "evidence");
        _acceptAndUphold(reportId);

        address[] memory page = new address[](2);
        page[0] = reverseSlashOrder ? VOUCHER_TWO : VOUCHER_ONE;
        page[1] = reverseSlashOrder ? VOUCHER_ONE : VOUCHER_TWO;
        av.slashPaidPurchaseReportVouches(reportId, page);

        if (!claimOneBeforeSlash) {
            vm.prank(VOUCHER_ONE);
            av.claimVoucherRevenue(AUTHOR);
        }
        if (!claimTwoBeforeSlash) {
            vm.prank(VOUCHER_TWO);
            av.claimVoucherRevenue(AUTHOR);
        }

        vm.prank(VOUCHER_ONE);
        av.revokeVouch(AUTHOR);
        vm.prank(VOUCHER_TWO);
        av.revokeVouch(AUTHOR);
        vm.prank(BUYER_TWO);
        av.claimPaidPurchaseReportCredit(reportId);

        uint256 reserveCredit = AgentVouchEvmA1Harness(address(av)).exposedRestitutionReserveCredit();
        if (reserveCredit > 0) {
            vm.prank(RESERVE);
            av.claimRestitutionReserve();
        }

        uint256 initialProceeds = av.getSettlement(listing, 1).authorProceedsUsdcMicros;
        uint256 fuzzProceeds = av.getSettlement(fuzzListing, 1).authorProceedsUsdcMicros;
        uint256 roundingProceeds = AgentVouchEvmA1Harness(address(av)).exposedRoundingAuthorProceeds(AUTHOR);
        vm.startPrank(AUTHOR);
        av.withdrawAuthorProceeds(listing, 1, initialProceeds);
        av.withdrawAuthorProceeds(fuzzListing, 1, fuzzProceeds + roundingProceeds);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(av)), 0, "all funded micros must have exactly one owner");
    }

    function _expirePending() internal returns (uint64 reportId) {
        reportId = _open(BUYER, AUTHOR, listing, purchase, "evidence");
        (,,,,, uint64 reviewDeadline,,,,) = av.getPaidPurchaseReportCore(reportId);
        vm.warp(reviewDeadline);
        av.closePaidPurchaseReportCredit(reportId);
    }

    function _acceptAndUphold(uint64 reportId) internal {
        vm.startPrank(ADMIN);
        av.reviewPaidPurchaseReport(reportId, true);
        av.resolvePaidPurchaseReport(reportId, uint8(AgentVouchTypes.PaidPurchaseReportRuling.Upheld));
        vm.stopPrank();
    }

    function _open(address buyer, address author, bytes32 listingId_, bytes32 purchaseId_, string memory evidence)
        internal
        returns (uint64 reportId)
    {
        vm.prank(buyer);
        reportId = av.openPaidPurchaseReport(author, listingId_, purchaseId_, evidence);
    }

    function _createListing(address author, string memory salt) internal returns (bytes32 listingId_) {
        vm.prank(author);
        listingId_ = av.createSkillListing(keccak256(bytes(salt)), "ipfs://skill", salt, "desc", PRICE);
    }

    function _purchase(address buyer, bytes32 listingId_) internal returns (bytes32 purchaseId_) {
        vm.prank(buyer);
        purchaseId_ = av.purchaseSkill(listingId_);
    }

    function _seed(address who) internal {
        usdc.mint(who, 1_000_000_000);
        vm.startPrank(who);
        usdc.approve(address(av), type(uint256).max);
        av.registerAgent("ipfs://agent");
        vm.stopPrank();
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
}

contract AgentVouchEvmA1Harness is AgentVouchEvm {
    constructor(address usdc_, address admin_) AgentVouchEvm(usdc_, admin_) {}

    function exposedRestitutionReserveCredit() external view returns (uint256) {
        return paidPurchaseState.restitutionReserveCreditUsdcMicros;
    }

    function exposedRoundingAuthorProceeds(address author) external view returns (uint256) {
        return voucherRevenueRoundingAuthorProceedsUsdcMicros[author];
    }
}
