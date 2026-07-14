// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console2} from "forge-std/console2.sol";
import {AgentVouchEvm} from "../src/AgentVouchEvm.sol";
import {PaidPurchaseSettlement} from "../src/libraries/PaidPurchaseSettlement.sol";
import {A1DeploymentConfig} from "./A1DeploymentConfig.sol";

/// @notice Deploys an uninitialized AgentVouchEvm for the Base v1 A1 candidate.
///         Target: Base Sepolia (eip155:84532). The deployer (DEPLOYER_PRIVATE_KEY)
///         must be distinct from the explicitly configured staging admin. This script
///         never initializes or activates the deployment; StageA1 performs the separate,
///         paused configuration and final role handoff after post-deploy verification.
///
///         Usage:
///           export DEPLOYER_PRIVATE_KEY=0x...
///           export USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e  # Base Sepolia USDC
///           export ADMIN_ADDRESS=<distinct staging admin>
///           forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast
contract Deploy is A1DeploymentConfig {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envOr("USDC_ADDRESS", BASE_SEPOLIA_USDC);
        address broadcaster = vm.addr(pk);
        address stagingAdmin = vm.envAddress("ADMIN_ADDRESS");
        address settlementLibrary = address(PaidPurchaseSettlement);
        _assertBaseSepoliaUsdc(usdc);
        if (broadcaster == stagingAdmin) {
            revert InvalidA1DeploymentInput("DISTINCT_BROADCASTER_AND_STAGING_ADMIN");
        }
        (bytes32 expectedLibraryCodeHash, bytes32 actualLibraryCodeHash) =
            _assertExpectedSettlementLibrary(settlementLibrary);

        vm.startBroadcast(pk);
        AgentVouchEvm av = new AgentVouchEvm(usdc, stagingAdmin);
        vm.stopBroadcast();

        _assertFreshDeployment(av, broadcaster, stagingAdmin, usdc);
        (bytes32 expectedAgentVouchCodeHash, bytes32 actualAgentVouchCodeHash) =
            _assertExpectedAgentVouch(av, settlementLibrary, usdc);

        console2.log("AgentVouchEvm deployed:", address(av));
        console2.log("PaidPurchaseSettlement:", settlementLibrary);
        console2.log("expected library code hash:");
        console2.logBytes32(expectedLibraryCodeHash);
        console2.log("actual library code hash:");
        console2.logBytes32(actualLibraryCodeHash);
        console2.log("expected AgentVouchEvm code hash:");
        console2.logBytes32(expectedAgentVouchCodeHash);
        console2.log("actual AgentVouchEvm code hash:");
        console2.logBytes32(actualAgentVouchCodeHash);
        console2.log("USDC:", usdc);
        console2.log("broadcaster (no roles):", broadcaster);
        console2.log("staging admin (all roles):", stagingAdmin);
        console2.log("config initialized:", false);
        console2.log("paused:", false);
    }
}
