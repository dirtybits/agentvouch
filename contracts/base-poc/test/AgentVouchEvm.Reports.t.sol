// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgentVouchEvm} from "../src/AgentVouchEvm.sol";
import {AgentVouchTypes} from "../src/libraries/AgentVouchTypes.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract ReportsTest is Test {
    AgentVouchEvm internal av;
    MockUSDC internal usdc;
    address internal admin = address(0xA11CE);
    address internal author = address(0xA0);
    address internal reporter = address(0xB0);
    address internal voucher = address(0xC0);

    uint256 constant DISPUTE_BOND = 5_000_000;
    uint256 constant AUTHOR_BOND = 10_000_000;
    uint256 constant MIN_VOUCH = 1_000_000;

    function setUp() public {
        usdc = new MockUSDC();
        av = new AgentVouchEvm(address(usdc), admin);
        vm.prank(admin);
        av.initializeConfig(_cfg());

        _setupActor(author);
        _setupActor(reporter);
        _setupActor(voucher);
    }

    function _cfg() internal view returns (AgentVouchTypes.Config memory c) {
        c.usdc = address(usdc);
        c.chainContext = "eip155:84532";
        c.minVouchStakeUsdcMicros = MIN_VOUCH;
        c.disputeBondUsdcMicros = DISPUTE_BOND;
        c.minAuthorBondForFreeListingUsdcMicros = AUTHOR_BOND;
        c.minPaidListingPriceUsdcMicros = 1_000_000;
        c.authorShareBps = 6000;
        c.voucherShareBps = 4000;
        c.protocolFeeBps = 0;
        c.slashPercentage = 100;
        c.refundClaimWindowSeconds = 1 days;
        c.challengerRewardBps = 1_000;
        c.challengerRewardCapUsdcMicros = 1_000_000;
        c.treasuryRecipient = address(0xD00D);
    }

    function _setupActor(address actor) internal {
        usdc.mint(actor, 1_000_000_000);
        vm.startPrank(actor);
        usdc.approve(address(av), type(uint256).max);
        av.registerAgent("ipfs://agent");
        vm.stopPrank();
    }

    function test_protocolVersionMarksV1Candidate() public view {
        assertEq(av.PROTOCOL_VERSION(), "base-v1-candidate");
    }

    function test_openReportBondsAndLocksAuthorExposure() public {
        vm.prank(author);
        av.depositAuthorBond(AUTHOR_BOND);
        vm.prank(voucher);
        av.vouch(author, MIN_VOUCH);

        uint256 reporterBefore = usdc.balanceOf(reporter);
        vm.prank(reporter);
        uint64 reportId = av.openReport(author, "ipfs://evidence");

        AgentVouchTypes.LegacyAuthorReport memory report = av.getAuthorReport(reportId);
        assertTrue(report.exists);
        assertEq(report.reporter, reporter);
        assertEq(report.author, author);
        assertEq(report.evidenceUri, "ipfs://evidence");
        assertEq(report.bondUsdcMicros, DISPUTE_BOND);
        assertEq(report.forfeitedReporterBondUsdcMicros, 0);
        assertEq(uint8(report.status), uint8(AgentVouchTypes.ReportStatus.Open));
        assertEq(av.getProfile(author).openDisputes, 1);
        assertEq(usdc.balanceOf(reporter), reporterBefore - DISPUTE_BOND);

        vm.prank(author);
        vm.expectRevert(AgentVouchEvm.BondExposureLocked.selector);
        av.withdrawAuthorBond(1);

        vm.prank(voucher);
        vm.expectRevert(AgentVouchEvm.DisputeLocked.selector);
        av.revokeVouch(author);
    }

    function test_dismissReportReturnsReporterBondAndUpdatesCounters() public {
        vm.prank(reporter);
        uint64 reportId = av.openReport(author, "ipfs://evidence");

        uint256 reporterBefore = usdc.balanceOf(reporter);
        vm.prank(admin);
        (uint256 returnedBond, uint256 forfeitedBond, uint256 slashedBond) =
            av.resolveReport(reportId, AgentVouchTypes.Ruling.Dismissed, false);

        assertEq(returnedBond, DISPUTE_BOND);
        assertEq(forfeitedBond, 0);
        assertEq(slashedBond, 0);
        assertEq(usdc.balanceOf(reporter), reporterBefore + DISPUTE_BOND);

        AgentVouchTypes.LegacyAgentProfile memory profile = av.getProfile(author);
        assertEq(profile.openDisputes, 0);
        assertEq(profile.dismissedDisputes, 1);
        assertEq(profile.upheldDisputes, 0);

        AgentVouchTypes.LegacyAuthorReport memory report = av.getAuthorReport(reportId);
        assertEq(uint8(report.status), uint8(AgentVouchTypes.ReportStatus.Resolved));
        assertEq(uint8(report.ruling), uint8(AgentVouchTypes.Ruling.Dismissed));
        assertEq(report.bondUsdcMicros, 0);
        assertEq(report.forfeitedReporterBondUsdcMicros, 0);
    }

    function test_dismissReportCanForfeitReporterBondToAuthor() public {
        vm.prank(reporter);
        uint64 reportId = av.openReport(author, "ipfs://evidence");

        uint256 reporterBefore = usdc.balanceOf(reporter);
        uint256 authorBefore = usdc.balanceOf(author);
        vm.prank(admin);
        (uint256 returnedBond, uint256 forfeitedBond, uint256 slashedBond) =
            av.resolveReport(reportId, AgentVouchTypes.Ruling.Dismissed, true);

        assertEq(returnedBond, 0);
        assertEq(forfeitedBond, DISPUTE_BOND);
        assertEq(slashedBond, 0);
        assertEq(usdc.balanceOf(reporter), reporterBefore);
        assertEq(usdc.balanceOf(author), authorBefore + DISPUTE_BOND);

        AgentVouchTypes.LegacyAgentProfile memory profile = av.getProfile(author);
        assertEq(profile.openDisputes, 0);
        assertEq(profile.dismissedDisputes, 1);
        assertEq(profile.upheldDisputes, 0);

        AgentVouchTypes.LegacyAuthorReport memory report = av.getAuthorReport(reportId);
        assertEq(uint8(report.status), uint8(AgentVouchTypes.ReportStatus.Resolved));
        assertEq(uint8(report.ruling), uint8(AgentVouchTypes.Ruling.Dismissed));
        assertEq(report.bondUsdcMicros, 0);
        assertEq(report.forfeitedReporterBondUsdcMicros, DISPUTE_BOND);
    }

    function test_upheldReportSlashesBoundedAuthorBondToReporter() public {
        vm.prank(author);
        av.depositAuthorBond(AUTHOR_BOND);
        vm.prank(reporter);
        uint64 reportId = av.openReport(author, "ipfs://evidence");

        uint256 reporterBefore = usdc.balanceOf(reporter);
        vm.prank(admin);
        (uint256 returnedBond, uint256 forfeitedBond, uint256 slashedBond) =
            av.resolveReport(reportId, AgentVouchTypes.Ruling.Upheld, false);

        assertEq(returnedBond, DISPUTE_BOND);
        assertEq(forfeitedBond, 0);
        assertEq(slashedBond, DISPUTE_BOND);
        assertEq(usdc.balanceOf(reporter), reporterBefore + DISPUTE_BOND + DISPUTE_BOND);

        AgentVouchTypes.LegacyAgentProfile memory profile = av.getProfile(author);
        assertEq(profile.openDisputes, 0);
        assertEq(profile.upheldDisputes, 1);
        assertEq(profile.dismissedDisputes, 0);
        assertEq(profile.authorBondUsdcMicros, AUTHOR_BOND - DISPUTE_BOND);

        AgentVouchTypes.LegacyAuthorReport memory report = av.getAuthorReport(reportId);
        assertEq(uint8(report.ruling), uint8(AgentVouchTypes.Ruling.Upheld));
        assertEq(report.slashedAuthorBondUsdcMicros, DISPUTE_BOND);
    }

    function test_upheldReportSlashesOnlyAvailableAuthorBond() public {
        vm.prank(author);
        av.depositAuthorBond(1_000_000);
        vm.prank(reporter);
        uint64 reportId = av.openReport(author, "ipfs://evidence");

        vm.prank(admin);
        (,, uint256 slashedBond) = av.resolveReport(reportId, AgentVouchTypes.Ruling.Upheld, false);

        assertEq(slashedBond, 1_000_000);
        assertEq(av.getProfile(author).authorBondUsdcMicros, 0);
    }

    function test_onlyResolverCanResolveAndCannotResolveTwice() public {
        vm.prank(reporter);
        uint64 reportId = av.openReport(author, "ipfs://evidence");

        vm.prank(reporter);
        vm.expectRevert();
        av.resolveReport(reportId, AgentVouchTypes.Ruling.Dismissed, false);

        vm.prank(admin);
        av.resolveReport(reportId, AgentVouchTypes.Ruling.Dismissed, false);

        vm.prank(admin);
        vm.expectRevert(AgentVouchEvm.ReportNotOpen.selector);
        av.resolveReport(reportId, AgentVouchTypes.Ruling.Dismissed, false);
    }

    function test_openReportRequiresValidRegisteredPartiesAndEvidence() public {
        vm.prank(reporter);
        vm.expectRevert(AgentVouchEvm.InvalidAuthor.selector);
        av.openReport(reporter, "ipfs://evidence");

        vm.prank(reporter);
        vm.expectRevert(AgentVouchEvm.EmptyMetadata.selector);
        av.openReport(author, "");

        vm.prank(reporter);
        vm.expectRevert(AgentVouchEvm.NotRegistered.selector);
        av.openReport(address(0xDEAD), "ipfs://evidence");
    }

    function test_openReportBlockedWhilePaused() public {
        vm.prank(admin);
        av.setPaused(true);

        vm.prank(reporter);
        vm.expectRevert();
        av.openReport(author, "ipfs://evidence");
    }
}
