// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IERC20ReceiveWithAuthorization
/// @notice The EIP-3009 subset the x402 contract-consumed lane uses. We use
///         `receiveWithAuthorization` (NOT `transferWithAuthorization`) because the token
///         requires `msg.sender == to`: only this contract (the payee) can consume a buyer's
///         authorization. That closes audit finding F-1 — with `transferWithAuthorization`
///         anyone could submit the signed authorization straight to the token, depositing the
///         funds and burning the nonce WITHOUT a purchase receipt (stranding the buyer). The
///         two functions also use distinct EIP-712 type hashes, so a `Receive`-typed signature
///         is not valid for the open `transferWithAuthorization` path either.
///         Base USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) implements this.
interface IERC20ReceiveWithAuthorization {
    /// @notice Pull `value` from `from` to `to` using `from`'s off-chain EIP-712 signature.
    ///         The token verifies the signature, REQUIRES `msg.sender == to`, and consumes the
    ///         nonce (single-use), giving replay protection at the token layer.
    function receiveWithAuthorization(
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
