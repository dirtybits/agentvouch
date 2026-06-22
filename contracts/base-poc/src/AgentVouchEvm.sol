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
///         config pubkeys. A single `Pausable` flag provides A3 parity; risk-
///         increasing inflows are `whenNotPaused`, while exits stay open (A3:
///         "block new risk-increasing flows, preserve agreed safe exits").
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
    mapping(bytes32 => AgentVouchTypes.Vouch) internal vouches; // keccak256(voucher, vouchee)
    mapping(bytes32 => AgentVouchTypes.SkillListing) internal listings; // keccak256(author, skillIdHash)
    mapping(bytes32 => mapping(uint64 => AgentVouchTypes.ListingSettlement)) internal settlements;

    event ConfigInitialized(address indexed usdc, string chainContext);
    event PausedSet(address indexed by, bool paused);
    event AgentRegistered(address indexed agent, string metadataUri, uint64 registeredAt);
    event AuthorBondDeposited(address indexed author, uint256 amount, uint256 newBalance);
    event AuthorBondWithdrawn(address indexed author, uint256 amount, uint256 newBalance);
    event Vouched(address indexed voucher, address indexed vouchee, uint256 stake);
    event VouchRevoked(address indexed voucher, address indexed vouchee, uint256 returned);
    event SkillListingCreated(bytes32 indexed listingId, address indexed author, uint256 price, bool free);
    event SkillListingRemoved(bytes32 indexed listingId);

    error ZeroAddress();
    error AlreadyInitialized();
    error NotInitialized();
    error UsdcMismatch();
    error BadEconomics();
    error AlreadyRegistered();
    error EmptyMetadata();
    error NotRegistered();
    error ZeroAmount();
    error InsufficientBond();
    error BondExposureLocked();
    error DisputeLocked();
    error BelowMinVouchStake();
    error VouchAlreadyActive();
    error VouchSlashed();
    error NoActiveVouch();
    error ListingExists();
    error ListingNotFound();
    error NotListingAuthor();
    error BelowMinPaidPrice();
    error FreeListingBondFloor();

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

    // --- Config & pause (initialize_config, set_paused) ---

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

    function setPaused(bool paused_) external onlyRole(PAUSE_ROLE) {
        if (paused_) _pause();
        else _unpause();
        emit PausedSet(msg.sender, paused_);
    }

    // --- Profiles (register_agent) ---

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

    // --- Author bonds (deposit_author_bond, withdraw_author_bond) ---

    /// @notice Port of `deposit_author_bond` (Solana `payer = author` → rent). On Base,
    ///         a sponsored write that pulls USDC into the internal author-bond ledger.
    function depositAuthorBond(uint256 amount) external nonReentrant whenNotPaused {
        if (!configInitialized) revert NotInitialized();
        if (amount == 0) revert ZeroAmount();
        AgentVouchTypes.AgentProfile storage p = profiles[msg.sender];
        if (!p.registered) revert NotRegistered();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        p.authorBondUsdcMicros += amount;
        emit AuthorBondDeposited(msg.sender, amount, p.authorBondUsdcMicros);
    }

    /// @notice Port of `withdraw_author_bond`. A safe exit (not pause-gated), but
    ///         locked while the author has open disputes or active free-listing exposure.
    function withdrawAuthorBond(uint256 amount) external nonReentrant {
        AgentVouchTypes.AgentProfile storage p = profiles[msg.sender];
        if (amount == 0) revert ZeroAmount();
        if (amount > p.authorBondUsdcMicros) revert InsufficientBond();
        if (p.openDisputes > 0) revert BondExposureLocked();
        uint256 remaining = p.authorBondUsdcMicros - amount;
        if (p.activeFreeListingCount > 0 && remaining < config.minAuthorBondForFreeListingUsdcMicros) {
            revert BondExposureLocked();
        }
        p.authorBondUsdcMicros = remaining;
        usdc.safeTransfer(msg.sender, amount);
        emit AuthorBondWithdrawn(msg.sender, amount, remaining);
    }

    // --- Vouches (vouch, revoke_vouch) ---

    /// @notice Port of `vouch` (Solana `payer = voucher` → rent). Pulls USDC into the
    ///         internal vouch-stake ledger; snapshots the vouchee reward index at entry.
    function vouch(address vouchee, uint256 stake) external nonReentrant whenNotPaused {
        if (!configInitialized) revert NotInitialized();
        if (vouchee == address(0) || vouchee == msg.sender) revert ZeroAddress();
        if (stake < config.minVouchStakeUsdcMicros) revert BelowMinVouchStake();
        if (!profiles[msg.sender].registered) revert NotRegistered();

        AgentVouchTypes.Vouch storage v = vouches[vouchId(msg.sender, vouchee)];
        // A fresh storage slot has status == Active (enum value 0), so existence is
        // tracked by a non-zero voucher, NOT by status.
        bool isNew = v.voucher == address(0);
        if (!isNew) {
            if (v.status == AgentVouchTypes.VouchStatus.Active) revert VouchAlreadyActive();
            if (v.status == AgentVouchTypes.VouchStatus.Slashed) revert VouchSlashed(); // residual rules: Phase 5
            // status == Revoked: re-vouch reactivates the slot below.
        }

        usdc.safeTransferFrom(msg.sender, address(this), stake);
        v.voucher = msg.sender;
        v.vouchee = vouchee;
        v.stakeUsdcMicros = stake;
        v.status = AgentVouchTypes.VouchStatus.Active;
        // Entry index = vouchee's current author-wide reward index (no rewards earned before entry).
        v.entryRewardIndexUsdcMicrosX1e12 = profiles[vouchee].rewardIndexUsdcMicrosX1e12;
        v.pendingRewardsUsdcMicros = 0;
        v.lastPayoutAt = uint64(block.timestamp);

        AgentVouchTypes.AgentProfile storage vee = profiles[vouchee];
        if (isNew) {
            profiles[msg.sender].totalVouchesGiven += 1;
            vee.totalVouchesReceived += 1;
        }
        vee.totalVouchStakeReceivedUsdcMicros += stake;
        emit Vouched(msg.sender, vouchee, stake);
    }

    /// @notice Port of `revoke_vouch`. Returns active stake. Blocked while the vouchee
    ///         has open disputes (A1 lock). Reward settlement on revoke lands in Phase 3.
    function revokeVouch(address vouchee) external nonReentrant {
        AgentVouchTypes.Vouch storage v = vouches[vouchId(msg.sender, vouchee)];
        if (v.voucher == address(0) || v.status != AgentVouchTypes.VouchStatus.Active) {
            revert NoActiveVouch();
        }
        AgentVouchTypes.AgentProfile storage vee = profiles[vouchee];
        if (vee.openDisputes > 0) revert DisputeLocked();

        uint256 stake = v.stakeUsdcMicros;
        v.status = AgentVouchTypes.VouchStatus.Revoked;
        v.stakeUsdcMicros = 0;
        vee.totalVouchStakeReceivedUsdcMicros -= stake;
        usdc.safeTransfer(msg.sender, stake);
        emit VouchRevoked(msg.sender, vouchee, stake);
    }

    // --- Listings (create_skill_listing, remove_skill_listing, implicit initialize_listing_settlement) ---

    /// @notice Port of `create_skill_listing` (+ implicit `initialize_listing_settlement`).
    ///         Solana inits PDAs with `payer = author` (rent); on Base, a sponsored write.
    function createSkillListing(
        bytes32 skillIdHash,
        string calldata uri,
        string calldata name,
        string calldata description,
        uint256 priceUsdcMicros
    ) external whenNotPaused returns (bytes32 id) {
        if (!configInitialized) revert NotInitialized();
        AgentVouchTypes.AgentProfile storage p = profiles[msg.sender];
        if (!p.registered) revert NotRegistered();

        id = listingId(msg.sender, skillIdHash);
        AgentVouchTypes.SkillListing storage l = listings[id];
        if (l.exists) revert ListingExists();

        bool free = priceUsdcMicros == 0;
        if (free) {
            if (p.authorBondUsdcMicros < config.minAuthorBondForFreeListingUsdcMicros) {
                revert FreeListingBondFloor();
            }
            p.activeFreeListingCount += 1;
        } else if (priceUsdcMicros < config.minPaidListingPriceUsdcMicros) {
            revert BelowMinPaidPrice();
        }

        l.author = msg.sender;
        l.skillIdHash = skillIdHash;
        l.uri = uri;
        l.name = name;
        l.description = description;
        l.priceUsdcMicros = priceUsdcMicros;
        l.currentRevision = 1;
        l.status = AgentVouchTypes.ListingStatus.Active;
        l.exists = true;
        settlements[id][1].initialized = true; // implicit initialize_listing_settlement
        emit SkillListingCreated(id, msg.sender, priceUsdcMicros, free);
    }

    /// @notice Port of `remove_skill_listing` (and `close_skill_listing`: on EVM there is
    ///         no rent to recoup, so closing is just marking Removed — see plan parity map).
    ///         Blocked while dispute-locked.
    function removeSkillListing(bytes32 id) external {
        AgentVouchTypes.SkillListing storage l = listings[id];
        if (!l.exists) revert ListingNotFound();
        if (l.author != msg.sender) revert NotListingAuthor();
        if (l.lockedByDispute) revert DisputeLocked();
        if (l.priceUsdcMicros == 0 && l.status == AgentVouchTypes.ListingStatus.Active) {
            profiles[msg.sender].activeFreeListingCount -= 1;
        }
        l.status = AgentVouchTypes.ListingStatus.Removed;
        emit SkillListingRemoved(id);
    }

    // --- Id helpers (Solana seed concepts, not exposed as PDAs) ---

    function vouchId(address voucher, address vouchee) public pure returns (bytes32) {
        return keccak256(abi.encode(voucher, vouchee));
    }

    function listingId(address author, bytes32 skillIdHash) public pure returns (bytes32) {
        return keccak256(abi.encode(author, skillIdHash));
    }

    // --- Views ---

    function getConfig() external view returns (AgentVouchTypes.Config memory) {
        return config;
    }

    function getProfile(address agent) external view returns (AgentVouchTypes.AgentProfile memory) {
        return profiles[agent];
    }

    function getVouch(address voucher, address vouchee) external view returns (AgentVouchTypes.Vouch memory) {
        return vouches[vouchId(voucher, vouchee)];
    }

    function getListing(bytes32 id) external view returns (AgentVouchTypes.SkillListing memory) {
        return listings[id];
    }

    function getSettlement(bytes32 id, uint64 revision)
        external
        view
        returns (AgentVouchTypes.ListingSettlement memory)
    {
        return settlements[id][revision];
    }
}
