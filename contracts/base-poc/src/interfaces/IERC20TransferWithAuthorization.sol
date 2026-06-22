// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IERC20TransferWithAuthorization
/// @notice The EIP-3009 subset used by the x402 contract-consumed lane. Base USDC
///         (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) implements this.
interface IERC20TransferWithAuthorization {
    /// @notice Pull `value` from `from` to `to` using `from`'s off-chain EIP-712
    ///         signature. The token verifies the signature and consumes the nonce
    ///         (single-use), giving replay protection at the token layer.
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    /// @notice True once `nonce` has been used by `authorizer`.
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
}
