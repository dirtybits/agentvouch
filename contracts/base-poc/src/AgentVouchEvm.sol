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
///         config pubkeys. A single `Pausable` flag provides A3 parity. The exact
///         paused set mirrors the Solana `require!(!config.paused)` guards (verified
///         2026-06-22): blocked = deposit_author_bond, withdraw_author_bond, vouch,
///         create/update_skill_listing, purchase_skill, open_dispute, x402 settle.
///         Allowed while paused = register_agent, revoke_vouch, remove_listing,
///         withdraw_author_proceeds, claim_voucher_revenue, refund claims.
contract AgentVouchEvm is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Matches Solana REWARD_INDEX_SCALE (state/skill_listing.rs).
    uint256 internal constant REWARD_INDEX_SCALE = 1e12;

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
    mapping(bytes32 => AgentVouchTypes.Purchase) internal purchases; // keccak256(buyer, listingId, revision)

    event ConfigInitialized(address indexed usdc, string chainContext);
    event PausedSet(address indexed by, bool paused);
    event AgentRegistered(address indexed agent, string metadataUri, uint64 registeredAt);
    event AuthorBondDeposited(address indexed author, uint256 amount, uint256 newBalance);
    event AuthorBondWithdrawn(address indexed author, uint256 amount, uint256 newBalance);
    event Vouched(address indexed voucher, address indexed vouchee, uint256 stake);
    event VouchRevoked(address indexed voucher, address indexed vouchee, uint256 returned);
    event SkillListingCreated(bytes32 indexed listingId, address indexed author, uint256 price, bool free);
    event SkillListingRemoved(bytes32 indexed listingId);
    event SkillPurchased(
        bytes32 indexed purchaseId,
        bytes32 indexed listingId,
        address indexed buyer,
        uint64 revision,
        uint256 price,
        uint256 authorShare,
        uint256 voucherPool
    );
    event AuthorProceedsWithdrawn(bytes32 indexed listingId, uint64 revision, address indexed author, uint256 amount);
    event VoucherRevenueClaimed(address indexed voucher, address indexed author, uint256 amount);

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
    error FreeSkillNotPurchased();
    error ListingNotActive();
    error SettlementNotInitialized();
    error SettlementLocked();
    error DuplicatePurchase();
    error VoucherPoolTooSmall();
    error NothingToClaim();
    error ProceedsTimeLocked();
    error InsufficientProceeds();

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

    // --- Profiles (register_agent: NOT paused-guarded on Solana) ---

    /// @notice Port of `register_agent`. On Solana this inits the AgentProfile PDA
    ///         with `payer = authority` (rent). On Base it is a plain state write —
    ///         no rent, no payer split; a paymaster/relayer sponsors the gas. Allowed
    ///         while paused (no funds move; matches Solana's lack of a paused guard).
    function registerAgent(string calldata metadataUri) external {
        if (!configInitialized) revert NotInitialized();
        if (bytes(metadataUri).length == 0) revert EmptyMetadata();
        AgentVouchTypes.AgentProfile storage p = profiles[msg.sender];
        if (p.registered) revert AlreadyRegistered();
        p.registered = true;
        p.metadataUri = metadataUri;
        p.registeredAt = uint64(block.timestamp);
        emit AgentRegistered(msg.sender, metadataUri, p.registeredAt);
    }

    // --- Author bonds (deposit_author_bond, withdraw_author_bond — both paused-guarded) ---

    function depositAuthorBond(uint256 amount) external nonReentrant whenNotPaused {
        if (!configInitialized) revert NotInitialized();
        if (amount == 0) revert ZeroAmount();
        AgentVouchTypes.AgentProfile storage p = profiles[msg.sender];
        if (!p.registered) revert NotRegistered();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        p.authorBondUsdcMicros += amount;
        emit AuthorBondDeposited(msg.sender, amount, p.authorBondUsdcMicros);
    }

    /// @notice Port of `withdraw_author_bond`. An author-side collateral exit, which
    ///         Solana blocks while paused (`require!(!config.paused)`), so it is
    ///         `whenNotPaused` here. Also locked by open disputes / free-listing floor.
    function withdrawAuthorBond(uint256 amount) external nonReentrant whenNotPaused {
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

    /// @notice Port of `revoke_vouch`. Accrues earned rewards first (so pre-revoke
    ///         earnings stay claimable), then returns active stake. Blocked while the
    ///         vouchee has open disputes (A1 lock). Allowed while paused.
    function revokeVouch(address vouchee) external nonReentrant {
        AgentVouchTypes.Vouch storage v = vouches[vouchId(msg.sender, vouchee)];
        if (v.voucher == address(0) || v.status != AgentVouchTypes.VouchStatus.Active) {
            revert NoActiveVouch();
        }
        AgentVouchTypes.AgentProfile storage vee = profiles[vouchee];
        if (vee.openDisputes > 0) revert DisputeLocked();

        // Settle rewards earned up to now before the stake stops backing.
        _accrueAuthorRewards(vouchee, v);

        uint256 stake = v.stakeUsdcMicros;
        v.status = AgentVouchTypes.VouchStatus.Revoked;
        v.stakeUsdcMicros = 0;
        vee.totalVouchStakeReceivedUsdcMicros -= stake;
        usdc.safeTransfer(msg.sender, stake);
        emit VouchRevoked(msg.sender, vouchee, stake);
    }

    // --- Listings (create_skill_listing, remove_skill_listing) ---

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
        // implicit initialize_listing_settlement for revision 1
        settlements[id][1].initialized = true;
        settlements[id][1].createdAt = uint64(block.timestamp);
        emit SkillListingCreated(id, msg.sender, priceUsdcMicros, free);
    }

    /// @notice Port of `remove_skill_listing` (and `close_skill_listing`: on EVM there
    ///         is no rent to recoup, so closing is just marking Removed). Blocked while
    ///         dispute-locked; allowed while paused.
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

    // --- Purchase, rewards, proceeds (purchase_skill, claim_voucher_revenue, withdraw_author_proceeds) ---

    /// @notice Port of `purchase_skill`. Splits price by backing: if the author has
    ///         external vouch stake, author_share = price*authorBps/1e4 and voucher_pool
    ///         = price*voucherBps/1e4 (require voucher_pool > 0); otherwise the full
    ///         price routes to author proceeds and no voucher pool is created. The
    ///         voucher pool advances the author-wide reward index. Atomic: the receipt
    ///         and USDC movement happen together or revert together.
    function purchaseSkill(bytes32 id) external nonReentrant whenNotPaused returns (bytes32 pId) {
        AgentVouchTypes.SkillListing storage l = listings[id];
        if (!l.exists) revert ListingNotFound();
        if (l.status != AgentVouchTypes.ListingStatus.Active) revert ListingNotActive();
        if (l.lockedByDispute) revert DisputeLocked();
        uint256 price = l.priceUsdcMicros;
        if (price == 0) revert FreeSkillNotPurchased();

        uint64 revision = l.currentRevision;
        AgentVouchTypes.ListingSettlement storage s = settlements[id][revision];
        if (!s.initialized) revert SettlementNotInitialized();
        if (s.locked) revert SettlementLocked();

        pId = purchaseId(msg.sender, id, revision);
        if (purchases[pId].exists) revert DuplicatePurchase();

        address author = l.author;
        uint256 activeVouchStake = profiles[author].totalVouchStakeReceivedUsdcMicros;

        uint256 authorShare;
        uint256 voucherPool;
        if (activeVouchStake > 0) {
            authorShare = (price * config.authorShareBps) / 10_000;
            voucherPool = (price * config.voucherShareBps) / 10_000;
            if (voucherPool == 0) revert VoucherPoolTooSmall();
        } else {
            authorShare = price;
            voucherPool = 0;
        }

        // Pull exactly what is allocated (matches Solana's two separate transfers).
        usdc.safeTransferFrom(msg.sender, address(this), authorShare + voucherPool);

        // Record the revision-scoped receipt.
        purchases[pId] = AgentVouchTypes.Purchase({
            exists: true,
            buyer: msg.sender,
            listingId: id,
            revision: revision,
            priceUsdcMicros: price,
            authorShareUsdcMicros: authorShare,
            voucherPoolUsdcMicros: voucherPool,
            timestamp: uint64(block.timestamp)
        });

        s.authorProceedsUsdcMicros += authorShare;
        l.totalDownloads += 1;
        l.totalRevenueUsdcMicros += price;

        if (voucherPool > 0) {
            uint256 indexDelta = (voucherPool * REWARD_INDEX_SCALE) / activeVouchStake;
            if (indexDelta == 0) revert VoucherPoolTooSmall();
            AgentVouchTypes.AgentProfile storage ap = profiles[author];
            ap.rewardIndexUsdcMicrosX1e12 += indexDelta;
            ap.unclaimedVoucherRevenueUsdcMicros += voucherPool;
        }

        emit SkillPurchased(pId, id, msg.sender, revision, price, authorShare, voucherPool);
    }

    /// @notice Port of `claim_voucher_revenue`. Accrues then pays out the voucher's
    ///         pending rewards. NOT paused-guarded on Solana — claims stay open while paused.
    function claimVoucherRevenue(address author) external nonReentrant {
        AgentVouchTypes.Vouch storage v = vouches[vouchId(msg.sender, author)];
        if (v.voucher == address(0)) revert NoActiveVouch();

        _accrueAuthorRewards(author, v);
        uint256 claimable = v.pendingRewardsUsdcMicros;
        if (claimable == 0) revert NothingToClaim();

        AgentVouchTypes.AgentProfile storage ap = profiles[author];
        // checked_sub parity: claim can never exceed the author's unclaimed pool.
        ap.unclaimedVoucherRevenueUsdcMicros -= claimable;

        v.pendingRewardsUsdcMicros = 0;
        v.cumulativeRevenueUsdcMicros += claimable;
        v.lastPayoutAt = uint64(block.timestamp);

        usdc.safeTransfer(msg.sender, claimable);
        emit VoucherRevenueClaimed(msg.sender, author, claimable);
    }

    /// @notice Port of `withdraw_author_proceeds`. NOT paused-guarded (earned revenue,
    ///         treated like a claim). Blocked by settlement dispute lock and the
    ///         author-proceeds time lock (createdAt + authorProceedsLockSeconds).
    function withdrawAuthorProceeds(bytes32 id, uint64 revision, uint256 amount) external nonReentrant {
        AgentVouchTypes.SkillListing storage l = listings[id];
        if (!l.exists) revert ListingNotFound();
        if (l.author != msg.sender) revert NotListingAuthor();
        if (amount == 0) revert ZeroAmount();

        AgentVouchTypes.ListingSettlement storage s = settlements[id][revision];
        if (!s.initialized) revert SettlementNotInitialized();
        if (s.locked) revert SettlementLocked();
        // Hours/days-scale lock; a few seconds of validator timestamp drift is irrelevant.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < uint256(s.createdAt) + config.authorProceedsLockSeconds) {
            revert ProceedsTimeLocked();
        }
        if (amount > s.authorProceedsUsdcMicros) revert InsufficientProceeds();

        s.authorProceedsUsdcMicros -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit AuthorProceedsWithdrawn(id, revision, msg.sender, amount);
    }

    /// @dev Mirrors Solana `accrue_author_rewards`. Non-live vouches (Revoked/Slashed)
    ///      or zero-stake do not accrue (their stake left the reward-index denominator),
    ///      but already-accrued pending rewards stay claimable. Index only grows, so the
    ///      subtraction never underflows for a real entry.
    function _accrueAuthorRewards(address author, AgentVouchTypes.Vouch storage v) internal {
        uint256 authorIndex = profiles[author].rewardIndexUsdcMicrosX1e12;
        uint256 delta = authorIndex - v.entryRewardIndexUsdcMicrosX1e12;
        if (delta == 0 || v.stakeUsdcMicros == 0 || v.status != AgentVouchTypes.VouchStatus.Active) {
            v.entryRewardIndexUsdcMicrosX1e12 = authorIndex;
            return;
        }
        uint256 accrued = (v.stakeUsdcMicros * delta) / REWARD_INDEX_SCALE;
        v.pendingRewardsUsdcMicros += accrued;
        v.entryRewardIndexUsdcMicrosX1e12 = authorIndex;
    }

    // --- Id helpers (Solana seed concepts, not exposed as PDAs) ---

    function vouchId(address voucher, address vouchee) public pure returns (bytes32) {
        return keccak256(abi.encode(voucher, vouchee));
    }

    function listingId(address author, bytes32 skillIdHash) public pure returns (bytes32) {
        return keccak256(abi.encode(author, skillIdHash));
    }

    function purchaseId(address buyer, bytes32 id, uint64 revision) public pure returns (bytes32) {
        return keccak256(abi.encode(buyer, id, revision));
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

    function getPurchase(bytes32 pId) external view returns (AgentVouchTypes.Purchase memory) {
        return purchases[pId];
    }
}
