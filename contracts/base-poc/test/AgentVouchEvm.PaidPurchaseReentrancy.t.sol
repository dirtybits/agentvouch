// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgentVouchEvm} from "../src/AgentVouchEvm.sol";
import {AgentVouchTypes} from "../src/libraries/AgentVouchTypes.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract ReentrantUSDC is MockUSDC {
    address internal callbackTarget;
    bytes internal callbackData;
    bool internal armed;
    bool public callbackAttempted;
    bool public callbackSucceeded;

    function arm(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
        armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (!armed || to != address(this)) return;
        armed = false;
        callbackAttempted = true;
        (callbackSucceeded,) = callbackTarget.call(callbackData);
    }
}

contract PaidPurchaseReentrancyTest is Test {
    address internal constant ADMIN = address(0xA11CE);
    address internal constant AUTHOR = address(0xA0);
    address internal constant BUYER = address(0xB0);

    ReentrantUSDC internal usdc;
    AgentVouchEvm internal av;

    function setUp() public {
        vm.chainId(84532);
        usdc = new ReentrantUSDC();
        av = new AgentVouchEvm(address(usdc), ADMIN);
        vm.prank(ADMIN);
        av.initializeConfig(_cfg());

        _seed(AUTHOR);
        _seed(BUYER);
    }

    function test_reserveTransferCannotReenterReserveClaim() public {
        vm.prank(AUTHOR);
        bytes32 listing = av.createSkillListing(keccak256("reentrant"), "ipfs://skill", "skill", "desc", 10_000_000);
        vm.prank(BUYER);
        bytes32 purchase = av.purchaseSkill(listing);
        vm.prank(BUYER);
        uint64 reportId = av.openPaidPurchaseReport(AUTHOR, listing, purchase, "evidence");
        vm.prank(ADMIN);
        av.reviewPaidPurchaseReport(reportId, false);

        usdc.arm(address(av), abi.encodeCall(AgentVouchEvm.claimRestitutionReserve, ()));
        vm.prank(address(usdc));
        av.claimRestitutionReserve();

        assertTrue(usdc.callbackAttempted());
        assertFalse(usdc.callbackSucceeded());
        assertEq(usdc.balanceOf(address(usdc)), 5_000_000);

        vm.prank(address(usdc));
        vm.expectRevert(AgentVouchEvm.PaidPurchaseCreditNotFunded.selector);
        av.claimRestitutionReserve();
    }

    function _seed(address who) internal {
        usdc.mint(who, 100_000_000);
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
        c.treasuryRecipient = address(usdc);
    }
}
