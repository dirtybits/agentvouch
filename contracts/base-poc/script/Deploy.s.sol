// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console2} from "forge-std/console2.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AgentVouchEvm} from "../src/AgentVouchEvm.sol";
import {AgentVouchTypes} from "../src/libraries/AgentVouchTypes.sol";
import {PaidPurchaseSettlement} from "../src/libraries/PaidPurchaseSettlement.sol";
import {LinkedLibraryVerifier} from "./LinkedLibraryVerifier.sol";

/// @notice Deploys AgentVouchEvm and initializes config for the Base v1 A1 candidate.
///         Target: Base Sepolia (eip155:84532). The deployer (DEPLOYER_PRIVATE_KEY)
///         is granted every role by the constructor unless ADMIN_ADDRESS is provided.
///         Mainnet deployments must use documented multisig/custody from the Phase 10 gate.
///
///         Usage:
///           export DEPLOYER_PRIVATE_KEY=0x...
///           export USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e  # Base Sepolia USDC
///           export SLASH_PERCENTAGE=<founder-approved nonzero percentage>
///           export TREASURY_RECIPIENT=<founder-approved nonzero address>
///           forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast
contract Deploy is LinkedLibraryVerifier {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;
    // Circle's testnet USDC on Base Sepolia (supports EIP-3009 transferWithAuthorization).
    address internal constant BASE_SEPOLIA_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    error WrongChain(uint256 expectedChainId, uint256 actualChainId);
    error InvalidA1DeploymentInput(string input);

    function run() external {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) {
            revert WrongChain(BASE_SEPOLIA_CHAIN_ID, block.chainid);
        }

        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envOr("USDC_ADDRESS", BASE_SEPOLIA_USDC);
        address admin = vm.envOr("ADMIN_ADDRESS", vm.addr(pk));
        address settlementLibrary = address(PaidPurchaseSettlement);
        if (usdc.code.length == 0) revert InvalidA1DeploymentInput("USDC_ADDRESS_CODE");
        if (IERC20Metadata(usdc).decimals() != 6) revert InvalidA1DeploymentInput("USDC_DECIMALS");
        (bytes32 expectedLibraryCodeHash, bytes32 actualLibraryCodeHash) =
            _assertExpectedSettlementLibrary(settlementLibrary);
        AgentVouchTypes.Config memory deploymentConfig =
            _cfg(usdc, vm.envUint("SLASH_PERCENTAGE"), vm.envAddress("TREASURY_RECIPIENT"));

        vm.startBroadcast(pk);
        AgentVouchEvm av = new AgentVouchEvm(usdc, admin);
        if (admin == vm.addr(pk)) {
            // Only initialize here if the broadcaster holds CONFIG_ROLE (admin == deployer).
            av.initializeConfig(deploymentConfig);
        }
        vm.stopBroadcast();

        console2.log("AgentVouchEvm deployed:", address(av));
        console2.log("PaidPurchaseSettlement:", settlementLibrary);
        console2.log("expected library code hash:");
        console2.logBytes32(expectedLibraryCodeHash);
        console2.log("actual library code hash:");
        console2.logBytes32(actualLibraryCodeHash);
        console2.log("USDC:", usdc);
        console2.log("admin (all roles):", admin);
        console2.log("config initialized:", admin == vm.addr(pk));
    }

    function _cfg(address u, uint256 slashPercentage, address treasuryRecipient)
        internal
        pure
        returns (AgentVouchTypes.Config memory c)
    {
        if (slashPercentage == 0 || slashPercentage > 100) {
            revert InvalidA1DeploymentInput("SLASH_PERCENTAGE");
        }
        if (treasuryRecipient == address(0)) {
            revert InvalidA1DeploymentInput("TREASURY_RECIPIENT");
        }

        c.usdc = u;
        c.chainContext = "eip155:84532"; // Base Sepolia
        c.minVouchStakeUsdcMicros = 1_000_000; // 1 USDC
        c.disputeBondUsdcMicros = 5_000_000; // 5 USDC bond for paid-purchase reports
        c.minAuthorBondForFreeListingUsdcMicros = 1_000_000; // 1 USDC
        c.minPaidListingPriceUsdcMicros = 10_000; // 0.01 USDC
        c.authorShareBps = 6000; // 60% author
        c.voucherShareBps = 4000; // 40% voucher pool
        c.protocolFeeBps = 0; // reserved
        c.slashPercentage = uint8(slashPercentage);
        c.authorProceedsLockSeconds = 0; // no proceeds time-lock for the demo
        c.refundClaimWindowSeconds = 7 days;
        c.stakeWeightPerUsdc = 0;
        c.riskComponentCap = 0;
        c.vouchWeight = 0;
        c.vouchComponentCap = 0;
        c.longevityBonusPerDay = 0;
        c.longevityComponentCap = 0;
        c.upheldDisputePenalty = 0;
        c.reputationScoreCap = 0;
        c.treasuryRecipient = treasuryRecipient;
    }
}
