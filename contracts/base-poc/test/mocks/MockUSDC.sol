// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20ReceiveWithAuthorization} from "../../src/interfaces/IERC20ReceiveWithAuthorization.sol";

/// @notice 6-decimal USDC mock with EIP-3009 transfer/receiveWithAuthorization, mirroring the
///         Base USDC (FiatTokenV2) domain ("USD Coin", version "2"). Used to test the x402
///         contract-consumed lane with real EIP-712 signatures. Implements BOTH authorization
///         functions (distinct type hashes) so tests can prove the open `transferWithAuthorization`
///         path cannot consume a `Receive`-typed signature, and that `receiveWithAuthorization`
///         only accepts the payee as caller (F-1).
contract MockUSDC is ERC20, IERC20ReceiveWithAuthorization {
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    mapping(address => mapping(bytes32 => bool)) private _authState;

    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("USD Coin")),
                keccak256(bytes("2")),
                block.chainid,
                address(this)
            )
        );
    }

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _authState[authorizer][nonce];
    }

    /// @notice EIP-3009 open path — anyone may submit. Kept so tests can show a `Receive`-typed
    ///         signature is NOT valid here.
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
    ) external {
        _consumeAuthorization(
            TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce, v, r, s
        );
    }

    /// @notice EIP-3009 caller-bound path — only the payee (`to`) may submit. This is what the
    ///         x402 Lane B uses, so the authorization can't be consumed by anyone else.
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
    ) external {
        require(to == msg.sender, "auth: caller must be the payee");
        _consumeAuthorization(
            RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce, v, r, s
        );
    }

    function _consumeAuthorization(
        bytes32 typeHash,
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) private {
        // EIP-3009 validity window — time comparison is intentional here.
        // forge-lint: disable-next-line(block-timestamp)
        require(block.timestamp > validAfter, "auth: not yet valid");
        // forge-lint: disable-next-line(block-timestamp)
        require(block.timestamp < validBefore, "auth: expired");
        require(!_authState[from][nonce], "auth: nonce used");

        bytes32 structHash = keccak256(abi.encode(typeHash, from, to, value, validAfter, validBefore, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == from, "auth: invalid signature");

        _authState[from][nonce] = true;
        _transfer(from, to, value);
    }
}
