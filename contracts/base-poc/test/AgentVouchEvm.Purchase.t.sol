// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgentVouchEvm} from "../src/AgentVouchEvm.sol";
import {AgentVouchTypes} from "../src/libraries/AgentVouchTypes.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// Phase 3: purchase split, author-wide reward-index accrual, proceeds, claims.
contract PurchaseTest is Test {
    AgentVouchEvm internal av;
    MockUSDC internal usdc;
    address internal admin = address(0xA11CE);
    address internal author = address(0xA0); // backed author
    address internal author2 = address(0xA2); // no-backing author
    address internal voucher = address(0xB0);
    address internal voucher2 = address(0xB2);
    address internal buyer = address(0xC0);

    uint256 constant PRICE = 10_000_000; // 10 USDC
    uint256 constant MIN_VOUCH = 1_000_000;
    bytes32 internal idBacked;
    bytes32 internal idNoBacking;

    function setUp() public {
        usdc = new MockUSDC();
        av = new AgentVouchEvm(address(usdc), admin);
        vm.prank(admin);
        av.initializeConfig(_cfg(0));

        address[5] memory actors = [author, author2, voucher, voucher2, buyer];
        for (uint256 i; i < actors.length; i++) {
            usdc.mint(actors[i], 1_000_000_000_000);
            vm.startPrank(actors[i]);
            usdc.approve(address(av), type(uint256).max);
            av.registerAgent("ipfs://x");
            vm.stopPrank();
        }

        vm.prank(author);
        idBacked = av.createSkillListing(keccak256("backed"), "uri", "n", "d", PRICE);
        vm.prank(author2);
        idNoBacking = av.createSkillListing(keccak256("nobacking"), "uri", "n", "d", PRICE);
    }

    function _cfg(uint256 lockSeconds) internal view returns (AgentVouchTypes.Config memory c) {
        c.usdc = address(usdc);
        c.chainContext = "eip155:84532";
        c.minVouchStakeUsdcMicros = MIN_VOUCH;
        c.disputeBondUsdcMicros = 5_000_000;
        c.minAuthorBondForFreeListingUsdcMicros = 10_000_000;
        c.minPaidListingPriceUsdcMicros = MIN_VOUCH;
        c.authorShareBps = 6000;
        c.voucherShareBps = 4000;
        c.protocolFeeBps = 0;
        c.slashPercentage = 100;
        c.authorProceedsLockSeconds = lockSeconds;
    }

    // --- split ---
    function test_noBackingRoutesFullPriceToAuthor() public {
        vm.prank(buyer);
        bytes32 pId = av.purchaseSkill(idNoBacking);

        AgentVouchTypes.Purchase memory p = av.getPurchase(pId);
        assertEq(p.authorShareUsdcMicros, PRICE);
        assertEq(p.voucherPoolUsdcMicros, 0);
        assertEq(av.getSettlement(idNoBacking, 1).authorProceedsUsdcMicros, PRICE);
        // no voucher pool => reward index untouched
        assertEq(av.getProfile(author2).rewardIndexUsdcMicrosX1e12, 0);
        assertEq(av.getProfile(author2).unclaimedVoucherRevenueUsdcMicros, 0);
        assertEq(usdc.balanceOf(address(av)), PRICE);
    }

    function test_backedRoutes6040() public {
        vm.prank(voucher);
        av.vouch(author, MIN_VOUCH * 4); // activeStake = 4e6

        vm.prank(buyer);
        bytes32 pId = av.purchaseSkill(idBacked);

        AgentVouchTypes.Purchase memory p = av.getPurchase(pId);
        assertEq(p.authorShareUsdcMicros, (PRICE * 6000) / 10_000); // 6e6
        assertEq(p.voucherPoolUsdcMicros, (PRICE * 4000) / 10_000); // 4e6
        assertEq(av.getSettlement(idBacked, 1).authorProceedsUsdcMicros, 6_000_000);
        assertEq(av.getProfile(author).unclaimedVoucherRevenueUsdcMicros, 4_000_000);
        assertGt(av.getProfile(author).rewardIndexUsdcMicrosX1e12, 0);
        // contract holds the vouch stake + the full purchase
        assertEq(usdc.balanceOf(address(av)), MIN_VOUCH * 4 + PRICE);
    }

    // --- reward index / claims ---
    function test_singleVoucherClaimsFullPool() public {
        vm.prank(voucher);
        av.vouch(author, MIN_VOUCH * 4);
        vm.prank(buyer);
        av.purchaseSkill(idBacked);

        uint256 balBefore = usdc.balanceOf(voucher);
        vm.prank(voucher);
        av.claimVoucherRevenue(author);
        // single voucher owns 100% of the stake => claims the entire pool
        assertEq(usdc.balanceOf(voucher) - balBefore, 4_000_000);
        assertEq(av.getProfile(author).unclaimedVoucherRevenueUsdcMicros, 0);
        assertEq(av.getVouch(voucher, author).pendingRewardsUsdcMicros, 0);
        assertEq(av.getVouch(voucher, author).cumulativeRevenueUsdcMicros, 4_000_000);
    }

    function test_multiVoucherProRata() public {
        vm.prank(voucher);
        av.vouch(author, 3_000_000); // 75%
        vm.prank(voucher2);
        av.vouch(author, 1_000_000); // 25%; total stake 4e6

        vm.prank(buyer);
        av.purchaseSkill(idBacked); // voucherPool = 4e6

        uint256 b1 = usdc.balanceOf(voucher);
        uint256 b2 = usdc.balanceOf(voucher2);
        vm.prank(voucher);
        av.claimVoucherRevenue(author);
        vm.prank(voucher2);
        av.claimVoucherRevenue(author);

        assertEq(usdc.balanceOf(voucher) - b1, 3_000_000); // 75% of 4e6
        assertEq(usdc.balanceOf(voucher2) - b2, 1_000_000); // 25% of 4e6
        // pool fully distributed
        assertEq(av.getProfile(author).unclaimedVoucherRevenueUsdcMicros, 0);
    }

    function test_claimNothingReverts() public {
        vm.prank(voucher);
        av.vouch(author, MIN_VOUCH);
        // no purchase yet -> nothing accrued
        vm.prank(voucher);
        vm.expectRevert(AgentVouchEvm.NothingToClaim.selector);
        av.claimVoucherRevenue(author);
    }

    function test_lateVoucherDoesNotEarnPriorPurchase() public {
        vm.prank(voucher);
        av.vouch(author, MIN_VOUCH * 4);
        vm.prank(buyer);
        av.purchaseSkill(idBacked); // voucher earns this one

        // voucher2 joins AFTER the purchase; entry index == current => no claim on past
        vm.prank(voucher2);
        av.vouch(author, MIN_VOUCH * 4);
        vm.prank(voucher2);
        vm.expectRevert(AgentVouchEvm.NothingToClaim.selector);
        av.claimVoucherRevenue(author);
    }

    // --- duplicate / free ---
    function test_duplicatePurchaseReverts() public {
        vm.startPrank(buyer);
        av.purchaseSkill(idNoBacking);
        vm.expectRevert(AgentVouchEvm.DuplicatePurchase.selector);
        av.purchaseSkill(idNoBacking);
        vm.stopPrank();
    }

    function test_freeSkillNotPurchasable() public {
        vm.startPrank(author);
        av.depositAuthorBond(10_000_000); // free-listing floor
        bytes32 freeId = av.createSkillListing(keccak256("free"), "uri", "n", "d", 0);
        vm.stopPrank();
        vm.prank(buyer);
        vm.expectRevert(AgentVouchEvm.FreeSkillNotPurchased.selector);
        av.purchaseSkill(freeId);
    }

    // --- proceeds ---
    function test_withdrawAuthorProceeds() public {
        vm.prank(buyer);
        av.purchaseSkill(idNoBacking); // proceeds = PRICE, lock = 0
        uint256 bal = usdc.balanceOf(author2);
        vm.prank(author2);
        av.withdrawAuthorProceeds(idNoBacking, 1, PRICE);
        assertEq(usdc.balanceOf(author2) - bal, PRICE);
        assertEq(av.getSettlement(idNoBacking, 1).authorProceedsUsdcMicros, 0);
    }

    function test_withdrawProceedsOverBalanceReverts() public {
        vm.prank(buyer);
        av.purchaseSkill(idNoBacking);
        vm.prank(author2);
        vm.expectRevert(AgentVouchEvm.InsufficientProceeds.selector);
        av.withdrawAuthorProceeds(idNoBacking, 1, PRICE + 1);
    }

    function test_proceedsTimeLock() public {
        // fresh instance with a 1h proceeds lock
        MockUSDC u = new MockUSDC();
        AgentVouchEvm av2 = new AgentVouchEvm(address(u), admin);
        vm.prank(admin);
        AgentVouchTypes.Config memory c = _cfg(3600);
        c.usdc = address(u);
        av2.initializeConfig(c);

        u.mint(author2, 1_000_000_000);
        u.mint(buyer, 1_000_000_000);
        vm.startPrank(author2);
        u.approve(address(av2), type(uint256).max);
        av2.registerAgent("ipfs://a2");
        bytes32 id = av2.createSkillListing(keccak256("p"), "uri", "n", "d", PRICE);
        vm.stopPrank();
        vm.startPrank(buyer);
        u.approve(address(av2), type(uint256).max);
        av2.registerAgent("ipfs://b");
        av2.purchaseSkill(id);
        vm.stopPrank();

        vm.prank(author2);
        vm.expectRevert(AgentVouchEvm.ProceedsTimeLocked.selector);
        av2.withdrawAuthorProceeds(id, 1, PRICE);

        vm.warp(block.timestamp + 3600);
        vm.prank(author2);
        av2.withdrawAuthorProceeds(id, 1, PRICE);
        assertEq(av2.getSettlement(id, 1).authorProceedsUsdcMicros, 0);
    }

    // --- revoke interaction: rewards earned survive revoke; revoked stake stops backing ---
    function test_rewardsSurviveRevokeThenNewPurchaseHasNoBacking() public {
        vm.prank(voucher);
        av.vouch(author, MIN_VOUCH * 4);
        vm.prank(buyer);
        av.purchaseSkill(idBacked); // voucher earns 4e6 pending (accrues on claim/revoke)

        // revoke accrues pending first, returns stake, removes backing
        vm.prank(voucher);
        av.revokeVouch(author);
        assertEq(av.getVouch(voucher, author).pendingRewardsUsdcMicros, 4_000_000);
        assertEq(av.getProfile(author).totalVouchStakeReceivedUsdcMicros, 0);

        // voucher still claims the pre-revoke rewards
        uint256 bal = usdc.balanceOf(voucher);
        vm.prank(voucher);
        av.claimVoucherRevenue(author);
        assertEq(usdc.balanceOf(voucher) - bal, 4_000_000);

        // a new buyer purchasing now finds no backing => full price to author, no pool
        address buyer2 = address(0xC2);
        usdc.mint(buyer2, PRICE);
        vm.startPrank(buyer2);
        usdc.approve(address(av), type(uint256).max);
        av.registerAgent("ipfs://b2");
        bytes32 pId = av.purchaseSkill(idBacked);
        vm.stopPrank();
        assertEq(av.getPurchase(pId).voucherPoolUsdcMicros, 0);
        assertEq(av.getPurchase(pId).authorShareUsdcMicros, PRICE);
    }

    // --- pause: purchase blocked, claim allowed ---
    function test_pausePurchaseBlockedClaimAllowed() public {
        vm.prank(voucher);
        av.vouch(author, MIN_VOUCH * 4);
        vm.prank(buyer);
        av.purchaseSkill(idBacked);

        vm.prank(admin);
        av.setPaused(true);

        vm.prank(buyer);
        vm.expectRevert(); // purchase is paused-guarded
        av.purchaseSkill(idBacked);

        // claim_voucher_revenue is NOT paused-guarded
        vm.prank(voucher);
        av.claimVoucherRevenue(author);
        assertEq(av.getProfile(author).unclaimedVoucherRevenueUsdcMicros, 0);
    }

    // --- solvency invariant after a backed purchase + partial claim ---
    function test_solvencyInvariant() public {
        vm.prank(voucher);
        av.vouch(author, MIN_VOUCH * 4);
        vm.prank(buyer);
        av.purchaseSkill(idBacked);

        // liabilities = active stake + author proceeds + unclaimed voucher revenue
        uint256 liabilities = av.getProfile(author).totalVouchStakeReceivedUsdcMicros
            + av.getSettlement(idBacked, 1).authorProceedsUsdcMicros
            + av.getProfile(author).unclaimedVoucherRevenueUsdcMicros;
        assertEq(usdc.balanceOf(address(av)), liabilities);

        vm.prank(voucher);
        av.claimVoucherRevenue(author);
        liabilities = av.getProfile(author).totalVouchStakeReceivedUsdcMicros
            + av.getSettlement(idBacked, 1).authorProceedsUsdcMicros
            + av.getProfile(author).unclaimedVoucherRevenueUsdcMicros;
        assertEq(usdc.balanceOf(address(av)), liabilities);
    }

    // --- regression: audit fixes (2026-06-22) ---

    function _seed(MockUSDC u, AgentVouchEvm a, address who) internal {
        u.mint(who, 1_000_000_000);
        vm.startPrank(who);
        u.approve(address(a), type(uint256).max);
        a.registerAgent("ipfs://x");
        vm.stopPrank();
    }

    // re-vouch after revoke must NOT wipe earned-but-unclaimed rewards (was a USDC lockup).
    function test_revouchPreservesPendingRewards() public {
        vm.prank(voucher);
        av.vouch(author, MIN_VOUCH * 4);
        vm.prank(buyer);
        av.purchaseSkill(idBacked);

        vm.prank(voucher);
        av.revokeVouch(author); // accrues -> pending = 4e6
        assertEq(av.getVouch(voucher, author).pendingRewardsUsdcMicros, 4_000_000);

        // re-vouch WITHOUT claiming first
        vm.prank(voucher);
        av.vouch(author, MIN_VOUCH * 2);
        assertEq(av.getVouch(voucher, author).pendingRewardsUsdcMicros, 4_000_000);

        uint256 bal = usdc.balanceOf(voucher);
        vm.prank(voucher);
        av.claimVoucherRevenue(author);
        assertEq(usdc.balanceOf(voucher) - bal, 4_000_000);
        assertEq(av.getProfile(author).unclaimedVoucherRevenueUsdcMicros, 0);
    }

    // withdraw_author_proceeds IS paused-guarded on Solana (fidelity fix).
    function test_proceedsBlockedWhilePaused() public {
        vm.prank(buyer);
        av.purchaseSkill(idNoBacking);
        vm.prank(admin);
        av.setPaused(true);
        vm.prank(author2);
        vm.expectRevert();
        av.withdrawAuthorProceeds(idNoBacking, 1, PRICE);
    }

    // the proceeds lock is rolling: each new purchase resets it (updatedAt), matching Solana.
    function test_proceedsLockRollsForwardOnNewPurchase() public {
        MockUSDC u = new MockUSDC();
        AgentVouchEvm a = new AgentVouchEvm(address(u), admin);
        AgentVouchTypes.Config memory c = _cfg(1000);
        c.usdc = address(u);
        vm.prank(admin);
        a.initializeConfig(c);

        address au = address(0xAA);
        address b1 = address(0xC1);
        address b2 = address(0xC2);
        _seed(u, a, au);
        _seed(u, a, b1);
        _seed(u, a, b2);

        vm.prank(au);
        bytes32 id = a.createSkillListing(keccak256("x"), "u", "n", "d", PRICE);

        vm.prank(b1);
        a.purchaseSkill(id); // updatedAt = T

        vm.warp(block.timestamp + 600); // < 1000s, still locked
        vm.prank(b2);
        a.purchaseSkill(id); // updatedAt rolls forward to T+600

        vm.warp(block.timestamp + 600); // now T+1200; unlock = (T+600)+1000 = T+1600
        vm.prank(au);
        vm.expectRevert(AgentVouchEvm.ProceedsTimeLocked.selector);
        a.withdrawAuthorProceeds(id, 1, PRICE);

        vm.warp(block.timestamp + 400); // now T+1600 -> unlocked
        vm.prank(au);
        a.withdrawAuthorProceeds(id, 1, 2 * PRICE);
        assertEq(a.getSettlement(id, 1).authorProceedsUsdcMicros, 0);
    }
}
