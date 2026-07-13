// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {LinkedLibraryVerifier} from "../script/LinkedLibraryVerifier.sol";
import {PaidPurchaseSettlement} from "../src/libraries/PaidPurchaseSettlement.sol";

contract LinkedLibraryVerifierHarness is LinkedLibraryVerifier {
    function verify(address libraryAddress) external view returns (bytes32 expectedHash, bytes32 actualHash) {
        return _assertExpectedSettlementLibrary(libraryAddress);
    }

    function expectedRuntime(address libraryAddress) external view returns (bytes memory) {
        return _expectedSettlementLibraryRuntime(libraryAddress);
    }
}

contract LinkedLibraryVerifierTest is Test {
    LinkedLibraryVerifierHarness private verifier;

    function setUp() public {
        verifier = new LinkedLibraryVerifierHarness();
    }

    function test_compiledAndLinkedLibraryCodeHashMatches() public view {
        (bytes32 expectedHash, bytes32 actualHash) = verifier.verify(address(PaidPurchaseSettlement));
        assertEq(actualHash, expectedHash);
        assertEq(actualHash, address(PaidPurchaseSettlement).codehash);
    }

    function test_missingLibraryCodeReverts() public {
        address missing = address(0xBEEF);
        vm.expectRevert(abi.encodeWithSelector(LinkedLibraryVerifier.MissingSettlementLibraryCode.selector, missing));
        verifier.verify(missing);
    }

    function test_wrongLibraryCodeReverts() public {
        address wrong = address(0xCAFE);
        vm.etch(wrong, hex"60006000fd");

        bytes32 expectedHash = keccak256(verifier.expectedRuntime(wrong));
        bytes32 actualHash = wrong.codehash;
        vm.expectRevert(
            abi.encodeWithSelector(
                LinkedLibraryVerifier.SettlementLibraryCodeHashMismatch.selector, wrong, expectedHash, actualHash
            )
        );
        verifier.verify(wrong);
    }

    function test_runtimeLinkedForAnotherAddressReverts() public {
        address first = address(0x1111);
        address second = address(0x2222);
        vm.etch(second, verifier.expectedRuntime(first));

        bytes32 expectedHash = keccak256(verifier.expectedRuntime(second));
        bytes32 actualHash = second.codehash;
        vm.expectRevert(
            abi.encodeWithSelector(
                LinkedLibraryVerifier.SettlementLibraryCodeHashMismatch.selector, second, expectedHash, actualHash
            )
        );
        verifier.verify(second);
    }
}
