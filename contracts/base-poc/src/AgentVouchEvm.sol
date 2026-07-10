// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20ReceiveWithAuthorization} from "./interfaces/IERC20ReceiveWithAuthorization.sol";
import {AgentVouchTypes} from "./libraries/AgentVouchTypes.sol";

/// @title AgentVouchEvm (Base V1 candidate)
/// @notice Spec-port of AgentVouch's USDC-native protocol to Base/EVM. Decision
///         instrument only; Solana (`programs/agentvouch`) remains canonical.
/// @dev    No rent/ATA/PDA concepts: the contract custodies USDC and tracks every
///         balance as internal accounting. Authority is OpenZeppelin roles, not
///         config pubkeys. A single `Pausable` flag provides A3 parity. The exact
///         paused set mirrors the Solana `require!(!config.paused)` guards (verified
///         2026-06-22): blocked = deposit_author_bond, withdraw_author_bond, vouch,
///         create/update_skill_listing, purchase_skill, withdraw_author_proceeds,
///         open_dispute, x402 settle. Allowed while paused = register_agent,
///         revoke_vouch, remove_listing, claim_voucher_revenue, refund claims.
contract AgentVouchEvm is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    string public constant PROTOCOL_VERSION = "base-v1-a1-candidate";

    // Matches Solana REWARD_INDEX_SCALE (state/skill_listing.rs).
    uint256 internal constant REWARD_INDEX_SCALE = 1e12;
    uint256 internal constant MAX_LISTING_URI_BYTES = 256;
    uint256 internal constant MAX_LISTING_NAME_BYTES = 64;
    uint256 internal constant MAX_LISTING_DESCRIPTION_BYTES = 256;

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
    mapping(uint64 => AgentVouchTypes.AuthorReport) internal authorReports;
    // An A1 financial report consumes its initiating paid receipt permanently.
    mapping(bytes32 => uint64) public financialReportIdByPurchase;
    mapping(uint64 => mapping(address => bool)) internal reportVouchSlashed;
    mapping(uint64 => mapping(bytes32 => bool)) internal reportPurchaseRefunded;
    uint64 public nextAuthorReportId = 1;
    mapping(bytes32 => bool) public usedPaymentRefHash; // x402 payment-ref idempotency guard
    mapping(bytes32 => bool) public usedSettlementTxHash; // x402 settlement-tx idempotency guard

    event ProtocolVersionDeclared(string version);
    event ConfigInitialized(address indexed usdc, string chainContext);
    event PausedSet(address indexed by, bool paused);
    event AgentRegistered(address indexed agent, string metadataUri, uint64 registeredAt);
    event AuthorBondDeposited(address indexed author, uint256 amount, uint256 newBalance);
    event AuthorBondWithdrawn(address indexed author, uint256 amount, uint256 newBalance);
    event Vouched(address indexed voucher, address indexed vouchee, uint256 stake);
    event VouchRevoked(address indexed voucher, address indexed vouchee, uint256 returned);
    event SkillListingCreated(bytes32 indexed listingId, address indexed author, uint256 price, bool free);
    event SkillListingUpdated(
        bytes32 indexed listingId,
        address indexed author,
        uint64 revision,
        uint256 price,
        bool free,
        bool revisionChanged
    );
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
    event X402Settled(
        bytes32 indexed purchaseId,
        bytes32 indexed paymentRefHash,
        bytes32 settlementTxHash,
        address buyer,
        uint256 amount
    );
    event AuthorReportOpened(
        uint64 indexed reportId, address indexed reporter, address indexed author, uint256 bond, string evidenceUri
    );
    event AuthorReportResolved(
        uint64 indexed reportId,
        address indexed resolver,
        address indexed author,
        AgentVouchTypes.Ruling ruling,
        uint256 returnedReporterBond,
        uint256 forfeitedReporterBond,
        uint256 slashedAuthorBond
    );
    event FinancialReportOpened(
        uint64 indexed reportId,
        address indexed reporter,
        address indexed author,
        bytes32 listingId,
        bytes32 purchaseId,
        uint256 bond,
        string evidenceUri
    );
    event FinancialReportParked(
        uint64 indexed reportId,
        address indexed resolver,
        address indexed author,
        uint256 preSlashStake,
        uint256 authorBondReserve,
        uint8 slashPercentage
    );
    event FinancialReportVouchSlashed(
        uint64 indexed reportId,
        address indexed voucher,
        uint256 preSlashStake,
        uint256 slashAmount,
        uint256 processedPreSlashStake
    );
    event FinancialReportFinalized(
        uint64 indexed reportId,
        address indexed author,
        uint256 refundReserve,
        uint256 reporterRewardReserve,
        uint64 refundDeadline
    );
    event FinancialReportRefundClaimed(
        uint64 indexed reportId, bytes32 indexed purchaseId, address indexed buyer, uint256 amount
    );
    event FinancialReportReserveClosed(
        uint64 indexed reportId,
        address indexed treasuryRecipient,
        address indexed reporter,
        uint256 reporterReward,
        uint256 treasurySweep
    );

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
    error InvalidVouchee();
    error VouchAlreadyActive();
    error VouchSlashed();
    error NoActiveVouch();
    error ListingExists();
    error ListingNotFound();
    error NotListingAuthor();
    error EmptyListingUri();
    error EmptyListingName();
    error ListingUriTooLong();
    error ListingNameTooLong();
    error ListingDescriptionTooLong();
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
    error InvalidPaymentRef();
    error PaymentRefUsed();
    error SettlementTxUsed();
    error SettlementAmountMismatch();
    error ReportNotFound();
    error ReportNotOpen();
    error ReportNotSlashing();
    error InvalidAuthor();
    error InvalidFinancialReference();
    error FinancialReportAlreadyExists();
    error InvalidSlashVouch();
    error SlashStakeMismatch();
    error FinancialReportRequired();
    error RefundNotFunded();
    error RefundWindowExpired();
    error RefundWindowOpen();
    error RefundAlreadyClaimed();
    error PurchaseNotEligibleForRefund();
    error NoRefundAvailable();
    error RefundReserveClosed();

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
        emit ProtocolVersionDeclared(PROTOCOL_VERSION);
    }

    // --- Config & pause (initialize_config, set_paused) ---

    function initializeConfig(AgentVouchTypes.Config calldata cfg) external onlyRole(CONFIG_ROLE) {
        if (configInitialized) revert AlreadyInitialized();
        if (cfg.usdc != address(usdc)) revert UsdcMismatch();
        if (uint256(cfg.authorShareBps) + cfg.voucherShareBps + cfg.protocolFeeBps != 10_000) {
            revert BadEconomics();
        }
        // Protocol fees are reserved until purchaseSkill routes them to treasury.
        if (cfg.protocolFeeBps != 0) {
            revert BadEconomics();
        }
        if (
            cfg.slashPercentage > 100 || cfg.challengerRewardBps > 10_000 || cfg.refundClaimWindowSeconds == 0
                || cfg.treasuryRecipient == address(0)
        ) {
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
        if (vouchee == address(0) || vouchee == msg.sender) revert InvalidVouchee();
        if (stake < config.minVouchStakeUsdcMicros) revert BelowMinVouchStake();
        if (!profiles[msg.sender].registered) revert NotRegistered();
        // Solana parity: the vouchee_profile PDA must already exist (be registered).
        if (!profiles[vouchee].registered) revert NotRegistered();
        // Financial reports snapshot author-wide backing at resolution. New positions
        // must be blocked alongside the existing revoke exit lock so calldata-driven
        // cranks have a complete, frozen set to account for.
        if (profiles[vouchee].openDisputes > 0) revert DisputeLocked();

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
        // Do NOT reset pending here: a re-vouch after revoke must preserve rewards earned
        // before revoke (still counted in the author's unclaimed pool until claimed).
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
        if (v.voucher == address(0)) {
            revert NoActiveVouch();
        }
        AgentVouchTypes.AgentProfile storage vee = profiles[vouchee];
        if (vee.openDisputes > 0) revert DisputeLocked();

        uint256 stake = v.stakeUsdcMicros;
        if (v.status == AgentVouchTypes.VouchStatus.Active) {
            // Settle rewards earned up to now before the stake stops backing.
            _accrueAuthorRewards(vouchee, v);
            vee.totalVouchStakeReceivedUsdcMicros -= stake;
        } else if (v.status != AgentVouchTypes.VouchStatus.Slashed) {
            revert NoActiveVouch();
        }

        // A Slashed position's full pre-slash stake was removed from the author
        // aggregate during the crank. Its remaining stake is only a post-close
        // residual claim, so it must not decrement that aggregate a second time.
        v.status = AgentVouchTypes.VouchStatus.Revoked;
        v.stakeUsdcMicros = 0;
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

        _validateListingMetadata(uri, name, description);

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
        _initializeSettlement(id, 1);
        emit SkillListingCreated(id, msg.sender, priceUsdcMicros, free);
    }

    function updateSkillListing(
        bytes32 id,
        string calldata uri,
        string calldata name,
        string calldata description,
        uint256 priceUsdcMicros
    ) external returns (uint64 revision) {
        if (!configInitialized) revert NotInitialized();
        AgentVouchTypes.SkillListing storage l = listings[id];
        if (!l.exists) revert ListingNotFound();
        if (l.author != msg.sender) revert NotListingAuthor();
        AgentVouchTypes.AgentProfile storage p = profiles[msg.sender];
        if (!p.registered) revert NotRegistered();
        _requireNotPaused();
        if (l.status == AgentVouchTypes.ListingStatus.Removed) revert ListingNotActive();

        _validateListingMetadata(uri, name, description);

        bool wasFree = l.priceUsdcMicros == 0;
        bool free = priceUsdcMicros == 0;
        if (free) {
            if (p.authorBondUsdcMicros < config.minAuthorBondForFreeListingUsdcMicros) {
                revert FreeListingBondFloor();
            }
        } else if (priceUsdcMicros < config.minPaidListingPriceUsdcMicros) {
            revert BelowMinPaidPrice();
        }

        bool revisionChanged =
            keccak256(bytes(l.uri)) != keccak256(bytes(uri)) || l.priceUsdcMicros != priceUsdcMicros;
        if (revisionChanged) {
            if (l.lockedByDispute || p.openDisputes > 0) revert DisputeLocked();
            l.currentRevision += 1;
            _initializeSettlement(id, l.currentRevision);
        }

        if (wasFree && !free) {
            p.activeFreeListingCount -= 1;
        } else if (!wasFree && free) {
            p.activeFreeListingCount += 1;
        }

        l.uri = uri;
        l.name = name;
        l.description = description;
        l.priceUsdcMicros = priceUsdcMicros;

        revision = l.currentRevision;
        emit SkillListingUpdated(id, msg.sender, revision, priceUsdcMicros, free, revisionChanged);
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
    /// @notice Lane A — direct allowance-based purchase (smart-account/paymaster sponsors gas).
    function purchaseSkill(bytes32 id) external nonReentrant whenNotPaused returns (bytes32 pId) {
        AgentVouchTypes.SkillListing storage l = _purchasableListing(id);
        uint256 authorShare;
        uint256 voucherPool;
        (pId, authorShare, voucherPool) = _recordPurchase(id, l, msg.sender);
        // Effects written above; allowance pull last (CEI). Atomic: a failed pull reverts all.
        usdc.safeTransferFrom(msg.sender, address(this), authorShare + voucherPool);
    }

    /// @notice Lane B — x402, trust-minimized: the contract itself consumes the buyer's
    ///         EIP-3009 authorization to pull USDC and records the purchase in one tx, so
    ///         no settlement authority is trusted. The authorization nonce is bound to
    ///         `(buyer, listingId, revision, price)`, so a relayer cannot redirect a signed
    ///         payment to a different listing, and the token consumes the nonce (replay-safe).
    ///         Uses `receiveWithAuthorization` (caller-bound to the payee), so the signed
    ///         authorization cannot be submitted straight to the token to strand funds (F-1).
    function purchaseWithAuthorization(
        bytes32 id,
        address buyer,
        uint256 validAfter,
        uint256 validBefore,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused returns (bytes32 pId) {
        AgentVouchTypes.SkillListing storage l = _purchasableListing(id);
        uint256 price = l.priceUsdcMicros;
        bytes32 boundNonce = keccak256(abi.encode(buyer, id, l.currentRevision, price));

        (pId,,) = _recordPurchase(id, l, buyer);

        // Pull the buyer's funds via their signed EIP-3009 authorization (value == price).
        // receiveWithAuthorization requires msg.sender == to, so only this contract can consume
        // the authorization — it can't be replayed straight to the token to strand funds (F-1).
        IERC20ReceiveWithAuthorization(address(usdc))
            .receiveWithAuthorization(buyer, address(this), price, validAfter, validBefore, boundNonce, v, r, s);
    }

    /// @notice Lane C — bridge-equivalent: a SETTLEMENT_ROLE attests an off-chain x402
    ///         payment already delivered to this contract, then records the purchase with
    ///         payment-ref and settlement-tx idempotency guards.
    /// @dev    Trust note: the contract cannot read prior transfers, so this lane trusts
    ///         the settlement authority that `amount` actually arrived. Keep the role
    ///         narrow, monitored, and POC-bounded (see threat model).
    function settleX402Purchase(
        bytes32 id,
        address buyer,
        uint256 amount,
        bytes32 paymentRefHash,
        bytes32 settlementTxHash
    ) external onlyRole(SETTLEMENT_ROLE) nonReentrant whenNotPaused returns (bytes32 pId) {
        if (paymentRefHash == bytes32(0) || settlementTxHash == bytes32(0)) {
            revert InvalidPaymentRef();
        }
        if (usedPaymentRefHash[paymentRefHash]) revert PaymentRefUsed();
        if (usedSettlementTxHash[settlementTxHash]) revert SettlementTxUsed();

        AgentVouchTypes.SkillListing storage l = _purchasableListing(id);
        if (amount != l.priceUsdcMicros) revert SettlementAmountMismatch();

        usedPaymentRefHash[paymentRefHash] = true;
        usedSettlementTxHash[settlementTxHash] = true;
        // No pull: funds are assumed already delivered to the contract by the facilitator.
        (pId,,) = _recordPurchase(id, l, buyer);
        emit X402Settled(pId, paymentRefHash, settlementTxHash, buyer, amount);
    }

    // --- Reports (legacy reputation-only + A1 financial lifecycle) ---

    /// @notice Opens the legacy reputation-only author report. Its selector and
    ///         `AuthorReportOpened` event shape are intentionally unchanged for
    ///         the browser/passkey path. Financial reports use openFinancialReport.
    function openReport(address author, string calldata evidenceUri)
        external
        nonReentrant
        whenNotPaused
        returns (uint64 reportId)
    {
        uint256 bond = _validateReportOpen(author, evidenceUri);
        reportId = _createReport(author, evidenceUri, bond, false);
        emit AuthorReportOpened(reportId, msg.sender, author, bond, evidenceUri);
    }

    /// @notice Opens a paid-purchase-backed report which can later park and
    ///         permissionlessly slash the author's frozen, author-wide vouch set.
    ///         Both references are mandatory and the receipt is consumed forever.
    function openFinancialReport(
        address author,
        bytes32 listingId_,
        bytes32 purchaseId_,
        string calldata evidenceUri
    ) external nonReentrant whenNotPaused returns (uint64 reportId) {
        uint256 bond = _validateReportOpen(author, evidenceUri);
        if (listingId_ == bytes32(0) || purchaseId_ == bytes32(0)) revert InvalidFinancialReference();

        AgentVouchTypes.SkillListing storage listing = listings[listingId_];
        AgentVouchTypes.Purchase storage purchase = purchases[purchaseId_];
        if (
            !listing.exists || listing.author != author || !purchase.exists || purchase.buyer != msg.sender
                || purchase.listingId != listingId_ || purchase.priceUsdcMicros == 0
                || financialReportIdByPurchase[purchaseId_] != 0
        ) {
            revert InvalidFinancialReference();
        }

        reportId = _createReport(author, evidenceUri, bond, true);
        AgentVouchTypes.AuthorReport storage report = authorReports[reportId];
        report.listingId = listingId_;
        report.purchaseId = purchaseId_;
        report.rewardSettlementRevision = purchase.revision;
        financialReportIdByPurchase[purchaseId_] = reportId;
        // Lock on open, not upheld: this freezes purchase exposure, removal,
        // revision bumps, and every revision's author-proceeds withdrawal.
        listing.lockedByDispute = true;

        emit FinancialReportOpened(reportId, msg.sender, author, listingId_, purchaseId_, bond, evidenceUri);
    }

    /// @notice Resolves a report. Legacy reports keep the PR #78 payout behavior.
    ///         Financial upheld reports park in SlashingVouchers while the reporter
    ///         bond returns and the author-bond first loss joins the refund reserve.
    /// @dev Intentionally callable while paused so incident response can progress
    ///      locked reports without reopening the market.
    function resolveReport(uint64 reportId, AgentVouchTypes.Ruling ruling, bool forfeitReporterBond)
        external
        onlyRole(RESOLVER_ROLE)
        nonReentrant
        returns (uint256 returnedReporterBond, uint256 forfeitedReporterBond, uint256 slashedAuthorBond)
    {
        AgentVouchTypes.AuthorReport storage report = authorReports[reportId];
        if (!report.exists) revert ReportNotFound();
        if (report.status != AgentVouchTypes.ReportStatus.Open) revert ReportNotOpen();

        if (!report.financial) {
            return _resolveLegacyReport(reportId, report, ruling, forfeitReporterBond);
        }
        return _resolveFinancialReport(reportId, report, ruling, forfeitReporterBond);
    }

    /// @notice Permissionlessly accounts and slashes supplied live vouches for a
    ///         parked financial report. Calls remain available while paused.
    function slashReportVouches(uint64 reportId, address[] calldata vouchers) external nonReentrant {
        AgentVouchTypes.AuthorReport storage report = authorReports[reportId];
        if (!report.exists) revert ReportNotFound();
        if (report.status != AgentVouchTypes.ReportStatus.SlashingVouchers) revert ReportNotSlashing();

        for (uint256 i; i < vouchers.length; ++i) {
            address voucher = vouchers[i];
            // Duplicate/retry calldata is explicitly idempotent: it cannot alter
            // completeness or move slash funds a second time.
            if (reportVouchSlashed[reportId][voucher]) continue;

            AgentVouchTypes.Vouch storage v = vouches[vouchId(voucher, report.author)];
            if (
                v.voucher != voucher || v.vouchee != report.author || v.status != AgentVouchTypes.VouchStatus.Active
                    || v.stakeUsdcMicros == 0
            ) {
                revert InvalidSlashVouch();
            }

            // Accrue while the position is Active; Slashed positions never accrue
            // future reward-index deltas.
            _accrueAuthorRewards(report.author, v);
            uint256 preSlashStake = v.stakeUsdcMicros;
            if (report.processedPreSlashStakeUsdcMicros + preSlashStake > report.snapshottedPreSlashStakeUsdcMicros) {
                revert SlashStakeMismatch();
            }
            uint256 slashAmount = Math.mulDiv(preSlashStake, report.snapshottedSlashPercentage, 100);

            reportVouchSlashed[reportId][voucher] = true;
            report.processedPreSlashStakeUsdcMicros += preSlashStake;
            report.slashedVouchStakeUsdcMicros += slashAmount;
            report.refundReserveUsdcMicros += slashAmount;
            report.refundRemainingUsdcMicros += slashAmount;

            AgentVouchTypes.AgentProfile storage authorProfile = profiles[report.author];
            authorProfile.totalVouchStakeReceivedUsdcMicros -= preSlashStake;
            authorProfile.totalVouchStakeSlashedUsdcMicros += slashAmount;
            // Retain only the residual for the post-close Slashed -> Revoked claim.
            v.stakeUsdcMicros = preSlashStake - slashAmount;
            v.status = AgentVouchTypes.VouchStatus.Slashed;

            emit FinancialReportVouchSlashed(
                reportId, voucher, preSlashStake, slashAmount, report.processedPreSlashStakeUsdcMicros
            );
        }

        if (report.processedPreSlashStakeUsdcMicros == report.snapshottedPreSlashStakeUsdcMicros) {
            _finalizeFinancialReport(reportId, report);
        }
    }

    /// @notice Claims the report-scoped refund reserve for one eligible paid
    ///         purchase. Claims do not need the listing to remain purchasable and
    ///         remain open while paused.
    function claimFinancialReportRefund(uint64 reportId, bytes32 purchaseId_) external nonReentrant {
        AgentVouchTypes.AuthorReport storage report = authorReports[reportId];
        if (!report.exists) revert ReportNotFound();
        if (!report.financial || report.ruling != AgentVouchTypes.Ruling.Upheld) revert FinancialReportRequired();
        if (report.refundFundedAt == 0 || report.refundReserveClosed) revert RefundNotFunded();
        if (block.timestamp > report.refundDeadline) revert RefundWindowExpired();
        if (reportPurchaseRefunded[reportId][purchaseId_]) revert RefundAlreadyClaimed();

        AgentVouchTypes.Purchase storage purchase = purchases[purchaseId_];
        if (
            !purchase.exists || purchase.buyer != msg.sender || purchase.listingId != report.listingId
                || purchase.priceUsdcMicros == 0 || purchase.timestamp > report.openedAt
        ) {
            revert PurchaseNotEligibleForRefund();
        }
        if (report.refundRemainingUsdcMicros == 0) revert NoRefundAvailable();

        uint256 amount = purchase.priceUsdcMicros;
        if (amount > report.refundRemainingUsdcMicros) amount = report.refundRemainingUsdcMicros;
        reportPurchaseRefunded[reportId][purchaseId_] = true;
        report.refundRemainingUsdcMicros -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit FinancialReportRefundClaimed(reportId, purchaseId_, msg.sender, amount);
    }

    /// @notice Closes an expired financial reserve exactly once. The reporter
    ///         reward was reserved before listing unlock; all unclaimed refund
    ///         funds go only to immutable config.treasuryRecipient, never caller.
    function closeFinancialReportReserve(uint64 reportId) external nonReentrant {
        AgentVouchTypes.AuthorReport storage report = authorReports[reportId];
        if (!report.exists) revert ReportNotFound();
        if (!report.financial || report.ruling != AgentVouchTypes.Ruling.Upheld) revert FinancialReportRequired();
        if (report.refundFundedAt == 0) revert RefundNotFunded();
        if (report.refundReserveClosed) revert RefundReserveClosed();
        if (block.timestamp <= report.refundDeadline) revert RefundWindowOpen();

        uint256 reporterReward = report.reporterRewardReserveUsdcMicros;
        uint256 treasurySweep = report.refundRemainingUsdcMicros;
        report.refundReserveClosed = true;
        report.reporterRewardReserveUsdcMicros = 0;
        report.refundRemainingUsdcMicros = 0;
        if (reporterReward > 0) usdc.safeTransfer(report.reporter, reporterReward);
        if (treasurySweep > 0) usdc.safeTransfer(config.treasuryRecipient, treasurySweep);
        emit FinancialReportReserveClosed(
            reportId, config.treasuryRecipient, report.reporter, reporterReward, treasurySweep
        );
    }

    function _validateReportOpen(address author, string calldata evidenceUri) internal view returns (uint256 bond) {
        if (!configInitialized) revert NotInitialized();
        if (author == address(0) || author == msg.sender) revert InvalidAuthor();
        if (bytes(evidenceUri).length == 0) revert EmptyMetadata();
        if (!profiles[msg.sender].registered || !profiles[author].registered) revert NotRegistered();
        // All bond-exposing reports serialize author-wide slash snapshots.
        if (profiles[author].openDisputes > 0) revert DisputeLocked();
        bond = config.disputeBondUsdcMicros;
        if (bond == 0) revert ZeroAmount();
    }

    function _createReport(address author, string calldata evidenceUri, uint256 bond, bool financial)
        internal
        returns (uint64 reportId)
    {
        reportId = nextAuthorReportId++;
        AgentVouchTypes.AuthorReport storage report = authorReports[reportId];
        report.exists = true;
        report.reporter = msg.sender;
        report.author = author;
        report.evidenceUri = evidenceUri;
        report.bondUsdcMicros = bond;
        report.status = AgentVouchTypes.ReportStatus.Open;
        report.ruling = AgentVouchTypes.Ruling.Dismissed;
        report.openedAt = uint64(block.timestamp);
        report.financial = financial;
        profiles[author].openDisputes += 1;
        // Effects before the USDC pull; a failed transfer reverts the full record.
        usdc.safeTransferFrom(msg.sender, address(this), bond);
    }

    function _resolveLegacyReport(
        uint64 reportId,
        AgentVouchTypes.AuthorReport storage report,
        AgentVouchTypes.Ruling ruling,
        bool forfeitReporterBond
    ) internal returns (uint256 returnedReporterBond, uint256 forfeitedReporterBond, uint256 slashedAuthorBond) {
        AgentVouchTypes.AgentProfile storage authorProfile = profiles[report.author];
        report.status = AgentVouchTypes.ReportStatus.Resolved;
        report.ruling = ruling;
        report.resolvedAt = uint64(block.timestamp);
        authorProfile.openDisputes -= 1;

        if (ruling == AgentVouchTypes.Ruling.Dismissed && forfeitReporterBond) {
            forfeitedReporterBond = report.bondUsdcMicros;
            report.forfeitedReporterBondUsdcMicros = forfeitedReporterBond;
        } else {
            returnedReporterBond = report.bondUsdcMicros;
        }
        report.bondUsdcMicros = 0;

        if (ruling == AgentVouchTypes.Ruling.Upheld) {
            authorProfile.upheldDisputes += 1;
            slashedAuthorBond = _slashAuthorBond(authorProfile);
            report.slashedAuthorBondUsdcMicros = slashedAuthorBond;
        } else {
            authorProfile.dismissedDisputes += 1;
        }

        uint256 reporterPayout = returnedReporterBond + slashedAuthorBond;
        if (reporterPayout > 0) usdc.safeTransfer(report.reporter, reporterPayout);
        if (forfeitedReporterBond > 0) usdc.safeTransfer(report.author, forfeitedReporterBond);
        emit AuthorReportResolved(
            reportId, msg.sender, report.author, ruling, returnedReporterBond, forfeitedReporterBond, slashedAuthorBond
        );
    }

    function _resolveFinancialReport(
        uint64 reportId,
        AgentVouchTypes.AuthorReport storage report,
        AgentVouchTypes.Ruling ruling,
        bool forfeitReporterBond
    ) internal returns (uint256 returnedReporterBond, uint256 forfeitedReporterBond, uint256 slashedAuthorBond) {
        AgentVouchTypes.AgentProfile storage authorProfile = profiles[report.author];
        if (ruling == AgentVouchTypes.Ruling.Dismissed) {
            report.status = AgentVouchTypes.ReportStatus.Resolved;
            report.ruling = ruling;
            report.resolvedAt = uint64(block.timestamp);
            report.finalizedAt = uint64(block.timestamp);
            authorProfile.openDisputes -= 1;
            authorProfile.dismissedDisputes += 1;
            listings[report.listingId].lockedByDispute = false;
            if (forfeitReporterBond) {
                forfeitedReporterBond = report.bondUsdcMicros;
                report.forfeitedReporterBondUsdcMicros = forfeitedReporterBond;
            } else {
                returnedReporterBond = report.bondUsdcMicros;
            }
            report.bondUsdcMicros = 0;
            if (returnedReporterBond > 0) usdc.safeTransfer(report.reporter, returnedReporterBond);
            if (forfeitedReporterBond > 0) usdc.safeTransfer(report.author, forfeitedReporterBond);
            emit AuthorReportResolved(
                reportId, msg.sender, report.author, ruling, returnedReporterBond, forfeitedReporterBond, 0
            );
            return (returnedReporterBond, forfeitedReporterBond, 0);
        }

        returnedReporterBond = report.bondUsdcMicros;
        report.bondUsdcMicros = 0;
        report.ruling = AgentVouchTypes.Ruling.Upheld;
        report.parkedAt = uint64(block.timestamp);
        report.snapshottedSlashPercentage = config.slashPercentage;
        report.snapshottedChallengerRewardBps = config.challengerRewardBps;
        report.snapshottedChallengerRewardCapUsdcMicros = config.challengerRewardCapUsdcMicros;
        report.snapshottedPreSlashStakeUsdcMicros = authorProfile.totalVouchStakeReceivedUsdcMicros;
        slashedAuthorBond = _slashAuthorBond(authorProfile);
        report.slashedAuthorBondUsdcMicros = slashedAuthorBond;
        report.refundReserveUsdcMicros = slashedAuthorBond;
        report.refundRemainingUsdcMicros = slashedAuthorBond;

        if (report.snapshottedPreSlashStakeUsdcMicros == 0) {
            _finalizeFinancialReport(reportId, report);
        } else {
            report.status = AgentVouchTypes.ReportStatus.SlashingVouchers;
            emit FinancialReportParked(
                reportId,
                msg.sender,
                report.author,
                report.snapshottedPreSlashStakeUsdcMicros,
                slashedAuthorBond,
                report.snapshottedSlashPercentage
            );
        }
        if (returnedReporterBond > 0) usdc.safeTransfer(report.reporter, returnedReporterBond);
    }

    function _slashAuthorBond(AgentVouchTypes.AgentProfile storage authorProfile) internal returns (uint256 amount) {
        amount = authorProfile.authorBondUsdcMicros;
        if (amount > config.disputeBondUsdcMicros) amount = config.disputeBondUsdcMicros;
        if (amount > 0) authorProfile.authorBondUsdcMicros -= amount;
    }

    function _finalizeFinancialReport(uint64 reportId, AgentVouchTypes.AuthorReport storage report) internal {
        if (report.processedPreSlashStakeUsdcMicros != report.snapshottedPreSlashStakeUsdcMicros) {
            revert SlashStakeMismatch();
        }
        uint256 deadline = block.timestamp + config.refundClaimWindowSeconds;
        if (deadline > type(uint64).max) revert BadEconomics();

        // The eligible O(1) reward source is the initiating purchase's revision.
        // It is debited before clearing the listing lock, so the author cannot
        // withdraw it between final crank and the buyer-first claim window.
        AgentVouchTypes.ListingSettlement storage settlement = settlements[report.listingId][report.rewardSettlementRevision];
        uint256 totalSlashed = report.slashedAuthorBondUsdcMicros + report.slashedVouchStakeUsdcMicros;
        uint256 reporterReward = Math.mulDiv(totalSlashed, report.snapshottedChallengerRewardBps, 10_000);
        if (reporterReward > report.snapshottedChallengerRewardCapUsdcMicros) {
            reporterReward = report.snapshottedChallengerRewardCapUsdcMicros;
        }
        if (reporterReward > settlement.authorProceedsUsdcMicros) reporterReward = settlement.authorProceedsUsdcMicros;
        if (reporterReward > 0) settlement.authorProceedsUsdcMicros -= reporterReward;

        uint64 finalizedAt = uint64(block.timestamp);
        report.reporterRewardReserveUsdcMicros = reporterReward;
        report.refundFundedAt = finalizedAt;
        report.refundDeadline = uint64(deadline);
        report.finalizedAt = finalizedAt;
        report.resolvedAt = finalizedAt;
        report.status = AgentVouchTypes.ReportStatus.Resolved;
        listings[report.listingId].lockedByDispute = false;

        AgentVouchTypes.AgentProfile storage authorProfile = profiles[report.author];
        authorProfile.openDisputes -= 1;
        authorProfile.upheldDisputes += 1;
        authorProfile.slashingReportCount += 1;
        emit FinancialReportFinalized(
            reportId, report.author, report.refundReserveUsdcMicros, reporterReward, report.refundDeadline
        );
    }

    /// @dev Validates a listing is purchasable (exists, active, not dispute-locked, paid).
    function _purchasableListing(bytes32 id) internal view returns (AgentVouchTypes.SkillListing storage l) {
        l = listings[id];
        if (!l.exists) revert ListingNotFound();
        if (l.status != AgentVouchTypes.ListingStatus.Active) revert ListingNotActive();
        if (l.lockedByDispute) revert DisputeLocked();
        if (l.priceUsdcMicros == 0) revert FreeSkillNotPurchased();
    }

    /// @dev Shared accounting for every purchase lane: validates the settlement, guards
    ///      duplicate receipts, splits by backing, advances the author-wide reward index,
    ///      and writes the revision-scoped receipt. Does NOT move USDC — each lane moves
    ///      its own funds (Lane A/B pull; Lane C assumes prior delivery).
    function _recordPurchase(bytes32 id, AgentVouchTypes.SkillListing storage l, address buyer)
        internal
        returns (bytes32 pId, uint256 authorShare, uint256 voucherPool)
    {
        if (buyer == address(0)) revert ZeroAddress();
        uint64 revision = l.currentRevision;
        AgentVouchTypes.ListingSettlement storage s = settlements[id][revision];
        if (!s.initialized) revert SettlementNotInitialized();
        if (l.lockedByDispute) revert DisputeLocked();
        if (s.locked) revert SettlementLocked();

        pId = purchaseId(buyer, id, revision);
        if (purchases[pId].exists) revert DuplicatePurchase();

        uint256 price = l.priceUsdcMicros;
        address author = l.author;
        uint256 activeVouchStake = profiles[author].totalVouchStakeReceivedUsdcMicros;
        if (activeVouchStake > 0) {
            voucherPool = (price * config.voucherShareBps) / 10_000;
            if (voucherPool == 0) revert VoucherPoolTooSmall();
            // Author takes the remainder so authorShare + voucherPool == price exactly:
            // no stranded rounding dust, and every lane pulls/credits the listing price.
            // (Solana floors both shares independently and strands <=1 micro; the POC
            // routes that micro to the author instead — a documented, sub-cent divergence.)
            authorShare = price - voucherPool;
        } else {
            authorShare = price;
            voucherPool = 0;
        }

        purchases[pId] = AgentVouchTypes.Purchase({
            exists: true,
            buyer: buyer,
            listingId: id,
            revision: revision,
            priceUsdcMicros: price,
            authorShareUsdcMicros: authorShare,
            voucherPoolUsdcMicros: voucherPool,
            timestamp: uint64(block.timestamp)
        });

        s.authorProceedsUsdcMicros += authorShare;
        s.updatedAt = uint64(block.timestamp); // rolling proceeds lock resets each sale (Solana parity)
        l.totalDownloads += 1;
        l.totalRevenueUsdcMicros += price;

        if (voucherPool > 0) {
            uint256 indexDelta = (voucherPool * REWARD_INDEX_SCALE) / activeVouchStake;
            if (indexDelta == 0) revert VoucherPoolTooSmall();
            AgentVouchTypes.AgentProfile storage ap = profiles[author];
            ap.rewardIndexUsdcMicrosX1e12 += indexDelta;
            ap.unclaimedVoucherRevenueUsdcMicros += voucherPool;
        }

        emit SkillPurchased(pId, id, buyer, revision, price, authorShare, voucherPool);
    }

    function _validateListingMetadata(string calldata uri, string calldata name, string calldata description)
        internal
        pure
    {
        uint256 uriLength = bytes(uri).length;
        if (uriLength == 0) revert EmptyListingUri();
        if (uriLength > MAX_LISTING_URI_BYTES) revert ListingUriTooLong();
        uint256 nameLength = bytes(name).length;
        if (nameLength == 0) revert EmptyListingName();
        if (nameLength > MAX_LISTING_NAME_BYTES) revert ListingNameTooLong();
        if (bytes(description).length > MAX_LISTING_DESCRIPTION_BYTES) {
            revert ListingDescriptionTooLong();
        }
    }

    function _initializeSettlement(bytes32 id, uint64 revision) internal {
        AgentVouchTypes.ListingSettlement storage s = settlements[id][revision];
        s.initialized = true;
        s.createdAt = uint64(block.timestamp);
        s.updatedAt = uint64(block.timestamp);
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

    /// @notice Port of `withdraw_author_proceeds`. Paused-guarded (Solana blocks this
    ///         author-side collateral exit while paused). Also blocked by the settlement
    ///         dispute lock and the rolling proceeds time lock (updatedAt + authorProceedsLockSeconds).
    function withdrawAuthorProceeds(bytes32 id, uint64 revision, uint256 amount) external nonReentrant whenNotPaused {
        AgentVouchTypes.SkillListing storage l = listings[id];
        if (!l.exists) revert ListingNotFound();
        if (l.author != msg.sender) revert NotListingAuthor();
        // Financial reports lock the listing at open (before an upheld ruling)
        // so every revision's proceeds remain available for the snapshotted
        // reporter-reward source until the report reaches a terminal path.
        if (l.lockedByDispute) revert DisputeLocked();
        if (amount == 0) revert ZeroAmount();

        AgentVouchTypes.ListingSettlement storage s = settlements[id][revision];
        if (!s.initialized) revert SettlementNotInitialized();
        if (s.locked) revert SettlementLocked();
        // Rolling lock measured from the last purchase (updatedAt), matching Solana.
        // Hours/days-scale lock; a few seconds of validator timestamp drift is irrelevant.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < uint256(s.updatedAt) + config.authorProceedsLockSeconds) {
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

    /// @notice Preserves the pre-A1 getConfig ABI for current and rollback
    ///         candidates. A1-only config is exposed by getA1TreasuryRecipient.
    function getConfig() external view returns (AgentVouchTypes.LegacyConfig memory legacy) {
        AgentVouchTypes.Config storage c = config;
        return AgentVouchTypes.LegacyConfig({
            usdc: c.usdc,
            chainContext: c.chainContext,
            minVouchStakeUsdcMicros: c.minVouchStakeUsdcMicros,
            disputeBondUsdcMicros: c.disputeBondUsdcMicros,
            minAuthorBondForFreeListingUsdcMicros: c.minAuthorBondForFreeListingUsdcMicros,
            minPaidListingPriceUsdcMicros: c.minPaidListingPriceUsdcMicros,
            authorShareBps: c.authorShareBps,
            voucherShareBps: c.voucherShareBps,
            protocolFeeBps: c.protocolFeeBps,
            slashPercentage: c.slashPercentage,
            authorProceedsLockSeconds: c.authorProceedsLockSeconds,
            refundClaimWindowSeconds: c.refundClaimWindowSeconds,
            challengerRewardBps: c.challengerRewardBps,
            challengerRewardCapUsdcMicros: c.challengerRewardCapUsdcMicros,
            stakeWeightPerUsdc: c.stakeWeightPerUsdc,
            riskComponentCap: c.riskComponentCap,
            vouchWeight: c.vouchWeight,
            vouchComponentCap: c.vouchComponentCap,
            longevityBonusPerDay: c.longevityBonusPerDay,
            longevityComponentCap: c.longevityComponentCap,
            upheldDisputePenalty: c.upheldDisputePenalty,
            reputationScoreCap: c.reputationScoreCap
        });
    }

    function getA1TreasuryRecipient() external view returns (address) {
        return config.treasuryRecipient;
    }

    /// @notice Preserves the pre-A1 getProfile tuple. Aggregate A1 slash history
    ///         is available through getA1ProfileStats without archive log scans.
    function getProfile(address agent) external view returns (AgentVouchTypes.LegacyAgentProfile memory legacy) {
        AgentVouchTypes.AgentProfile storage p = profiles[agent];
        return AgentVouchTypes.LegacyAgentProfile({
            registered: p.registered,
            metadataUri: p.metadataUri,
            reputationScore: p.reputationScore,
            totalVouchesReceived: p.totalVouchesReceived,
            totalVouchesGiven: p.totalVouchesGiven,
            totalVouchStakeReceivedUsdcMicros: p.totalVouchStakeReceivedUsdcMicros,
            authorBondUsdcMicros: p.authorBondUsdcMicros,
            activeFreeListingCount: p.activeFreeListingCount,
            openDisputes: p.openDisputes,
            upheldDisputes: p.upheldDisputes,
            dismissedDisputes: p.dismissedDisputes,
            rewardIndexUsdcMicrosX1e12: p.rewardIndexUsdcMicrosX1e12,
            unclaimedVoucherRevenueUsdcMicros: p.unclaimedVoucherRevenueUsdcMicros,
            registeredAt: p.registeredAt
        });
    }

    function getA1ProfileStats(address agent) external view returns (AgentVouchTypes.A1ProfileStats memory) {
        AgentVouchTypes.AgentProfile storage p = profiles[agent];
        return AgentVouchTypes.A1ProfileStats({
            slashingReportCount: p.slashingReportCount,
            totalVouchStakeSlashedUsdcMicros: p.totalVouchStakeSlashedUsdcMicros
        });
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

    /// @notice Preserves the legacy author-report tuple and event consumers.
    function getAuthorReport(uint64 reportId) external view returns (AgentVouchTypes.LegacyAuthorReport memory legacy) {
        AgentVouchTypes.AuthorReport storage r = authorReports[reportId];
        return AgentVouchTypes.LegacyAuthorReport({
            exists: r.exists,
            reporter: r.reporter,
            author: r.author,
            evidenceUri: r.evidenceUri,
            bondUsdcMicros: r.bondUsdcMicros,
            forfeitedReporterBondUsdcMicros: r.forfeitedReporterBondUsdcMicros,
            slashedAuthorBondUsdcMicros: r.slashedAuthorBondUsdcMicros,
            status: r.status,
            ruling: r.ruling,
            openedAt: r.openedAt,
            resolvedAt: r.resolvedAt
        });
    }

    function getFinancialReport(uint64 reportId) external view returns (AgentVouchTypes.AuthorReport memory) {
        return authorReports[reportId];
    }

    function isReportVouchSlashed(uint64 reportId, address voucher) external view returns (bool) {
        return reportVouchSlashed[reportId][voucher];
    }

    function hasFinancialReportRefund(uint64 reportId, bytes32 purchaseId_) external view returns (bool) {
        return reportPurchaseRefunded[reportId][purchaseId_];
    }
}
