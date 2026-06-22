// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentVouchTypes} from "./libraries/AgentVouchTypes.sol";

/// @title AgentVouchEvm (Base POC)
/// @notice Spec-port of AgentVouch's USDC-native protocol to Base/EVM. Decision
///         instrument only; Solana (`programs/agentvouch`) remains canonical.
/// @dev    No rent/ATA/PDA concepts: the contract custodies USDC and tracks every
///         balance as internal accounting. Authority is OpenZeppelin roles, not
///         config pubkeys. A single `Pausable` flag provides A3 parity; the exact
///         blocked-flow set is enforced per-function via `whenNotPaused`.
contract AgentVouchEvm is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- Roles (replace Solana Config authority pubkeys) ---
    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");
    bytes32 public constant RESOLVER_ROLE = keccak256("RESOLVER_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");
    bytes32 public constant SETTLEMENT_ROLE = keccak256("SETTLEMENT_ROLE");
    bytes32 public constant PAUSE_ROLE = keccak256("PAUSE_ROLE");

    IERC20 public immutable usdc;

    AgentVouchTypes.Config internal config;
    bool public configInitialized;

    mapping(address => AgentVouchTypes.AgentProfile) internal profiles;

    event ConfigInitialized(address indexed usdc, string chainContext);
    event PausedSet(address indexed by, bool paused);
    event AgentRegistered(address indexed agent, string metadataUri, uint64 registeredAt);

    error ZeroAddress();
    error AlreadyInitialized();
    error NotInitialized();
    error UsdcMismatch();
    error BadEconomics();
    error AlreadyRegistered();
    error EmptyMetadata();

    /// @param usdc_ 6-decimal USDC token on the target Base network.
    /// @param admin holder of every role for the POC (a multisig/timelock in prod).
    constructor(address usdc_, address admin) {
        if (usdc_ == address(0) || admin == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CONFIG_ROLE, admin);
        _grantRole(RESOLVER_ROLE, admin);
        _grantRole(TREASURY_ROLE, admin);
        _grantRole(SETTLEMENT_ROLE, admin);
        _grantRole(PAUSE_ROLE, admin);
    }

    /// @notice Port of `initialize_config`. One-shot; USDC must match the immutable.
    function initializeConfig(AgentVouchTypes.Config calldata cfg) external onlyRole(CONFIG_ROLE) {
        if (configInitialized) revert AlreadyInitialized();
        if (cfg.usdc != address(usdc)) revert UsdcMismatch();
        if (uint256(cfg.authorShareBps) + cfg.voucherShareBps + cfg.protocolFeeBps > 10_000) {
            revert BadEconomics();
        }
        config = cfg;
        configInitialized = true;
        emit ConfigInitialized(cfg.usdc, cfg.chainContext);
    }

    /// @notice Port of A3 `set_paused`, gated by PAUSE_ROLE.
    function setPaused(bool paused_) external onlyRole(PAUSE_ROLE) {
        if (paused_) _pause();
        else _unpause();
        emit PausedSet(msg.sender, paused_);
    }

    /// @notice Port of `register_agent`. On Solana this inits the AgentProfile PDA
    ///         with `payer = authority` (rent). On Base it is a plain state write —
    ///         no rent, no payer split; a paymaster/relayer sponsors the gas.
    function registerAgent(string calldata metadataUri) external whenNotPaused {
        if (!configInitialized) revert NotInitialized();
        if (bytes(metadataUri).length == 0) revert EmptyMetadata();
        AgentVouchTypes.AgentProfile storage p = profiles[msg.sender];
        if (p.registered) revert AlreadyRegistered();
        p.registered = true;
        p.metadataUri = metadataUri;
        p.registeredAt = uint64(block.timestamp);
        emit AgentRegistered(msg.sender, metadataUri, p.registeredAt);
    }

    // --- Views ---
    function getConfig() external view returns (AgentVouchTypes.Config memory) {
        return config;
    }

    function getProfile(address agent) external view returns (AgentVouchTypes.AgentProfile memory) {
        return profiles[agent];
    }
}
