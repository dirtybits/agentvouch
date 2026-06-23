// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPaymaster} from "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

/// @title AcceptEverythingPaymaster
/// @notice Minimal ERC-4337 paymaster for the local gas-free proof: it sponsors every
///         UserOp and pays gas from its EntryPoint deposit. It stands in for a hosted
///         Base paymaster (e.g. Coinbase Developer Platform) whose policy/allowlist
///         would, in production, scope sponsorship to the AgentVouch contract and rate
///         limit per account. The point this proves is platform-agnostic: with a
///         paymaster attached, the user's smart account spends zero ETH on gas.
contract AcceptEverythingPaymaster is IPaymaster {
    IEntryPoint public immutable entryPoint;

    constructor(IEntryPoint ep) {
        entryPoint = ep;
    }

    /// @inheritdoc IPaymaster
    function validatePaymasterUserOp(PackedUserOperation calldata, bytes32, uint256)
        external
        view
        returns (bytes memory context, uint256 validationData)
    {
        require(msg.sender == address(entryPoint), "paymaster: not entrypoint");
        // Empty context (no postOp work needed); validationData 0 == valid, no time range.
        return ("", 0);
    }

    /// @inheritdoc IPaymaster
    function postOp(PostOpMode, bytes calldata, uint256, uint256) external view {
        require(msg.sender == address(entryPoint), "paymaster: not entrypoint");
    }

    /// @notice Fund this paymaster's gas-sponsorship deposit held inside the EntryPoint.
    function deposit() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }
}
