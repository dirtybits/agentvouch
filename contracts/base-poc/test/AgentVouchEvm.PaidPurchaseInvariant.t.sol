// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {AgentVouchEvm} from "../src/AgentVouchEvm.sol";
import {AgentVouchTypes} from "../src/libraries/AgentVouchTypes.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract PaidPurchaseInvariantHarness is AgentVouchEvm {
    constructor(address usdc_, address admin_) AgentVouchEvm(usdc_, admin_) {}

    function exposedPendingDistribution(address author) external view returns (uint256) {
        return voucherRevenuePendingDistributionUsdcMicros[author];
    }

    function exposedRoundingAuthorProceeds(address author) external view returns (uint256) {
        return voucherRevenueRoundingAuthorProceedsUsdcMicros[author];
    }

    function exposedRestitutionReserveCredit() external view returns (uint256) {
        return paidPurchaseState.restitutionReserveCreditUsdcMicros;
    }

    function exposedReportBond(uint64 reportId) external view returns (uint256) {
        return paidPurchaseState.reports[reportId].bondUsdcMicros;
    }
}

contract PaidPurchaseInvariantHandler is Test {
    address internal constant ADMIN = address(0xA11CE);
    address internal constant AUTHOR = address(0xA0);
    address internal constant BUYER = address(0xB0);
    address internal constant VOUCHER_ONE = address(0xC1);
    address internal constant VOUCHER_TWO = address(0xC2);
    address internal constant RESERVE = address(0xD00D);

    PaidPurchaseInvariantHarness internal immutable av;
    bytes32 internal immutable listing;
    bytes32 internal immutable purchase;
    uint64 public reportId;

    constructor(PaidPurchaseInvariantHarness av_, bytes32 listing_, bytes32 purchase_) {
        av = av_;
        listing = listing_;
        purchase = purchase_;
    }

    function openReport() external {
        if (reportId != 0 || av.paused()) return;
        vm.prank(BUYER);
        reportId = av.openPaidPurchaseReport(AUTHOR, listing, purchase, "ipfs://evidence");
    }

    function acceptReport() external {
        if (reportId == 0 || av.paused()) return;
        (,,,,,,,, uint8 status,) = av.getPaidPurchaseReportCore(reportId);
        if (status != uint8(AgentVouchTypes.PaidPurchaseReportStatus.Pending)) return;
        vm.prank(ADMIN);
        av.reviewPaidPurchaseReport(reportId, true);
    }

    function rejectOrDismissReport() external {
        if (reportId == 0) return;
        (,,,,,,,, uint8 status,) = av.getPaidPurchaseReportCore(reportId);
        vm.prank(ADMIN);
        if (status == uint8(AgentVouchTypes.PaidPurchaseReportStatus.Pending)) {
            av.reviewPaidPurchaseReport(reportId, false);
        } else if (status == uint8(AgentVouchTypes.PaidPurchaseReportStatus.Accepted)) {
            av.resolvePaidPurchaseReport(reportId, uint8(AgentVouchTypes.PaidPurchaseReportRuling.Dismissed));
        }
    }

    function upholdReport() external {
        if (reportId == 0) return;
        (,,,,,,,, uint8 status,) = av.getPaidPurchaseReportCore(reportId);
        if (status != uint8(AgentVouchTypes.PaidPurchaseReportStatus.Accepted)) return;
        vm.prank(ADMIN);
        av.resolvePaidPurchaseReport(reportId, uint8(AgentVouchTypes.PaidPurchaseReportRuling.Upheld));
    }

    function slashOneVoucher(bool second) external {
        if (reportId == 0) return;
        (,,,,,,,, uint8 status,) = av.getPaidPurchaseReportCore(reportId);
        if (status != uint8(AgentVouchTypes.PaidPurchaseReportStatus.SlashingVouchers)) return;
        address[] memory page = new address[](1);
        page[0] = second ? VOUCHER_TWO : VOUCHER_ONE;
        av.slashPaidPurchaseReportVouches(reportId, page);
    }

    function claimVoucherRevenue(bool second) external {
        address voucher = second ? VOUCHER_TWO : VOUCHER_ONE;
        vm.prank(voucher);
        try av.claimVoucherRevenue(AUTHOR) {} catch {}
    }

    function revokeVouch(bool second) external {
        address voucher = second ? VOUCHER_TWO : VOUCHER_ONE;
        vm.prank(voucher);
        try av.revokeVouch(AUTHOR) {} catch {}
    }

    function claimBuyerCredit() external {
        if (reportId == 0) return;
        vm.prank(BUYER);
        try av.claimPaidPurchaseReportCredit(reportId) {} catch {}
    }

    function expireReportOrCredit() external {
        if (reportId == 0) return;
        (,,,,, uint64 reviewDeadline,,, uint8 status,) = av.getPaidPurchaseReportCore(reportId);
        if (status == uint8(AgentVouchTypes.PaidPurchaseReportStatus.Pending)) {
            vm.warp(reviewDeadline);
            av.closePaidPurchaseReportCredit(reportId);
            return;
        }
        if (status != uint8(AgentVouchTypes.PaidPurchaseReportStatus.Terminal)) return;
        (,,,,,,, uint64 claimDeadline, bool handled) = av.getPaidPurchaseReportSettlement(reportId);
        if (handled || claimDeadline == 0) return;
        vm.warp(claimDeadline);
        av.closePaidPurchaseReportCredit(reportId);
    }

    function claimReserve() external {
        vm.prank(RESERVE);
        try av.claimRestitutionReserve() {} catch {}
    }

    function withdrawProceeds(uint96 amountSeed) external {
        if (av.paused()) return;
        uint256 listingProceeds = av.getSettlement(listing, 1).authorProceedsUsdcMicros;
        uint256 roundingProceeds = av.exposedRoundingAuthorProceeds(AUTHOR);
        uint256 available = listingProceeds + roundingProceeds;
        if (available == 0) return;
        uint256 amount = bound(uint256(amountSeed), 1, available);
        vm.prank(AUTHOR);
        av.withdrawAuthorProceeds(listing, 1, amount);
    }

    function togglePause() external {
        bool nextPaused = !av.paused();
        vm.prank(ADMIN);
        av.setPaused(nextPaused);
    }
}

contract PaidPurchaseAccountingInvariantTest is StdInvariant, Test {
    address internal constant ADMIN = address(0xA11CE);
    address internal constant AUTHOR = address(0xA0);
    address internal constant BUYER = address(0xB0);
    address internal constant VOUCHER_ONE = address(0xC1);
    address internal constant VOUCHER_TWO = address(0xC2);
    address internal constant RESERVE = address(0xD00D);

    MockUSDC internal usdc;
    PaidPurchaseInvariantHarness internal av;
    PaidPurchaseInvariantHandler internal handler;
    bytes32 internal listing;

    function setUp() public {
        vm.chainId(84532);
        usdc = new MockUSDC();
        av = new PaidPurchaseInvariantHarness(address(usdc), ADMIN);
        vm.prank(ADMIN);
        av.initializeConfig(_cfg());

        _seed(AUTHOR);
        _seed(BUYER);
        _seed(VOUCHER_ONE);
        _seed(VOUCHER_TWO);

        vm.prank(AUTHOR);
        av.depositAuthorBond(20_000_000);
        vm.prank(VOUCHER_ONE);
        av.vouch(AUTHOR, 3_000_001);
        vm.prank(VOUCHER_TWO);
        av.vouch(AUTHOR, 7_000_003);
        vm.prank(AUTHOR);
        listing = av.createSkillListing(keccak256("invariant"), "ipfs://skill", "invariant", "desc", 10_000_003);
        vm.prank(BUYER);
        bytes32 purchase = av.purchaseSkill(listing);

        handler = new PaidPurchaseInvariantHandler(av, listing, purchase);
        bytes4[] memory selectors = new bytes4[](12);
        selectors[0] = handler.openReport.selector;
        selectors[1] = handler.acceptReport.selector;
        selectors[2] = handler.rejectOrDismissReport.selector;
        selectors[3] = handler.upholdReport.selector;
        selectors[4] = handler.slashOneVoucher.selector;
        selectors[5] = handler.claimVoucherRevenue.selector;
        selectors[6] = handler.revokeVouch.selector;
        selectors[7] = handler.claimBuyerCredit.selector;
        selectors[8] = handler.expireReportOrCredit.selector;
        selectors[9] = handler.claimReserve.selector;
        selectors[10] = handler.withdrawProceeds.selector;
        selectors[11] = handler.togglePause.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_contractBalanceEqualsAllKnownLiabilities() public view {
        AgentVouchTypes.AgentProfile memory profile = av.getProfile(AUTHOR);
        AgentVouchTypes.Vouch memory firstVouch = av.getVouch(VOUCHER_ONE, AUTHOR);
        AgentVouchTypes.Vouch memory secondVouch = av.getVouch(VOUCHER_TWO, AUTHOR);
        AgentVouchTypes.ListingSettlement memory settlement = av.getSettlement(listing, 1);

        uint256 liabilities = profile.authorBondUsdcMicros + profile.unclaimedVoucherRevenueUsdcMicros
            + firstVouch.stakeUsdcMicros + secondVouch.stakeUsdcMicros + settlement.authorProceedsUsdcMicros
            + av.exposedPendingDistribution(AUTHOR) + av.exposedRoundingAuthorProceeds(AUTHOR)
            + av.exposedRestitutionReserveCredit();

        uint64 reportId = handler.reportId();
        if (reportId != 0) {
            (,,,,,,,, uint8 status,) = av.getPaidPurchaseReportCore(reportId);
            (,,, uint256 authorBondSlash, uint256 voucherSlash,, uint256 buyerCredit,, bool creditHandled) =
                av.getPaidPurchaseReportSettlement(reportId);
            liabilities += av.exposedReportBond(reportId);
            if (status == uint8(AgentVouchTypes.PaidPurchaseReportStatus.SlashingVouchers)) {
                liabilities += authorBondSlash + voucherSlash;
            }
            if (status == uint8(AgentVouchTypes.PaidPurchaseReportStatus.Terminal) && !creditHandled) {
                liabilities += buyerCredit;
            }
        }

        assertEq(usdc.balanceOf(address(av)), liabilities);
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
        c.disputeBondUsdcMicros = 5_000_000;
        c.minAuthorBondForFreeListingUsdcMicros = 1_000_000;
        c.minPaidListingPriceUsdcMicros = 10_000;
        c.authorShareBps = 6_000;
        c.voucherShareBps = 4_000;
        c.slashPercentage = 50;
        c.refundClaimWindowSeconds = 7 days;
        c.treasuryRecipient = RESERVE;
    }
}
