// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";

/// @notice Foundry-only deployment preflight for the externally linked settlement library.
/// @dev Solidity library runtime starts with a compiler-generated self-address guard. Foundry's
///      unlinked artifact contains a zeroed PUSH32 operand at this pinned offset; the deployed
///      runtime contains the actual library address. Patch the artifact exactly as solc does before
///      comparing EXTCODEHASH so any missing, wrong, stale, or differently compiled library fails.
abstract contract LinkedLibraryVerifier is Script {
    string internal constant SETTLEMENT_LIBRARY_ARTIFACT =
        "src/libraries/PaidPurchaseSettlement.sol:PaidPurchaseSettlement";
    uint256 internal constant LIBRARY_SELF_ADDRESS_OFFSET = 7;
    uint256 internal constant LIBRARY_SELF_ADDRESS_LENGTH = 32;

    error MissingSettlementLibraryCode(address libraryAddress);
    error UnexpectedSettlementLibraryArtifact();
    error SettlementLibraryCodeHashMismatch(address libraryAddress, bytes32 expected, bytes32 actual);

    function _assertExpectedSettlementLibrary(address libraryAddress)
        internal
        view
        returns (bytes32 expectedHash, bytes32 actualHash)
    {
        if (libraryAddress.code.length == 0) revert MissingSettlementLibraryCode(libraryAddress);

        bytes memory expectedRuntime = _expectedSettlementLibraryRuntime(libraryAddress);
        expectedHash = keccak256(expectedRuntime);
        actualHash = libraryAddress.codehash;
        if (actualHash != expectedHash) {
            revert SettlementLibraryCodeHashMismatch(libraryAddress, expectedHash, actualHash);
        }
    }

    function _expectedSettlementLibraryRuntime(address libraryAddress)
        internal
        view
        returns (bytes memory expectedRuntime)
    {
        expectedRuntime = vm.getDeployedCode(SETTLEMENT_LIBRARY_ARTIFACT);
        if (
            expectedRuntime.length < LIBRARY_SELF_ADDRESS_OFFSET + LIBRARY_SELF_ADDRESS_LENGTH
                || expectedRuntime[5] != bytes1(0x30) || expectedRuntime[6] != bytes1(0x7f)
        ) revert UnexpectedSettlementLibraryArtifact();

        for (uint256 i; i < LIBRARY_SELF_ADDRESS_LENGTH; ++i) {
            if (expectedRuntime[LIBRARY_SELF_ADDRESS_OFFSET + i] != bytes1(0)) {
                revert UnexpectedSettlementLibraryArtifact();
            }
        }

        assembly ("memory-safe") {
            mstore(add(add(expectedRuntime, 0x20), LIBRARY_SELF_ADDRESS_OFFSET), libraryAddress)
        }
    }
}
