// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {EntryPoint} from "@account-abstraction/contracts/core/EntryPoint.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {SimpleAccount} from "@account-abstraction/contracts/samples/SimpleAccount.sol";
import {SimpleAccountFactory} from "@account-abstraction/contracts/samples/SimpleAccountFactory.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";

import {AgentVouchEvm} from "../../src/AgentVouchEvm.sol";
import {AgentVouchTypes} from "../../src/libraries/AgentVouchTypes.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {AcceptEverythingPaymaster} from "./AcceptEverythingPaymaster.sol";

/// @notice Gas-free UX proof (v2 spike). Drives the FULL AgentVouch core flow —
///         register, author bond, vouch, listing, purchase, voucher revenue claim,
///         author proceeds withdrawal — entirely through ERC-4337 UserOps where each
///         user is a SimpleAccount (smart account) and a paymaster sponsors all gas.
///
///         The asserted claim: every smart account holds and spends ZERO ETH, while
///         the paymaster's EntryPoint deposit pays for everything. This is the
///         contract-level proof that the existing Phases 0-4 contract supports the
///         gas-abstracted UX the v2 spike targets on Base, with no contract changes.
///
///         The local AcceptEverythingPaymaster stands in for a hosted Base paymaster
///         (e.g. Coinbase CDP); the live harness in scripts/gasless wires the same
///         flow to Base Sepolia + a real paymaster.
contract Gasless4337Test is Test {
    EntryPoint internal entryPoint;
    SimpleAccountFactory internal factory;
    MockUSDC internal usdc;
    AgentVouchEvm internal av;
    AcceptEverythingPaymaster internal paymaster;

    address internal bundler = makeAddr("bundler"); // handleOps beneficiary (gas refund sink)

    // Smart-account owners (EOAs that sign UserOps; they never send transactions).
    uint256 internal authorPk;
    uint256 internal voucherPk;
    uint256 internal buyerPk;
    address internal authorOwner;
    address internal voucherOwner;
    address internal buyerOwner;

    // The smart accounts (msg.sender for every protocol call).
    address internal authorSA;
    address internal voucherSA;
    address internal buyerSA;

    // Economics (USDC has 6 decimals).
    uint256 internal constant MINT = 100_000_000; // 100 USDC each
    uint256 internal constant BOND = 10_000_000; // 10 USDC author bond
    uint256 internal constant STAKE = 10_000_000; // 10 USDC vouch stake
    uint256 internal constant PRICE = 10_000_000; // 10 USDC listing price
    bytes32 internal constant SKILL = keccak256("skill-v2-gasless");

    function setUp() public {
        entryPoint = new EntryPoint();
        factory = new SimpleAccountFactory(entryPoint);
        usdc = new MockUSDC();
        av = new AgentVouchEvm(address(usdc), address(this)); // test contract holds all roles
        av.initializeConfig(_cfg(address(usdc)));

        // Fund the paymaster's gas sponsorship (held inside the EntryPoint).
        paymaster = new AcceptEverythingPaymaster(entryPoint);
        vm.deal(address(this), 100 ether);
        entryPoint.depositTo{value: 10 ether}(address(paymaster));

        (authorOwner, authorPk) = makeAddrAndKey("authorOwner");
        (voucherOwner, voucherPk) = makeAddrAndKey("voucherOwner");
        (buyerOwner, buyerPk) = makeAddrAndKey("buyerOwner");

        // Counterfactual deployment is orthogonal to "protocol actions are gasless", so
        // the accounts are pre-deployed here; in production initCode deploys them inside
        // the first sponsored UserOp.
        authorSA = address(factory.createAccount(authorOwner, 0));
        voucherSA = address(factory.createAccount(voucherOwner, 0));
        buyerSA = address(factory.createAccount(buyerOwner, 0));

        usdc.mint(authorSA, MINT);
        usdc.mint(voucherSA, MINT);
        usdc.mint(buyerSA, MINT);
    }

    function test_fullFlowIsGasFreeForUsers() public {
        // --- Precondition: smart accounts hold zero ETH and never will. ---
        assertEq(authorSA.balance, 0, "author SA starts with 0 ETH");
        assertEq(voucherSA.balance, 0, "voucher SA starts with 0 ETH");
        assertEq(buyerSA.balance, 0, "buyer SA starts with 0 ETH");
        uint256 paymasterDepositBefore = entryPoint.balanceOf(address(paymaster));

        bytes32 listingId = av.listingId(authorSA, SKILL);

        // 1. Author registers (no funds move).
        _send(authorSA, authorPk, _call(address(av), abi.encodeCall(AgentVouchEvm.registerAgent, ("ipfs://author"))));

        // 2. Voucher registers (vouch requires both parties registered).
        _send(voucherSA, voucherPk, _call(address(av), abi.encodeCall(AgentVouchEvm.registerAgent, ("ipfs://voucher"))));

        // 3. Author deposits a bond: approve + deposit batched in one sponsored UserOp.
        _send(
            authorSA,
            authorPk,
            _batch2(
                address(usdc),
                abi.encodeCall(IERC20.approve, (address(av), BOND)),
                address(av),
                abi.encodeCall(AgentVouchEvm.depositAuthorBond, (BOND))
            )
        );

        // 4. Voucher stakes a vouch FOR the author (so purchases split revenue to it).
        _send(
            voucherSA,
            voucherPk,
            _batch2(
                address(usdc),
                abi.encodeCall(IERC20.approve, (address(av), STAKE)),
                address(av),
                abi.encodeCall(AgentVouchEvm.vouch, (authorSA, STAKE))
            )
        );

        // 5. Author creates a paid listing.
        _send(
            authorSA,
            authorPk,
            _call(
                address(av),
                abi.encodeCall(
                    AgentVouchEvm.createSkillListing, (SKILL, "ipfs://skill", "Gasless Skill", "desc", PRICE)
                )
            )
        );

        // 6. Buyer purchases: approve + purchase batched in one sponsored UserOp.
        _send(
            buyerSA,
            buyerPk,
            _batch2(
                address(usdc),
                abi.encodeCall(IERC20.approve, (address(av), PRICE)),
                address(av),
                abi.encodeCall(AgentVouchEvm.purchaseSkill, (listingId))
            )
        );

        // 7. Voucher claims its revenue share.
        _send(voucherSA, voucherPk, _call(address(av), abi.encodeCall(AgentVouchEvm.claimVoucherRevenue, (authorSA))));

        // 8. Author withdraws proceeds (config lock is 0s, so immediate).
        uint256 voucherPool = (PRICE * 4000) / 10_000; // voucherShareBps = 4000
        uint256 authorShare = PRICE - voucherPool;
        _send(
            authorSA,
            authorPk,
            _call(address(av), abi.encodeCall(AgentVouchEvm.withdrawAuthorProceeds, (listingId, 1, authorShare)))
        );

        // --- The gas-free claim: users still hold zero ETH; the paymaster paid. ---
        assertEq(authorSA.balance, 0, "author SA never spent ETH");
        assertEq(voucherSA.balance, 0, "voucher SA never spent ETH");
        assertEq(buyerSA.balance, 0, "buyer SA never spent ETH");
        assertLt(
            entryPoint.balanceOf(address(paymaster)),
            paymasterDepositBefore,
            "paymaster deposit must have decreased (it paid the gas)"
        );

        // --- Protocol correctness: the gasless flow produced the right accounting. ---
        assertTrue(av.getProfile(authorSA).registered, "author registered");
        assertEq(av.getProfile(authorSA).authorBondUsdcMicros, BOND, "bond recorded");
        assertEq(av.getListing(listingId).author, authorSA, "listing owned by author SA");
        assertTrue(av.getPurchase(av.purchaseId(buyerSA, listingId, 1)).exists, "purchase recorded");

        // Revenue split landed: voucher got the voucher pool, author got the remainder.
        assertEq(usdc.balanceOf(buyerSA), MINT - PRICE, "buyer paid exactly the price");
        assertEq(av.getVouch(voucherSA, authorSA).cumulativeRevenueUsdcMicros, voucherPool, "voucher revenue accrued");
        assertEq(usdc.balanceOf(voucherSA), MINT - STAKE + voucherPool, "voucher received its share");
        assertEq(usdc.balanceOf(authorSA), MINT - BOND + authorShare, "author received proceeds");
    }

    // --- ERC-4337 plumbing helpers ---

    /// @dev Build, sign, and submit a single sponsored UserOp for `sender`.
    function _send(address sender, uint256 ownerPk, bytes memory callData) internal {
        PackedUserOperation memory op;
        op.sender = sender;
        op.nonce = entryPoint.getNonce(sender, 0);
        op.initCode = "";
        op.callData = callData;
        // accountGasLimits = verificationGasLimit (high 128) | callGasLimit (low 128)
        op.accountGasLimits = bytes32((uint256(2_000_000) << 128) | uint256(2_000_000));
        op.preVerificationGas = 100_000;
        // gasFees = maxPriorityFeePerGas (high 128) | maxFeePerGas (low 128)
        op.gasFees = bytes32((uint256(1 gwei) << 128) | uint256(2 gwei));
        // paymasterAndData = paymaster (20) | verificationGasLimit (16) | postOpGasLimit (16) | extra
        op.paymasterAndData = abi.encodePacked(address(paymaster), uint128(300_000), uint128(300_000));

        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(entryPoint.getUserOpHash(op));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, digest);
        op.signature = abi.encodePacked(r, s, v);

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        entryPoint.handleOps(ops, payable(bundler));
    }

    /// @dev Encode a single SimpleAccount.execute call.
    function _call(address target, bytes memory data) internal pure returns (bytes memory) {
        return abi.encodeCall(SimpleAccount.execute, (target, 0, data));
    }

    /// @dev Encode a two-call SimpleAccount.executeBatch (e.g. approve + protocol action).
    function _batch2(address t0, bytes memory d0, address t1, bytes memory d1)
        internal
        pure
        returns (bytes memory)
    {
        address[] memory dest = new address[](2);
        dest[0] = t0;
        dest[1] = t1;
        uint256[] memory value = new uint256[](2);
        bytes[] memory func = new bytes[](2);
        func[0] = d0;
        func[1] = d1;
        return abi.encodeCall(SimpleAccount.executeBatch, (dest, value, func));
    }

    function _cfg(address u) internal pure returns (AgentVouchTypes.Config memory c) {
        c.usdc = u;
        c.chainContext = "eip155:84532"; // Base Sepolia
        c.minVouchStakeUsdcMicros = 1_000_000;
        c.disputeBondUsdcMicros = 5_000_000;
        c.minAuthorBondForFreeListingUsdcMicros = 10_000_000;
        c.minPaidListingPriceUsdcMicros = 1_000_000;
        c.authorShareBps = 6000;
        c.voucherShareBps = 4000;
        c.protocolFeeBps = 0;
        c.slashPercentage = 100;
        // authorProceedsLockSeconds left 0 -> proceeds withdrawable immediately in the proof.
    }
}
