// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {AgentVouchEvm} from "../src/AgentVouchEvm.sol";
import {AgentVouchTypes} from "../src/libraries/AgentVouchTypes.sol";

/// @notice Deploys AgentVouchEvm and initializes config for the gas-free UX spike.
///         Target: Base Sepolia (eip155:84532). The deployer (DEPLOYER_PRIVATE_KEY)
///         is granted every role, so it can call initializeConfig in the same run.
///
///         Usage:
///           export DEPLOYER_PRIVATE_KEY=0x...
///           export USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e  # Base Sepolia USDC
///           forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast
contract Deploy is Script {
    // Circle's testnet USDC on Base Sepolia (supports EIP-3009 transferWithAuthorization).
    address internal constant BASE_SEPOLIA_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envOr("USDC_ADDRESS", BASE_SEPOLIA_USDC);
        address admin = vm.envOr("ADMIN_ADDRESS", vm.addr(pk));

        vm.startBroadcast(pk);
        AgentVouchEvm av = new AgentVouchEvm(usdc, admin);
        if (admin == vm.addr(pk)) {
            // Only initialize here if the broadcaster holds CONFIG_ROLE (admin == deployer).
            av.initializeConfig(_cfg(usdc));
        }
        vm.stopBroadcast();

        console2.log("AgentVouchEvm deployed:", address(av));
        console2.log("USDC:", usdc);
        console2.log("admin (all roles):", admin);
        console2.log("config initialized:", admin == vm.addr(pk));
    }

    function _cfg(address u) internal pure returns (AgentVouchTypes.Config memory c) {
        c.usdc = u;
        c.chainContext = "eip155:84532"; // Base Sepolia
        c.minVouchStakeUsdcMicros = 1_000_000; // 1 USDC
        c.disputeBondUsdcMicros = 5_000_000; // 5 USDC (disputes are Phase 5; unused by this spike)
        c.minAuthorBondForFreeListingUsdcMicros = 10_000_000; // 10 USDC
        c.minPaidListingPriceUsdcMicros = 1_000_000; // 1 USDC
        c.authorShareBps = 6000; // 60% author
        c.voucherShareBps = 4000; // 40% voucher pool
        c.protocolFeeBps = 0; // reserved
        c.slashPercentage = 100;
        c.authorProceedsLockSeconds = 0; // no proceeds time-lock for the demo
    }
}
