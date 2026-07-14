// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AgentVouchEvm} from "../src/AgentVouchEvm.sol";
import {AgentVouchTypes} from "../src/libraries/AgentVouchTypes.sol";
import {LinkedLibraryVerifier} from "./LinkedLibraryVerifier.sol";

/// @notice Shared, testnet-only deployment invariants for the Base v1 A1 candidate.
/// @dev This helper deliberately has no mainnet branch. Base mainnet remains a separate
///      human-gated release with its own deployment configuration and review.
abstract contract A1DeploymentConfig is LinkedLibraryVerifier {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;
    address internal constant BASE_SEPOLIA_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    string internal constant AGENTVOUCH_ARTIFACT = "src/AgentVouchEvm.sol:AgentVouchEvm";
    uint256 internal constant AGENTVOUCH_RUNTIME_LENGTH = 23_487;

    error WrongChain(uint256 expectedChainId, uint256 actualChainId);
    error InvalidA1DeploymentInput(string input);
    error A1DeploymentInvariant(string invariant);
    error AgentVouchCodeHashMismatch(address candidate, bytes32 expected, bytes32 actual);
    error UnexpectedAgentVouchArtifact();

    function _assertBaseSepoliaUsdc(address usdc) internal view {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) {
            revert WrongChain(BASE_SEPOLIA_CHAIN_ID, block.chainid);
        }
        if (usdc != BASE_SEPOLIA_USDC && !_isLocalRehearsal()) {
            revert InvalidA1DeploymentInput("USDC_ADDRESS");
        }
        if (usdc.code.length == 0) revert InvalidA1DeploymentInput("USDC_ADDRESS_CODE");
        if (IERC20Metadata(usdc).decimals() != 6) revert InvalidA1DeploymentInput("USDC_DECIMALS");
    }

    function _cfg(address usdc, uint256 slashPercentage, address treasuryRecipient)
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

        c.usdc = usdc;
        c.chainContext = "eip155:84532";
        c.minVouchStakeUsdcMicros = 1_000_000;
        c.disputeBondUsdcMicros = 5_000_000;
        c.minAuthorBondForFreeListingUsdcMicros = 1_000_000;
        c.minPaidListingPriceUsdcMicros = 10_000;
        c.authorShareBps = 6_000;
        c.voucherShareBps = 4_000;
        c.protocolFeeBps = 0;
        // Safe after the explicit 1..100 range check above.
        // forge-lint: disable-next-line(unsafe-typecast)
        c.slashPercentage = uint8(slashPercentage);
        c.authorProceedsLockSeconds = 0;
        c.refundClaimWindowSeconds = 7 days;
        c.challengerRewardBps = 0;
        c.challengerRewardCapUsdcMicros = 0;
        c.treasuryRecipient = treasuryRecipient;
    }

    function _assertFreshDeployment(AgentVouchEvm av, address broadcaster, address stagingAdmin, address usdc)
        internal
        view
    {
        if (broadcaster == address(0) || stagingAdmin == address(0) || broadcaster == stagingAdmin) {
            revert InvalidA1DeploymentInput("DISTINCT_BROADCASTER_AND_STAGING_ADMIN");
        }
        if (address(av.usdc()) != usdc) revert A1DeploymentInvariant("usdc");
        if (av.configInitialized()) revert A1DeploymentInvariant("config-initialized");
        if (av.paused()) revert A1DeploymentInvariant("unexpected-paused");
        if (keccak256(bytes(av.PROTOCOL_VERSION())) != keccak256("base-v1-a1")) {
            revert A1DeploymentInvariant("protocol-version");
        }

        bytes32[5] memory roles =
            [av.DEFAULT_ADMIN_ROLE(), av.CONFIG_ROLE(), av.RESOLVER_ROLE(), av.SETTLEMENT_ROLE(), av.PAUSE_ROLE()];
        for (uint256 i; i < roles.length; ++i) {
            if (!av.hasRole(roles[i], stagingAdmin)) revert A1DeploymentInvariant("staging-admin-role");
            if (av.hasRole(roles[i], broadcaster)) revert A1DeploymentInvariant("broadcaster-role");
        }
    }

    /// @notice Proves the facade runtime is the exact pinned artifact with the expected
    ///         settlement library links and USDC immutable applied at solc's references.
    function _assertExpectedAgentVouch(AgentVouchEvm av, address settlementLibrary, address usdc)
        internal
        view
        returns (bytes32 expectedHash, bytes32 actualHash)
    {
        bytes memory expectedRuntime = _expectedAgentVouchRuntime(settlementLibrary, usdc);
        expectedHash = keccak256(expectedRuntime);
        actualHash = address(av).codehash;
        if (actualHash != expectedHash) {
            revert AgentVouchCodeHashMismatch(address(av), expectedHash, actualHash);
        }
    }

    function _expectedAgentVouchRuntime(address settlementLibrary, address usdc)
        internal
        view
        returns (bytes memory expectedRuntime)
    {
        expectedRuntime = vm.getDeployedCode(AGENTVOUCH_ARTIFACT);
        if (expectedRuntime.length != AGENTVOUCH_RUNTIME_LENGTH) revert UnexpectedAgentVouchArtifact();

        uint256[11] memory libraryOffsets =
            [uint256(2875), 4711, 6807, 7172, 7425, 7579, 14351, 15067, 16804, 20439, 20646];
        uint256[13] memory immutableOffsets =
            [uint256(3845), 4756, 6303, 6852, 7217, 7871, 10551, 14394, 14618, 16025, 16571, 16934, 19175];

        bytes20 libraryBytes = bytes20(settlementLibrary);
        for (uint256 i; i < libraryOffsets.length; ++i) {
            uint256 offset = libraryOffsets[i];
            for (uint256 j; j < 20; ++j) {
                expectedRuntime[offset + j] = libraryBytes[j];
            }
        }

        for (uint256 i; i < immutableOffsets.length; ++i) {
            uint256 offset = immutableOffsets[i];
            for (uint256 j; j < 32; ++j) {
                if (expectedRuntime[offset + j] != bytes1(0)) revert UnexpectedAgentVouchArtifact();
            }
            assembly ("memory-safe") {
                mstore(add(add(expectedRuntime, 0x20), offset), usdc)
            }
        }
    }

    function _assertFinalRoles(
        AgentVouchEvm av,
        address stagingAdmin,
        address finalAdmin,
        address configAuthority,
        address resolver,
        address settlementAuthority,
        address pauseAuthority
    ) internal view {
        if (
            stagingAdmin == address(0) || finalAdmin == address(0) || configAuthority == address(0)
                || resolver == address(0) || settlementAuthority == address(0) || pauseAuthority == address(0)
                || stagingAdmin == finalAdmin || stagingAdmin == configAuthority || stagingAdmin == resolver
                || stagingAdmin == settlementAuthority || stagingAdmin == pauseAuthority
        ) revert InvalidA1DeploymentInput("FINAL_ROLE_HOLDERS");

        if (!av.hasRole(av.DEFAULT_ADMIN_ROLE(), finalAdmin)) revert A1DeploymentInvariant("final-admin");
        if (!av.hasRole(av.CONFIG_ROLE(), configAuthority)) revert A1DeploymentInvariant("final-config");
        if (!av.hasRole(av.RESOLVER_ROLE(), resolver)) revert A1DeploymentInvariant("final-resolver");
        if (!av.hasRole(av.SETTLEMENT_ROLE(), settlementAuthority)) {
            revert A1DeploymentInvariant("final-settlement");
        }
        if (!av.hasRole(av.PAUSE_ROLE(), pauseAuthority)) revert A1DeploymentInvariant("final-pause");

        bytes32[5] memory roles =
            [av.DEFAULT_ADMIN_ROLE(), av.CONFIG_ROLE(), av.RESOLVER_ROLE(), av.SETTLEMENT_ROLE(), av.PAUSE_ROLE()];
        for (uint256 i; i < roles.length; ++i) {
            if (av.hasRole(roles[i], stagingAdmin)) revert A1DeploymentInvariant("staging-role-retained");
        }
    }

    function _isLocalRehearsal() internal view returns (bool) {
        return vm.envOr("LOCAL_A1_REHEARSAL", false);
    }
}
