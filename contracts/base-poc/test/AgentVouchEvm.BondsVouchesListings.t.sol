// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgentVouchEvm} from "../src/AgentVouchEvm.sol";
import {AgentVouchTypes} from "../src/libraries/AgentVouchTypes.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// Phase 2: bonds, vouches, listings (the rent-touching account-creating flows).
contract BondsVouchesListingsTest is Test {
    AgentVouchEvm internal av;
    MockUSDC internal usdc;
    address internal admin = address(0xA11CE);
    address internal author = address(0xA0);
    address internal voucher = address(0xB0);

    uint256 constant FLOOR = 10_000_000; // minAuthorBondForFreeListing
    uint256 constant MIN_VOUCH = 1_000_000;
    uint256 constant MIN_PAID = 1_000_000;

    function setUp() public {
        usdc = new MockUSDC();
        av = new AgentVouchEvm(address(usdc), admin);
        vm.prank(admin);
        av.initializeConfig(_cfg());
        _setupActor(author);
        _setupActor(voucher);
    }

    function _cfg() internal view returns (AgentVouchTypes.Config memory c) {
        c.usdc = address(usdc);
        c.chainContext = "eip155:84532";
        c.minVouchStakeUsdcMicros = MIN_VOUCH;
        c.disputeBondUsdcMicros = 5_000_000;
        c.minAuthorBondForFreeListingUsdcMicros = FLOOR;
        c.minPaidListingPriceUsdcMicros = MIN_PAID;
        c.authorShareBps = 6000;
        c.voucherShareBps = 4000;
        c.protocolFeeBps = 0;
        c.slashPercentage = 100;
    }

    function _setupActor(address a) internal {
        usdc.mint(a, 1_000_000_000);
        vm.startPrank(a);
        usdc.approve(address(av), type(uint256).max);
        av.registerAgent("ipfs://x");
        vm.stopPrank();
    }

    // --- bonds ---
    function test_depositAndWithdrawBond() public {
        vm.prank(author);
        av.depositAuthorBond(FLOOR);
        assertEq(av.getProfile(author).authorBondUsdcMicros, FLOOR);
        assertEq(usdc.balanceOf(address(av)), FLOOR);

        vm.prank(author);
        av.withdrawAuthorBond(FLOOR);
        assertEq(av.getProfile(author).authorBondUsdcMicros, 0);
        assertEq(usdc.balanceOf(address(av)), 0);
    }

    function test_depositRequiresRegistered() public {
        vm.startPrank(address(0xDEAD));
        usdc.mint(address(0xDEAD), FLOOR);
        usdc.approve(address(av), type(uint256).max);
        vm.expectRevert(AgentVouchEvm.NotRegistered.selector);
        av.depositAuthorBond(FLOOR);
        vm.stopPrank();
    }

    // --- listings ---
    function test_freeListingRequiresBondFloor() public {
        vm.prank(author);
        vm.expectRevert(AgentVouchEvm.FreeListingBondFloor.selector);
        av.createSkillListing(keccak256("s1"), "uri", "n", "d", 0);
    }

    function test_freeListingThenWithdrawBlockedByFloor() public {
        vm.startPrank(author);
        av.depositAuthorBond(FLOOR);
        bytes32 id = av.createSkillListing(keccak256("s1"), "uri", "n", "d", 0);
        assertEq(av.getProfile(author).activeFreeListingCount, 1);

        vm.expectRevert(AgentVouchEvm.BondExposureLocked.selector);
        av.withdrawAuthorBond(1);

        av.removeSkillListing(id);
        assertEq(av.getProfile(author).activeFreeListingCount, 0);
        av.withdrawAuthorBond(FLOOR);
        vm.stopPrank();
        assertEq(av.getProfile(author).authorBondUsdcMicros, 0);
    }

    function test_paidListingBelowMinReverts() public {
        vm.prank(author);
        vm.expectRevert(AgentVouchEvm.BelowMinPaidPrice.selector);
        av.createSkillListing(keccak256("s1"), "uri", "n", "d", MIN_PAID - 1);
    }

    function test_createListingDuplicateReverts() public {
        vm.startPrank(author);
        av.createSkillListing(keccak256("s1"), "uri", "n", "d", MIN_PAID);
        vm.expectRevert(AgentVouchEvm.ListingExists.selector);
        av.createSkillListing(keccak256("s1"), "uri2", "n2", "d2", MIN_PAID);
        vm.stopPrank();
    }

    function test_removeListingOnlyAuthor() public {
        vm.prank(author);
        bytes32 id = av.createSkillListing(keccak256("s1"), "uri", "n", "d", MIN_PAID);
        vm.prank(voucher);
        vm.expectRevert(AgentVouchEvm.NotListingAuthor.selector);
        av.removeSkillListing(id);
    }

    function test_createListingInitsSettlement() public {
        vm.prank(author);
        bytes32 id = av.createSkillListing(keccak256("s1"), "uri", "n", "d", MIN_PAID);
        assertTrue(av.getSettlement(id, 1).initialized);
        assertEq(av.getListing(id).currentRevision, 1);
    }

    // --- vouches ---
    function test_vouchAndRevoke() public {
        vm.prank(voucher);
        av.vouch(author, MIN_VOUCH * 5);
        AgentVouchTypes.Vouch memory v = av.getVouch(voucher, author);
        assertEq(uint8(v.status), uint8(AgentVouchTypes.VouchStatus.Active));
        assertEq(v.stakeUsdcMicros, MIN_VOUCH * 5);
        assertEq(av.getProfile(author).totalVouchStakeReceivedUsdcMicros, MIN_VOUCH * 5);
        assertEq(av.getProfile(author).totalVouchesReceived, 1);
        assertEq(usdc.balanceOf(address(av)), MIN_VOUCH * 5);

        uint256 balBefore = usdc.balanceOf(voucher);
        vm.prank(voucher);
        av.revokeVouch(author);
        AgentVouchTypes.Vouch memory v2 = av.getVouch(voucher, author);
        assertEq(uint8(v2.status), uint8(AgentVouchTypes.VouchStatus.Revoked));
        assertEq(av.getProfile(author).totalVouchStakeReceivedUsdcMicros, 0);
        assertEq(usdc.balanceOf(voucher), balBefore + MIN_VOUCH * 5);
    }

    function test_vouchBelowMinReverts() public {
        vm.prank(voucher);
        vm.expectRevert(AgentVouchEvm.BelowMinVouchStake.selector);
        av.vouch(author, MIN_VOUCH - 1);
    }

    function test_vouchDuplicateActiveReverts() public {
        vm.startPrank(voucher);
        av.vouch(author, MIN_VOUCH);
        vm.expectRevert(AgentVouchEvm.VouchAlreadyActive.selector);
        av.vouch(author, MIN_VOUCH);
        vm.stopPrank();
    }

    function test_revokeThenRevouch() public {
        vm.startPrank(voucher);
        av.vouch(author, MIN_VOUCH);
        av.revokeVouch(author);
        av.vouch(author, MIN_VOUCH * 2);
        vm.stopPrank();
        AgentVouchTypes.Vouch memory v = av.getVouch(voucher, author);
        assertEq(uint8(v.status), uint8(AgentVouchTypes.VouchStatus.Active));
        assertEq(v.stakeUsdcMicros, MIN_VOUCH * 2);
        assertEq(av.getProfile(author).totalVouchStakeReceivedUsdcMicros, MIN_VOUCH * 2);
    }

    function test_revokeNoActiveReverts() public {
        vm.prank(voucher);
        vm.expectRevert(AgentVouchEvm.NoActiveVouch.selector);
        av.revokeVouch(author);
    }

    // --- pause: exact A3 guard set (verified vs main 2026-06-22) ---
    // Blocked: deposit_author_bond, withdraw_author_bond, vouch, create_skill_listing.
    // Allowed: revoke_vouch (and register/claim/proceeds, covered elsewhere).
    function test_pauseGuardSet() public {
        vm.prank(author);
        av.depositAuthorBond(FLOOR);
        vm.prank(voucher);
        av.vouch(author, MIN_VOUCH);

        vm.prank(admin);
        av.setPaused(true);

        vm.prank(author);
        vm.expectRevert();
        av.depositAuthorBond(1);
        vm.prank(voucher);
        vm.expectRevert();
        av.vouch(address(0xCAFE), MIN_VOUCH);
        vm.prank(author);
        vm.expectRevert();
        av.createSkillListing(keccak256("p"), "u", "n", "d", MIN_PAID);
        // withdraw_author_bond IS paused-guarded (collateral exit)
        vm.prank(author);
        vm.expectRevert();
        av.withdrawAuthorBond(1);

        // revoke_vouch is NOT paused-guarded — stays open
        vm.prank(voucher);
        av.revokeVouch(author);
        assertEq(av.getProfile(author).totalVouchStakeReceivedUsdcMicros, 0);
    }
}
