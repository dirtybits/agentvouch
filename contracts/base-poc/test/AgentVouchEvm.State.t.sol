// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgentVouchEvm} from "../src/AgentVouchEvm.sol";
import {AgentVouchTypes} from "../src/libraries/AgentVouchTypes.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract AgentVouchEvmStateTest is Test {
    AgentVouchEvm internal av;
    MockUSDC internal usdc;
    address internal admin = address(0xA11CE);
    address internal alice = address(0xA1);

    function setUp() public {
        usdc = new MockUSDC();
        av = new AgentVouchEvm(address(usdc), admin);
        vm.prank(admin);
        av.initializeConfig(_cfg(address(usdc)));
    }

    function _cfg(address u) internal pure returns (AgentVouchTypes.Config memory c) {
        c.usdc = u;
        c.chainContext = "eip155:84532";
        c.minVouchStakeUsdcMicros = 1_000_000;
        c.disputeBondUsdcMicros = 5_000_000;
        c.minAuthorBondForFreeListingUsdcMicros = 10_000_000;
        c.minPaidListingPriceUsdcMicros = 1_000_000;
        c.authorShareBps = 6000;
        c.voucherShareBps = 4000;
        c.protocolFeeBps = 0;
        c.slashPercentage = 100;
        // remaining reputation-scoring fields stay zero in the state skeleton
    }

    function test_configInitialized() public view {
        AgentVouchTypes.Config memory c = av.getConfig();
        assertEq(c.usdc, address(usdc));
        assertEq(c.authorShareBps, 6000);
        assertEq(c.voucherShareBps, 4000);
        assertEq(c.chainContext, "eip155:84532");
        assertTrue(av.configInitialized());
    }

    function test_initializeTwiceReverts() public {
        vm.prank(admin);
        vm.expectRevert(AgentVouchEvm.AlreadyInitialized.selector);
        av.initializeConfig(_cfg(address(usdc)));
    }

    function test_initializeRejectsBadEconomics() public {
        MockUSDC u2 = new MockUSDC();
        AgentVouchEvm av2 = new AgentVouchEvm(address(u2), admin);
        AgentVouchTypes.Config memory c = _cfg(address(u2));
        c.authorShareBps = 7000;
        c.voucherShareBps = 4000; // 110% total
        vm.prank(admin);
        vm.expectRevert(AgentVouchEvm.BadEconomics.selector);
        av2.initializeConfig(c);
    }

    function test_registerAgent() public {
        vm.prank(alice);
        av.registerAgent("ipfs://alice");
        AgentVouchTypes.AgentProfile memory p = av.getProfile(alice);
        assertTrue(p.registered);
        assertEq(p.metadataUri, "ipfs://alice");
        assertEq(p.registeredAt, uint64(block.timestamp));
    }

    function test_registerAgentDuplicateReverts() public {
        vm.startPrank(alice);
        av.registerAgent("ipfs://alice");
        vm.expectRevert(AgentVouchEvm.AlreadyRegistered.selector);
        av.registerAgent("ipfs://alice-2");
        vm.stopPrank();
    }

    function test_registerAgentEmptyMetadataReverts() public {
        vm.prank(alice);
        vm.expectRevert(AgentVouchEvm.EmptyMetadata.selector);
        av.registerAgent("");
    }

    function test_pauseBlocksRegisterThenUnpauseAllows() public {
        vm.prank(admin);
        av.setPaused(true);

        vm.prank(alice);
        vm.expectRevert(); // Pausable.EnforcedPause
        av.registerAgent("ipfs://alice");

        vm.prank(admin);
        av.setPaused(false);

        vm.prank(alice);
        av.registerAgent("ipfs://alice");
        assertTrue(av.getProfile(alice).registered);
    }

    function test_onlyPauseRoleCanPause() public {
        vm.prank(alice);
        vm.expectRevert(); // AccessControlUnauthorizedAccount
        av.setPaused(true);
    }
}
