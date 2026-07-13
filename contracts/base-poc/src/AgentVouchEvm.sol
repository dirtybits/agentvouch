// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20ReceiveWithAuthorization} from "./interfaces/IERC20ReceiveWithAuthorization.sol";
import {AgentVouchTypes} from "./libraries/AgentVouchTypes.sol";
import {PaidPurchaseSettlement} from "./libraries/PaidPurchaseSettlement.sol";

/// @title AgentVouchEvm (Base v1 A1 candidate)
/// @notice USDC-native AgentVouch protocol candidate for Base Sepolia. Its clean-break
///         A1 surface supports only paid-purchase reports; generic author reports are
///         intentionally absent.
/// @dev    No rent/ATA/PDA concepts: this facade owns all protocol storage and USDC
///         custody. OpenZeppelin roles provide authority, and the immutable linked
///         PaidPurchaseSettlement library executes terminal A1 accounting in this
///         contract's storage context. Pause blocks market entry and report acceptance
///         while terminal settlement, claims, and residual exits remain live.
contract AgentVouchEvm is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    string public constant PROTOCOL_VERSION = "base-v1-a1";

    // Matches Solana REWARD_INDEX_SCALE (state/skill_listing.rs).
    uint256 internal constant REWARD_INDEX_SCALE = 1e12;
    uint256 internal constant MAX_LISTING_URI_BYTES = 256;
    uint256 internal constant MAX_LISTING_NAME_BYTES = 64;
    uint256 internal constant MAX_LISTING_DESCRIPTION_BYTES = 256;
    uint256 internal constant MAX_REPORT_EVIDENCE_URI_BYTES = 256;
    uint256 internal constant PURCHASE_REPORT_WINDOW = 7 days;
    uint256 internal constant REPORT_REVIEW_WINDOW = 3 days;
    uint256 internal constant REPORT_BOND_USDC_MICROS = 5_000_000;

    // --- Roles (replace Solana Config authority pubkeys) ---
    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");
    bytes32 public constant RESOLVER_ROLE = keccak256("RESOLVER_ROLE");
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
    mapping(address => uint256) internal voucherRevenuePendingDistributionUsdcMicros;
    mapping(address => uint256) internal voucherRevenueRoundingAuthorProceedsUsdcMicros;
    AgentVouchTypes.PaidPurchaseState internal paidPurchaseState;
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
    event PaidPurchaseReportOpened(
        uint64 indexed reportId,
        address indexed buyer,
        address indexed author,
        bytes32 listingId,
        bytes32 purchaseId,
        uint256 bond,
        uint64 reviewDeadline,
        string evidenceUri
    );
    event PaidPurchaseReportAccepted(
        uint64 indexed reportId, address indexed resolver, address indexed author, uint64 acceptedAt
    );
    event PaidPurchaseReportRejected(
        uint64 indexed reportId,
        address indexed resolver,
        address indexed buyer,
        uint256 reserveCredit,
        uint64 buyerCooldownUntil
    );
    event PaidPurchaseReportExpired(
        uint64 indexed reportId,
        address indexed buyer,
        address indexed author,
        uint256 buyerCredit,
        uint64 claimDeadline,
        uint64 authorCooldownUntil
    );
    event PaidPurchaseReportParked(
        uint64 indexed reportId,
        address indexed resolver,
        address indexed author,
        uint8 slashPercentage,
        uint256 activeVouchStake,
        uint256 authorBondSlash
    );
    event PaidPurchaseReportVouchSlashed(
        uint64 indexed reportId,
        address indexed voucher,
        uint256 preSlashStake,
        uint256 slashAmount,
        uint256 processedPreSlashStake
    );
    event PaidPurchaseReportDismissed(
        uint64 indexed reportId,
        address indexed resolver,
        address indexed author,
        uint256 reserveCredit,
        uint64 buyerCooldownUntil
    );
    event PaidPurchaseReportFinalized(
        uint64 indexed reportId,
        address indexed author,
        address indexed buyer,
        uint256 buyerEntitlement,
        uint256 buyerCredit,
        uint256 reserveCredit,
        uint64 claimDeadline
    );
    event PaidPurchaseReportCreditClaimed(uint64 indexed reportId, address indexed buyer, uint256 amount);
    event PaidPurchaseReportCreditExpired(uint64 indexed reportId, uint256 reserveCredit);
    event RestitutionReserveClaimed(address indexed recipient, uint256 amount);

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
    error PaidPurchaseReportNotFound();
    error PaidPurchaseReportInvalidState();
    error PaidPurchaseReceiptIneligible();
    error PaidPurchaseReceiptConsumed();
    error PaidPurchaseBuyerBusy();
    error PaidPurchaseListingBusy();
    error PaidPurchaseAuthorBusy();
    error PaidPurchaseBuyerCooldown();
    error PaidPurchaseAuthorCooldown();
    error PaidPurchaseReviewExpired();
    error PaidPurchaseReviewOpen();
    error PaidPurchaseEvidenceTooLong();
    error PaidPurchaseSlashPageTooLarge();
    error PaidPurchaseSlashSnapshotIncomplete();
    error PaidPurchaseCreditNotFunded();
    error PaidPurchaseCreditExpired();
    error PaidPurchaseCreditOpen();
    error PaidPurchaseCreditAlreadyHandled();
    error PurchaseLaneIneligible();

    /// @param usdc_ 6-decimal USDC token on the target Base network.
    /// @param admin holder of every role for the POC (a multisig/timelock in prod).
    constructor(address usdc_, address admin) {
        if (usdc_ == address(0) || admin == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CONFIG_ROLE, admin);
        _grantRole(RESOLVER_ROLE, admin);
        _grantRole(SETTLEMENT_ROLE, admin);
        _grantRole(PAUSE_ROLE, admin);
        emit ProtocolVersionDeclared(PROTOCOL_VERSION);
    }

    // --- Config & pause (initialize_config, set_paused) ---

    function initializeConfig(AgentVouchTypes.Config calldata cfg) external onlyRole(CONFIG_ROLE) {
        if (configInitialized) revert AlreadyInitialized();
        if (cfg.usdc != address(usdc)) revert UsdcMismatch();
        if (
            block.chainid != 84532 || keccak256(bytes(cfg.chainContext)) != keccak256("eip155:84532")
                || cfg.minVouchStakeUsdcMicros != 1_000_000 || cfg.disputeBondUsdcMicros != REPORT_BOND_USDC_MICROS
                || cfg.minAuthorBondForFreeListingUsdcMicros != 1_000_000 || cfg.minPaidListingPriceUsdcMicros != 10_000
                || cfg.authorShareBps != 6_000 || cfg.voucherShareBps != 4_000 || cfg.protocolFeeBps != 0
                || cfg.slashPercentage == 0 || cfg.slashPercentage > 100 || cfg.refundClaimWindowSeconds != 7 days
                || cfg.challengerRewardBps != 0 || cfg.challengerRewardCapUsdcMicros != 0
                || cfg.treasuryRecipient == address(0)
        ) revert BadEconomics();
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
        // Paid-purchase reports snapshot author-wide backing at resolution. New positions
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
        uint256 stake = PaidPurchaseSettlement.exitVouch(
            profiles,
            vouches,
            voucherRevenuePendingDistributionUsdcMicros,
            voucherRevenueRoundingAuthorProceedsUsdcMicros,
            msg.sender,
            vouchee
        );
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

        bool revisionChanged = keccak256(bytes(l.uri)) != keccak256(bytes(uri)) || l.priceUsdcMicros != priceUsdcMicros;
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
        (pId, authorShare, voucherPool) = _recordPurchase(id, l, msg.sender, AgentVouchTypes.PurchaseLane.Direct);
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

        (pId,,) = _recordPurchase(id, l, buyer, AgentVouchTypes.PurchaseLane.Authorization);

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
        (pId,,) = _recordPurchase(id, l, buyer, AgentVouchTypes.PurchaseLane.Settlement);
        emit X402Settled(pId, paymentRefHash, settlementTxHash, buyer, amount);
    }

    // --- Paid-purchase reports (clean-break A1) ---

    function openPaidPurchaseReport(
        address author,
        bytes32 listingId_,
        bytes32 purchaseId_,
        string calldata evidenceUri
    ) external nonReentrant whenNotPaused returns (uint64 reportId) {
        if (!configInitialized) revert NotInitialized();
        uint256 evidenceLength = bytes(evidenceUri).length;
        if (evidenceLength == 0) revert PaidPurchaseReceiptIneligible();
        if (evidenceLength > MAX_REPORT_EVIDENCE_URI_BYTES) revert PaidPurchaseEvidenceTooLong();
        if (author == address(0) || author == msg.sender) revert PaidPurchaseReceiptIneligible();
        if (!profiles[msg.sender].registered || !profiles[author].registered) revert NotRegistered();

        AgentVouchTypes.Purchase storage purchase = purchases[purchaseId_];
        AgentVouchTypes.SkillListing storage listing = listings[listingId_];
        if (
            !purchase.exists || purchase.buyer != msg.sender || purchase.listingId != listingId_
                || purchase.priceUsdcMicros == 0 || !listing.exists || listing.author != author
                || block.timestamp > uint256(purchase.timestamp) + PURCHASE_REPORT_WINDOW
        ) revert PaidPurchaseReceiptIneligible();
        if (
            purchase.lane != AgentVouchTypes.PurchaseLane.Direct
                && purchase.lane != AgentVouchTypes.PurchaseLane.Authorization
        ) revert PurchaseLaneIneligible();

        AgentVouchTypes.PaidPurchaseState storage state = paidPurchaseState;
        if (state.reportIdByPurchase[purchaseId_] != 0) revert PaidPurchaseReceiptConsumed();
        if (state.activeReportByBuyer[msg.sender] != 0) revert PaidPurchaseBuyerBusy();
        if (state.activeReportByListing[listingId_] != 0) revert PaidPurchaseListingBusy();
        if (state.activeReportByAuthor[author] != 0) revert PaidPurchaseAuthorBusy();
        if (block.timestamp < state.buyerCooldownUntil[msg.sender]) revert PaidPurchaseBuyerCooldown();
        if (block.timestamp < state.authorCooldownUntil[author]) revert PaidPurchaseAuthorCooldown();

        reportId = ++state.nextReportId;
        uint64 reviewDeadline = uint64(block.timestamp + REPORT_REVIEW_WINDOW);
        AgentVouchTypes.PaidPurchaseReport storage report = state.reports[reportId];
        report.exists = true;
        report.buyer = msg.sender;
        report.author = author;
        report.listingId = listingId_;
        report.purchaseId = purchaseId_;
        report.evidenceUri = evidenceUri;
        report.filedAt = uint64(block.timestamp);
        report.reviewDeadline = reviewDeadline;
        report.status = AgentVouchTypes.PaidPurchaseReportStatus.Pending;
        report.bondUsdcMicros = REPORT_BOND_USDC_MICROS;

        state.reportIdByPurchase[purchaseId_] = reportId;
        state.activeReportByBuyer[msg.sender] = reportId;
        state.activeReportByAuthor[author] = reportId;
        state.activeReportByListing[listingId_] = reportId;
        profiles[author].openDisputes += 1;
        listing.lockedByDispute = true;
        usdc.safeTransferFrom(msg.sender, address(this), REPORT_BOND_USDC_MICROS);
        emit PaidPurchaseReportOpened(
            reportId, msg.sender, author, listingId_, purchaseId_, REPORT_BOND_USDC_MICROS, reviewDeadline, evidenceUri
        );
    }

    function reviewPaidPurchaseReport(uint64 reportId, bool accept) external nonReentrant onlyRole(RESOLVER_ROLE) {
        AgentVouchTypes.PaidPurchaseReport storage report = _paidPurchaseReport(reportId);
        if (report.status != AgentVouchTypes.PaidPurchaseReportStatus.Pending) {
            revert PaidPurchaseReportInvalidState();
        }
        if (block.timestamp >= report.reviewDeadline) revert PaidPurchaseReviewExpired();

        if (accept) {
            _requireNotPaused();
            report.status = AgentVouchTypes.PaidPurchaseReportStatus.Accepted;
            report.acceptedAt = uint64(block.timestamp);
            paidPurchaseState.purchaseLockedByAuthor[report.author] = true;
            emit PaidPurchaseReportAccepted(reportId, msg.sender, report.author, report.acceptedAt);
        } else {
            PaidPurchaseSettlement.terminateWithoutSlash(
                paidPurchaseState, profiles, listings, reportId, AgentVouchTypes.PaidPurchaseReportOutcome.Rejected
            );
        }
    }

    function resolvePaidPurchaseReport(uint64 reportId, uint8 ruling) external nonReentrant onlyRole(RESOLVER_ROLE) {
        if (ruling == uint8(AgentVouchTypes.PaidPurchaseReportRuling.Dismissed)) {
            PaidPurchaseSettlement.terminateWithoutSlash(
                paidPurchaseState, profiles, listings, reportId, AgentVouchTypes.PaidPurchaseReportOutcome.Dismissed
            );
        } else if (ruling == uint8(AgentVouchTypes.PaidPurchaseReportRuling.Upheld)) {
            PaidPurchaseSettlement.uphold(paidPurchaseState, profiles, listings, purchases, config, reportId);
        } else {
            revert PaidPurchaseReportInvalidState();
        }
    }

    function slashPaidPurchaseReportVouches(uint64 reportId, address[] calldata vouchers_) external nonReentrant {
        PaidPurchaseSettlement.slashVouches(
            paidPurchaseState,
            profiles,
            vouches,
            listings,
            purchases,
            voucherRevenuePendingDistributionUsdcMicros,
            voucherRevenueRoundingAuthorProceedsUsdcMicros,
            reportId,
            vouchers_
        );
    }

    function claimPaidPurchaseReportCredit(uint64 reportId) external nonReentrant {
        uint256 amount = PaidPurchaseSettlement.claimCredit(paidPurchaseState, reportId, msg.sender);
        usdc.safeTransfer(msg.sender, amount);
    }

    function closePaidPurchaseReportCredit(uint64 reportId) external nonReentrant {
        AgentVouchTypes.PaidPurchaseReport storage report = _paidPurchaseReport(reportId);
        if (report.status == AgentVouchTypes.PaidPurchaseReportStatus.Pending) {
            if (block.timestamp < report.reviewDeadline) revert PaidPurchaseReviewOpen();
            PaidPurchaseSettlement.terminateWithoutSlash(
                paidPurchaseState, profiles, listings, reportId, AgentVouchTypes.PaidPurchaseReportOutcome.Expired
            );
        } else {
            PaidPurchaseSettlement.closeCredit(paidPurchaseState, reportId);
        }
    }

    function claimRestitutionReserve() external nonReentrant {
        if (msg.sender != config.treasuryRecipient) revert PaidPurchaseReportInvalidState();
        uint256 amount = PaidPurchaseSettlement.takeReserveCredit(paidPurchaseState);
        usdc.safeTransfer(msg.sender, amount);
        emit RestitutionReserveClaimed(msg.sender, amount);
    }

    function _paidPurchaseReport(uint64 reportId)
        internal
        view
        returns (AgentVouchTypes.PaidPurchaseReport storage report)
    {
        report = paidPurchaseState.reports[reportId];
        if (!report.exists) revert PaidPurchaseReportNotFound();
    }

    /// @dev Validates a listing is purchasable (exists, active, not dispute-locked, paid).
    function _purchasableListing(bytes32 id) internal view returns (AgentVouchTypes.SkillListing storage l) {
        l = listings[id];
        if (!l.exists) revert ListingNotFound();
        if (l.status != AgentVouchTypes.ListingStatus.Active) revert ListingNotActive();
        if (paidPurchaseState.purchaseLockedByAuthor[l.author]) revert DisputeLocked();
        if (l.priceUsdcMicros == 0) revert FreeSkillNotPurchased();
    }

    /// @dev Shared accounting for every purchase lane: validates the settlement, guards
    ///      duplicate receipts, splits by backing, advances the author-wide reward index,
    ///      and writes the revision-scoped receipt. Does NOT move USDC — each lane moves
    ///      its own funds (Lane A/B pull; Lane C assumes prior delivery).
    function _recordPurchase(
        bytes32 id,
        AgentVouchTypes.SkillListing storage l,
        address buyer,
        AgentVouchTypes.PurchaseLane lane
    ) internal returns (bytes32 pId, uint256 authorShare, uint256 voucherPool) {
        if (buyer == address(0)) revert ZeroAddress();
        uint64 revision = l.currentRevision;
        AgentVouchTypes.ListingSettlement storage s = settlements[id][revision];
        if (!s.initialized) revert SettlementNotInitialized();
        if (paidPurchaseState.purchaseLockedByAuthor[l.author]) revert DisputeLocked();
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
            timestamp: uint64(block.timestamp),
            lane: lane
        });

        s.authorProceedsUsdcMicros += authorShare;
        s.updatedAt = uint64(block.timestamp); // rolling proceeds lock resets each sale (Solana parity)
        l.totalDownloads += 1;
        l.totalRevenueUsdcMicros += price;

        if (voucherPool > 0) {
            uint256 indexDelta = (voucherPool * REWARD_INDEX_SCALE) / activeVouchStake;
            if (indexDelta == 0) revert VoucherPoolTooSmall();
            uint256 distributable = (indexDelta * activeVouchStake) / REWARD_INDEX_SCALE;
            uint256 indexRemainder = voucherPool - distributable;
            voucherPool = distributable;
            authorShare += indexRemainder;
            purchases[pId].authorShareUsdcMicros = authorShare;
            purchases[pId].voucherPoolUsdcMicros = voucherPool;
            s.authorProceedsUsdcMicros += indexRemainder;
            AgentVouchTypes.AgentProfile storage ap = profiles[author];
            ap.rewardIndexUsdcMicrosX1e12 += indexDelta;
            voucherRevenuePendingDistributionUsdcMicros[author] += voucherPool;
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
        uint256 claimable = PaidPurchaseSettlement.materializeVoucherClaim(
            profiles, vouches, voucherRevenuePendingDistributionUsdcMicros, msg.sender, author
        );

        usdc.safeTransfer(msg.sender, claimable);
        emit VoucherRevenueClaimed(msg.sender, author, claimable);
    }

    /// @notice Port of `withdraw_author_proceeds`. Paused-guarded (Solana blocks this
    ///         author-side collateral exit while paused). Also blocked by the settlement
    ///         dispute lock and the rolling proceeds time lock (updatedAt + authorProceedsLockSeconds).
    function withdrawAuthorProceeds(bytes32 id, uint64 revision, uint256 amount) external nonReentrant whenNotPaused {
        PaidPurchaseSettlement.takeAuthorProceeds(
            listings,
            settlements,
            voucherRevenueRoundingAuthorProceedsUsdcMicros,
            id,
            revision,
            msg.sender,
            amount,
            config.authorProceedsLockSeconds
        );
        usdc.safeTransfer(msg.sender, amount);
        emit AuthorProceedsWithdrawn(id, revision, msg.sender, amount);
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

    function getPaidPurchaseReportCore(uint64 reportId)
        external
        view
        returns (
            address buyer,
            address author,
            bytes32 listingId_,
            bytes32 purchaseId_,
            uint64 filedAt,
            uint64 reviewDeadline,
            uint64 acceptedAt,
            uint64 terminalAt,
            uint8 status,
            uint8 outcome
        )
    {
        AgentVouchTypes.PaidPurchaseReport storage report = _paidPurchaseReport(reportId);
        return (
            report.buyer,
            report.author,
            report.listingId,
            report.purchaseId,
            report.filedAt,
            report.reviewDeadline,
            report.acceptedAt,
            report.terminalAt,
            uint8(report.status),
            uint8(report.outcome)
        );
    }

    function getPaidPurchaseReportSettlement(uint64 reportId)
        external
        view
        returns (
            uint8 slashPercentage,
            uint256 activeVouchStake,
            uint256 processedPreSlashStake,
            uint256 authorBondSlash,
            uint256 voucherSlash,
            uint256 buyerEntitlement,
            uint256 buyerCredit,
            uint64 claimDeadline,
            bool creditHandled
        )
    {
        AgentVouchTypes.PaidPurchaseReport storage report = _paidPurchaseReport(reportId);
        return (
            report.snapshottedSlashPercentage,
            report.snapshottedActiveVouchStakeUsdcMicros,
            report.processedPreSlashStakeUsdcMicros,
            report.authorBondSlashUsdcMicros,
            report.voucherSlashUsdcMicros,
            report.buyerEntitlementUsdcMicros,
            report.buyerCreditUsdcMicros,
            report.claimDeadline,
            report.creditHandled
        );
    }

    function getPaidPurchaseReportEvidence(uint64 reportId) external view returns (string memory) {
        return _paidPurchaseReport(reportId).evidenceUri;
    }
}
