// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgentVouchEvm} from "../src/AgentVouchEvm.sol";
import {AgentVouchTypes} from "../src/libraries/AgentVouchTypes.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// Phase 4: x402 lanes. Lane B = EIP-3009 `receiveWithAuthorization`, contract-consumed and
/// caller-bound to the payee (trust-minimized, F-1-safe); Lane C = settlement-authority
/// attestation (bridge-equivalent), with idempotency guards.
contract X402Test is Test {
    AgentVouchEvm internal av;
    MockUSDC internal usdc;
    address internal admin = address(0xA11CE);
    address internal author = address(0xA0);
    address internal voucher = address(0xB0);

    uint256 internal constant BUYER_PK = 0xB0B;
    address internal buyer; // = vm.addr(BUYER_PK); signs off-chain, never sends a tx
    address internal relayer = address(0xCAFE); // submits the tx and pays the gas

    uint256 constant PRICE = 10_000_000;
    uint256 constant MIN_VOUCH = 1_000_000;
    bytes32 internal listingId;

    function setUp() public {
        vm.chainId(84532);
        buyer = vm.addr(BUYER_PK);
        usdc = new MockUSDC();
        av = new AgentVouchEvm(address(usdc), admin);
        vm.prank(admin);
        av.initializeConfig(_cfg());

        _register(author);
        _register(voucher);
        usdc.mint(buyer, 1_000_000_000);
        vm.prank(buyer);
        usdc.approve(address(av), type(uint256).max); // lets the buyer also use Lane A (cross-lane tests)

        vm.prank(author);
        listingId = av.createSkillListing(keccak256("x402"), "uri", "n", "d", PRICE);
    }

    function _cfg() internal view returns (AgentVouchTypes.Config memory c) {
        c.usdc = address(usdc);
        c.chainContext = "eip155:84532";
        c.minVouchStakeUsdcMicros = MIN_VOUCH;
        c.disputeBondUsdcMicros = 5_000_000;
        c.minAuthorBondForFreeListingUsdcMicros = 1_000_000;
        c.minPaidListingPriceUsdcMicros = 10_000;
        c.authorShareBps = 6000;
        c.voucherShareBps = 4000;
        c.protocolFeeBps = 0;
        c.slashPercentage = 100;
        c.refundClaimWindowSeconds = 7 days;
        c.treasuryRecipient = address(0xD00D);
    }

    function _register(address a) internal {
        usdc.mint(a, 1_000_000_000);
        vm.startPrank(a);
        usdc.approve(address(av), type(uint256).max); // for allowance-based flows (e.g. vouch)
        av.registerAgent("ipfs://x");
        vm.stopPrank();
    }

    function _boundNonce(address b, bytes32 id, uint64 rev, uint256 price) internal pure returns (bytes32) {
        return keccak256(abi.encode(b, id, rev, price));
    }

    function _signAuth(uint256 pk, address from, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), from, address(av), value, validAfter, validBefore, nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }

    // --- Lane B: purchaseWithAuthorization (buyer signs; relayer pays gas) ---

    function test_laneB_noBackingFullToAuthor() public {
        bytes32 nonce = _boundNonce(buyer, listingId, 1, PRICE);
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(BUYER_PK, buyer, PRICE, 0, block.timestamp + 1 hours, nonce);

        uint256 buyerBefore = usdc.balanceOf(buyer);
        vm.prank(relayer); // buyer holds no ETH; relayer submits
        bytes32 pId = av.purchaseWithAuthorization(listingId, buyer, 0, block.timestamp + 1 hours, v, r, s);

        AgentVouchTypes.Purchase memory p = av.getPurchase(pId);
        assertEq(p.buyer, buyer);
        assertEq(p.authorShareUsdcMicros, PRICE);
        assertEq(p.voucherPoolUsdcMicros, 0);
        assertEq(usdc.balanceOf(buyer), buyerBefore - PRICE);
        assertEq(usdc.balanceOf(address(av)), PRICE);
        assertEq(av.getSettlement(listingId, 1).authorProceedsUsdcMicros, PRICE);
    }

    function test_laneB_backedSplit6040() public {
        vm.prank(voucher);
        av.vouch(author, MIN_VOUCH * 4);
        bytes32 nonce = _boundNonce(buyer, listingId, 1, PRICE);
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(BUYER_PK, buyer, PRICE, 0, block.timestamp + 1 hours, nonce);
        vm.prank(relayer);
        bytes32 pId = av.purchaseWithAuthorization(listingId, buyer, 0, block.timestamp + 1 hours, v, r, s);
        AgentVouchTypes.Purchase memory p = av.getPurchase(pId);
        assertEq(p.authorShareUsdcMicros, 6_000_000);
        assertEq(p.voucherPoolUsdcMicros, 4_000_000);
        assertEq(av.getProfile(author).unclaimedVoucherRevenueUsdcMicros, 0);
        assertEq(usdc.balanceOf(address(av)), MIN_VOUCH * 4 + PRICE);
    }

    function test_laneB_expiredAuthReverts() public {
        vm.warp(1000);
        bytes32 nonce = _boundNonce(buyer, listingId, 1, PRICE);
        uint256 validBefore = block.timestamp - 1;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(BUYER_PK, buyer, PRICE, 0, validBefore, nonce);
        vm.prank(relayer);
        vm.expectRevert(bytes("auth: expired"));
        av.purchaseWithAuthorization(listingId, buyer, 0, validBefore, v, r, s);
    }

    function test_laneB_notYetValidReverts() public {
        vm.warp(1000);
        bytes32 nonce = _boundNonce(buyer, listingId, 1, PRICE);
        uint256 validAfter = block.timestamp + 100;
        (uint8 v, bytes32 r, bytes32 s) =
            _signAuth(BUYER_PK, buyer, PRICE, validAfter, block.timestamp + 1 hours, nonce);
        vm.prank(relayer);
        vm.expectRevert(bytes("auth: not yet valid"));
        av.purchaseWithAuthorization(listingId, buyer, validAfter, block.timestamp + 1 hours, v, r, s);
    }

    function test_laneB_wrongSignerReverts() public {
        bytes32 nonce = _boundNonce(buyer, listingId, 1, PRICE);
        // signed by a different key, but `from` is still `buyer` -> recovered signer != buyer
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(0xBAD, buyer, PRICE, 0, block.timestamp + 1 hours, nonce);
        vm.prank(relayer);
        vm.expectRevert(bytes("auth: invalid signature"));
        av.purchaseWithAuthorization(listingId, buyer, 0, block.timestamp + 1 hours, v, r, s);
    }

    // The nonce binds the authorization to (buyer, listingId, revision, price), so a relayer
    // cannot apply a payment the buyer signed for one listing to a different (same-price) listing.
    function test_laneB_relayerCannotRedirectListing() public {
        vm.prank(author);
        bytes32 listing2 = av.createSkillListing(keccak256("other"), "uri", "n", "d", PRICE);
        bytes32 nonceFor1 = _boundNonce(buyer, listingId, 1, PRICE);
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(BUYER_PK, buyer, PRICE, 0, block.timestamp + 1 hours, nonceFor1);
        // relayer applies the listing-1 authorization to listing-2: contract derives a different
        // bound nonce, so the signature recovers a non-buyer address and the token rejects it.
        vm.prank(relayer);
        vm.expectRevert(bytes("auth: invalid signature"));
        av.purchaseWithAuthorization(listing2, buyer, 0, block.timestamp + 1 hours, v, r, s);
    }

    function test_laneB_duplicatePurchaseReverts() public {
        bytes32 nonce = _boundNonce(buyer, listingId, 1, PRICE);
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(BUYER_PK, buyer, PRICE, 0, block.timestamp + 1 hours, nonce);
        vm.prank(relayer);
        av.purchaseWithAuthorization(listingId, buyer, 0, block.timestamp + 1 hours, v, r, s);
        vm.prank(relayer);
        vm.expectRevert(AgentVouchEvm.DuplicatePurchase.selector);
        av.purchaseWithAuthorization(listingId, buyer, 0, block.timestamp + 1 hours, v, r, s);
    }

    function test_laneB_pausedReverts() public {
        bytes32 nonce = _boundNonce(buyer, listingId, 1, PRICE);
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(BUYER_PK, buyer, PRICE, 0, block.timestamp + 1 hours, nonce);
        vm.prank(admin);
        av.setPaused(true);
        vm.prank(relayer);
        vm.expectRevert();
        av.purchaseWithAuthorization(listingId, buyer, 0, block.timestamp + 1 hours, v, r, s);
    }

    // --- Lane C: settleX402Purchase (SETTLEMENT_ROLE attestation) ---

    function test_laneC_settleRecords() public {
        usdc.mint(address(av), PRICE); // facilitator already delivered the funds
        vm.prank(admin); // admin holds SETTLEMENT_ROLE
        bytes32 pId = av.settleX402Purchase(listingId, buyer, PRICE, keccak256("ref1"), keccak256("tx1"));
        AgentVouchTypes.Purchase memory p = av.getPurchase(pId);
        assertEq(p.buyer, buyer);
        assertEq(p.authorShareUsdcMicros, PRICE);
        assertEq(av.getSettlement(listingId, 1).authorProceedsUsdcMicros, PRICE);
        assertTrue(av.usedPaymentRefHash(keccak256("ref1")));
        assertTrue(av.usedSettlementTxHash(keccak256("tx1")));
        assertEq(usdc.balanceOf(address(av)), PRICE); // solvent: delivered funds back the liability
    }

    function test_laneC_onlySettlementRole() public {
        vm.prank(relayer);
        vm.expectRevert();
        av.settleX402Purchase(listingId, buyer, PRICE, keccak256("ref1"), keccak256("tx1"));
    }

    function test_laneC_duplicatePaymentRefReverts() public {
        usdc.mint(address(av), PRICE);
        vm.prank(admin);
        av.settleX402Purchase(listingId, buyer, PRICE, keccak256("ref1"), keccak256("tx1"));
        // different buyer (distinct purchase) but the same payment-ref must be rejected
        vm.prank(admin);
        vm.expectRevert(AgentVouchEvm.PaymentRefUsed.selector);
        av.settleX402Purchase(listingId, address(0xD2), PRICE, keccak256("ref1"), keccak256("tx2"));
    }

    function test_laneC_duplicateSettlementTxReverts() public {
        usdc.mint(address(av), PRICE);
        vm.prank(admin);
        av.settleX402Purchase(listingId, buyer, PRICE, keccak256("ref1"), keccak256("tx1"));
        vm.prank(admin);
        vm.expectRevert(AgentVouchEvm.SettlementTxUsed.selector);
        av.settleX402Purchase(listingId, address(0xD2), PRICE, keccak256("ref2"), keccak256("tx1"));
    }

    function test_laneC_zeroHashReverts() public {
        vm.prank(admin);
        vm.expectRevert(AgentVouchEvm.InvalidPaymentRef.selector);
        av.settleX402Purchase(listingId, buyer, PRICE, bytes32(0), keccak256("tx1"));
    }

    function test_laneC_amountMismatchReverts() public {
        vm.prank(admin);
        vm.expectRevert(AgentVouchEvm.SettlementAmountMismatch.selector);
        av.settleX402Purchase(listingId, buyer, PRICE - 1, keccak256("ref1"), keccak256("tx1"));
    }

    function test_laneC_pausedReverts() public {
        vm.prank(admin);
        av.setPaused(true);
        vm.prank(admin);
        vm.expectRevert();
        av.settleX402Purchase(listingId, buyer, PRICE, keccak256("ref1"), keccak256("tx1"));
    }

    function test_laneC_zeroSettlementTxHashReverts() public {
        vm.prank(admin);
        vm.expectRevert(AgentVouchEvm.InvalidPaymentRef.selector);
        av.settleX402Purchase(listingId, buyer, PRICE, keccak256("ref1"), bytes32(0));
    }

    function test_laneC_buyerZeroReverts() public {
        vm.prank(admin);
        vm.expectRevert(AgentVouchEvm.ZeroAddress.selector);
        av.settleX402Purchase(listingId, address(0), PRICE, keccak256("ref1"), keccak256("tx1"));
    }

    function test_laneC_backedSplitAndClaim() public {
        vm.prank(voucher);
        av.vouch(author, MIN_VOUCH * 4);
        usdc.mint(address(av), PRICE); // facilitator delivered the funds
        vm.prank(admin);
        av.settleX402Purchase(listingId, buyer, PRICE, keccak256("ref1"), keccak256("tx1"));
        assertEq(av.getProfile(author).unclaimedVoucherRevenueUsdcMicros, 0);
        uint256 bal = usdc.balanceOf(voucher);
        vm.prank(voucher);
        av.claimVoucherRevenue(author);
        assertEq(usdc.balanceOf(voucher) - bal, 4_000_000);
    }

    function test_laneC_solvencyInvariant() public {
        vm.prank(voucher);
        av.vouch(author, MIN_VOUCH * 4);
        usdc.mint(address(av), PRICE); // facilitator delivered exactly the price
        vm.prank(admin);
        av.settleX402Purchase(listingId, buyer, PRICE, keccak256("ref1"), keccak256("tx1"));
        uint256 liabilities = av.getProfile(author).totalVouchStakeReceivedUsdcMicros
            + av.getSettlement(listingId, 1).authorProceedsUsdcMicros
            + av.getPurchase(av.purchaseId(buyer, listingId, 1)).voucherPoolUsdcMicros;
        assertEq(usdc.balanceOf(address(av)), liabilities);
    }

    // The shared purchaseId dup guard blocks recording the same (buyer, listing, revision)
    // across different lanes.
    function test_crossLane_dupGuardAThenB() public {
        vm.prank(buyer);
        av.purchaseSkill(listingId); // Lane A
        bytes32 nonce = _boundNonce(buyer, listingId, 1, PRICE);
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(BUYER_PK, buyer, PRICE, 0, block.timestamp + 1 hours, nonce);
        vm.prank(relayer);
        vm.expectRevert(AgentVouchEvm.DuplicatePurchase.selector);
        av.purchaseWithAuthorization(listingId, buyer, 0, block.timestamp + 1 hours, v, r, s);
    }

    function test_crossLane_dupGuardCThenA() public {
        usdc.mint(address(av), PRICE);
        vm.prank(admin);
        av.settleX402Purchase(listingId, buyer, PRICE, keccak256("ref1"), keccak256("tx1")); // Lane C
        vm.prank(buyer);
        vm.expectRevert(AgentVouchEvm.DuplicatePurchase.selector);
        av.purchaseSkill(listingId); // Lane A, same (buyer, listing, revision)
    }

    // F-1 (fixed): Lane B uses receiveWithAuthorization, which is caller-bound to the payee, so a
    // buyer's signed authorization cannot be consumed straight at the token to strand the funds.
    function test_laneB_receiveAuthCannotBeFrontRunOrStranded() public {
        bytes32 nonce = _boundNonce(buyer, listingId, 1, PRICE);
        uint256 validBefore = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(BUYER_PK, buyer, PRICE, 0, validBefore, nonce);

        // Attack A: submit straight to the token's open transfer path. The signature is over the
        // ReceiveWithAuthorization type hash, so it doesn't recover the buyer for a Transfer
        // digest — the token rejects it.
        vm.prank(relayer);
        vm.expectRevert(bytes("auth: invalid signature"));
        usdc.transferWithAuthorization(buyer, address(av), PRICE, 0, validBefore, nonce, v, r, s);

        // Attack B: call receiveWithAuthorization directly — only the payee (the contract) may
        // submit it, so a relayer is rejected.
        vm.prank(relayer);
        vm.expectRevert(bytes("auth: caller must be the payee"));
        usdc.receiveWithAuthorization(buyer, address(av), PRICE, 0, validBefore, nonce, v, r, s);

        // Neither attack moved funds or burned the nonce; the legit lane still settles cleanly.
        assertEq(usdc.balanceOf(address(av)), 0);
        assertFalse(usdc.authorizationState(buyer, nonce));

        vm.prank(relayer);
        bytes32 pId = av.purchaseWithAuthorization(listingId, buyer, 0, validBefore, v, r, s);
        assertTrue(av.getPurchase(pId).exists);
        assertEq(usdc.balanceOf(address(av)), PRICE);
        assertEq(av.getSettlement(listingId, 1).authorProceedsUsdcMicros, PRICE);
    }
}
