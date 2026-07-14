// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgentVouchEvm} from "../src/AgentVouchEvm.sol";
import {AgentVouchTypes} from "../src/libraries/AgentVouchTypes.sol";
import {PaidPurchaseSettlement} from "../src/libraries/PaidPurchaseSettlement.sol";
import {A1DeploymentConfig} from "../script/A1DeploymentConfig.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract A1DeploymentConfigHarness is A1DeploymentConfig {
    function config(address usdc, uint256 slashPercentage, address treasury)
        external
        pure
        returns (AgentVouchTypes.Config memory)
    {
        return _cfg(usdc, slashPercentage, treasury);
    }

    function assertFresh(AgentVouchEvm av, address broadcaster, address stagingAdmin, address usdc) external view {
        _assertFreshDeployment(av, broadcaster, stagingAdmin, usdc);
    }

    function verifyFacade(AgentVouchEvm av, address settlementLibrary, address usdc)
        external
        view
        returns (bytes32 expectedHash, bytes32 actualHash)
    {
        return _assertExpectedAgentVouch(av, settlementLibrary, usdc);
    }

    function assertFinal(
        AgentVouchEvm av,
        address stagingAdmin,
        address finalAdmin,
        address configAuthority,
        address resolver,
        address settlementAuthority,
        address pauseAuthority
    ) external view {
        _assertFinalRoles(av, stagingAdmin, finalAdmin, configAuthority, resolver, settlementAuthority, pauseAuthority);
    }
}

contract A1DeploymentConfigTest is Test {
    A1DeploymentConfigHarness private harness;
    MockUSDC private usdc;

    address private broadcaster = address(0xB0ADCA57);
    address private stagingAdmin = address(0x57A61A6);
    address private finalAdmin = address(0xF1A1AD);
    address private resolver = address(0xAE501AE);
    address private pauseAuthority = address(0xA055E);

    function setUp() public {
        vm.chainId(84532);
        vm.setEnv("LOCAL_A1_REHEARSAL", "true");
        harness = new A1DeploymentConfigHarness();
        usdc = new MockUSDC();
    }

    function test_freshDeploymentIsUninitializedAndBroadcasterHasNoRoles() public {
        AgentVouchEvm av = new AgentVouchEvm(address(usdc), stagingAdmin);
        harness.assertFresh(av, broadcaster, stagingAdmin, address(usdc));
        (bytes32 expectedHash, bytes32 actualHash) =
            harness.verifyFacade(av, address(PaidPurchaseSettlement), address(usdc));
        assertEq(actualHash, expectedHash);
    }

    function test_freshDeploymentRejectsBroadcasterAsStagingAdmin() public {
        AgentVouchEvm av = new AgentVouchEvm(address(usdc), broadcaster);
        vm.expectRevert(
            abi.encodeWithSelector(
                A1DeploymentConfig.InvalidA1DeploymentInput.selector, "DISTINCT_BROADCASTER_AND_STAGING_ADMIN"
            )
        );
        harness.assertFresh(av, broadcaster, broadcaster, address(usdc));
    }

    function test_lockedConfigHasNoReporterRewardAndSevenDayClaimWindow() public view {
        AgentVouchTypes.Config memory cfg = harness.config(address(usdc), 50, finalAdmin);
        assertEq(cfg.disputeBondUsdcMicros, 5_000_000);
        assertEq(cfg.refundClaimWindowSeconds, 7 days);
        assertEq(cfg.challengerRewardBps, 0);
        assertEq(cfg.challengerRewardCapUsdcMicros, 0);
        assertEq(cfg.treasuryRecipient, finalAdmin);
    }

    function test_pausedInitializationAndCompleteRoleHandoff() public {
        AgentVouchEvm av = new AgentVouchEvm(address(usdc), stagingAdmin);

        vm.startPrank(stagingAdmin);
        av.setPaused(true);
        av.initializeConfig(harness.config(address(usdc), 50, finalAdmin));
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
        vm.stopPrank();

        assertTrue(av.configInitialized());
        assertTrue(av.paused());
        harness.assertFinal(av, stagingAdmin, finalAdmin, finalAdmin, resolver, finalAdmin, pauseAuthority);
    }

    function test_finalRoleAssertionRejectsRetainedStagingRole() public {
        AgentVouchEvm av = new AgentVouchEvm(address(usdc), stagingAdmin);
        vm.startPrank(stagingAdmin);
        av.grantRole(av.DEFAULT_ADMIN_ROLE(), finalAdmin);
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(A1DeploymentConfig.A1DeploymentInvariant.selector, "final-config"));
        harness.assertFinal(av, stagingAdmin, finalAdmin, finalAdmin, resolver, finalAdmin, pauseAuthority);
    }
}
