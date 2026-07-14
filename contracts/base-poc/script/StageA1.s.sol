// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console2} from "forge-std/console2.sol";
import {AgentVouchEvm} from "../src/AgentVouchEvm.sol";
import {A1DeploymentConfig} from "./A1DeploymentConfig.sol";

/// @notice Pauses, initializes, and hands off a verified Base Sepolia A1 deployment.
/// @dev This script deliberately leaves the contract paused. It is a separate human-gated
///      broadcast from Deploy.s.sol and must never be combined with user activation.
contract StageA1 is A1DeploymentConfig {
    function run() external {
        uint256 stagingAdminPk = vm.envUint("STAGING_ADMIN_PRIVATE_KEY");
        address stagingAdmin = vm.addr(stagingAdminPk);
        AgentVouchEvm av = AgentVouchEvm(vm.envAddress("AGENTVOUCH_ADDRESS"));
        address settlementLibrary = vm.envAddress("PAID_PURCHASE_SETTLEMENT_ADDRESS");
        address finalAdmin = vm.envAddress("FINAL_ADMIN_ADDRESS");
        address configAuthority = vm.envAddress("CONFIG_AUTHORITY_ADDRESS");
        address resolver = vm.envAddress("RESOLVER_ADDRESS");
        address settlementAuthority = vm.envAddress("SETTLEMENT_AUTHORITY_ADDRESS");
        address pauseAuthority = vm.envAddress("PAUSE_AUTHORITY_ADDRESS");
        address treasuryRecipient = vm.envAddress("TREASURY_RECIPIENT");
        uint256 slashPercentage = vm.envUint("SLASH_PERCENTAGE");

        if (address(av).code.length == 0) revert InvalidA1DeploymentInput("AGENTVOUCH_ADDRESS_CODE");
        _assertBaseSepoliaUsdc(address(av.usdc()));
        _assertExpectedSettlementLibrary(settlementLibrary);
        _assertExpectedAgentVouch(av, settlementLibrary, address(av.usdc()));
        if (av.configInitialized()) revert A1DeploymentInvariant("config-already-initialized");
        if (av.paused()) revert A1DeploymentInvariant("already-paused");
        if (!av.hasRole(av.DEFAULT_ADMIN_ROLE(), stagingAdmin)) revert A1DeploymentInvariant("staging-admin");
        _validateFinalRoleInputs(
            stagingAdmin, finalAdmin, configAuthority, resolver, settlementAuthority, pauseAuthority
        );

        vm.startBroadcast(stagingAdminPk);
        av.setPaused(true);
        av.initializeConfig(_cfg(address(av.usdc()), slashPercentage, treasuryRecipient));

        av.grantRole(av.CONFIG_ROLE(), configAuthority);
        av.grantRole(av.RESOLVER_ROLE(), resolver);
        av.grantRole(av.SETTLEMENT_ROLE(), settlementAuthority);
        av.grantRole(av.PAUSE_ROLE(), pauseAuthority);
        av.grantRole(av.DEFAULT_ADMIN_ROLE(), finalAdmin);

        av.revokeRole(av.CONFIG_ROLE(), stagingAdmin);
        av.revokeRole(av.RESOLVER_ROLE(), stagingAdmin);
        av.revokeRole(av.SETTLEMENT_ROLE(), stagingAdmin);
        av.revokeRole(av.PAUSE_ROLE(), stagingAdmin);
        av.revokeRole(av.DEFAULT_ADMIN_ROLE(), stagingAdmin);
        vm.stopBroadcast();

        if (!av.configInitialized()) revert A1DeploymentInvariant("config-not-initialized");
        if (!av.paused()) revert A1DeploymentInvariant("not-paused");
        _assertFinalRoles(av, stagingAdmin, finalAdmin, configAuthority, resolver, settlementAuthority, pauseAuthority);

        console2.log("A1_STAGED_PAUSED_OK");
        console2.log("AgentVouchEvm:", address(av));
        console2.log("final admin:", finalAdmin);
        console2.log("config authority:", configAuthority);
        console2.log("resolver:", resolver);
        console2.log("settlement authority:", settlementAuthority);
        console2.log("pause authority:", pauseAuthority);
        console2.log("config initialized:", true);
        console2.log("paused:", true);
    }

    function _validateFinalRoleInputs(
        address stagingAdmin,
        address finalAdmin,
        address configAuthority,
        address resolver,
        address settlementAuthority,
        address pauseAuthority
    ) private pure {
        if (
            finalAdmin == address(0) || configAuthority == address(0) || resolver == address(0)
                || settlementAuthority == address(0) || pauseAuthority == address(0) || stagingAdmin == finalAdmin
                || stagingAdmin == configAuthority || stagingAdmin == resolver || stagingAdmin == settlementAuthority
                || stagingAdmin == pauseAuthority
        ) revert InvalidA1DeploymentInput("FINAL_ROLE_HOLDERS");
    }
}
