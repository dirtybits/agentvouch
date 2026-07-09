// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgentVouchEvm} from "../src/AgentVouchEvm.sol";
import {AgentVouchTypes} from "../src/libraries/AgentVouchTypes.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract UpdateListingTest is Test {
    AgentVouchEvm internal av;
    MockUSDC internal usdc;

    address internal admin = address(0xA11CE);
    address internal author = address(0xA0);
    address internal otherAuthor = address(0xA2);
    address internal reporter = address(0xB0);
    address internal buyer = address(0xC0);
    uint256 internal buyer2Pk = 0xC02;
    address internal buyer2;
    address internal relayer = address(0xCAFE);

    uint256 internal constant FLOOR = 10_000_000;
    uint256 internal constant MIN_PAID = 1_000_000;
    uint256 internal constant PRICE = 5_000_000;

    bytes32 internal listingId;

    event SkillListingUpdated(
        bytes32 indexed listingId,
        address indexed author,
        uint64 revision,
        uint256 price,
        bool free,
        bool revisionChanged
    );

    function setUp() public {
        buyer2 = vm.addr(buyer2Pk);
        usdc = new MockUSDC();
        av = new AgentVouchEvm(address(usdc), admin);
        vm.prank(admin);
        av.initializeConfig(_cfg());

        _register(author);
        _register(otherAuthor);
        _register(reporter);
        _register(buyer);
        _register(buyer2);

        vm.prank(author);
        listingId = av.createSkillListing(keccak256("update"), "uri-v1", "Name", "Description", PRICE);
    }

    function _cfg() internal view returns (AgentVouchTypes.Config memory c) {
        c.usdc = address(usdc);
        c.chainContext = "eip155:84532";
        c.minVouchStakeUsdcMicros = MIN_PAID;
        c.disputeBondUsdcMicros = 5_000_000;
        c.minAuthorBondForFreeListingUsdcMicros = FLOOR;
        c.minPaidListingPriceUsdcMicros = MIN_PAID;
        c.authorShareBps = 6000;
        c.voucherShareBps = 4000;
        c.protocolFeeBps = 0;
        c.slashPercentage = 100;
        c.refundClaimWindowSeconds = 1 days;
        c.challengerRewardBps = 1_000;
        c.challengerRewardCapUsdcMicros = 1_000_000;
        c.treasuryRecipient = address(0xD00D);
    }

    function _register(address actor) internal {
        usdc.mint(actor, 1_000_000_000_000);
        vm.startPrank(actor);
        usdc.approve(address(av), type(uint256).max);
        av.registerAgent("ipfs://agent");
        vm.stopPrank();
    }

    function _longString(uint256 length) internal pure returns (string memory) {
        bytes memory data = new bytes(length);
        for (uint256 i; i < length; i++) {
            data[i] = "a";
        }
        return string(data);
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

    function test_metadataOnlyUpdateDoesNotBumpRevisionOrSettlement() public {
        AgentVouchTypes.ListingSettlement memory beforeSettlement = av.getSettlement(listingId, 1);

        vm.expectEmit(true, true, false, true, address(av));
        emit SkillListingUpdated(listingId, author, 1, PRICE, false, false);
        vm.prank(author);
        uint64 revision = av.updateSkillListing(listingId, "uri-v1", "New Name", "New Description", PRICE);

        AgentVouchTypes.SkillListing memory listing = av.getListing(listingId);
        AgentVouchTypes.ListingSettlement memory afterSettlement = av.getSettlement(listingId, 1);
        assertEq(revision, 1);
        assertEq(listing.currentRevision, 1);
        assertEq(listing.name, "New Name");
        assertEq(listing.description, "New Description");
        assertEq(afterSettlement.initialized, beforeSettlement.initialized);
        assertEq(afterSettlement.createdAt, beforeSettlement.createdAt);
        assertEq(afterSettlement.updatedAt, beforeSettlement.updatedAt);
    }

    function test_uriOrPriceUpdateBumpsRevisionAndInitializesSettlement() public {
        vm.warp(block.timestamp + 1 days);
        vm.prank(author);
        uint64 revision = av.updateSkillListing(listingId, "uri-v2", "Name", "Description", PRICE + 1_000_000);

        AgentVouchTypes.SkillListing memory listing = av.getListing(listingId);
        AgentVouchTypes.ListingSettlement memory oldSettlement = av.getSettlement(listingId, 1);
        AgentVouchTypes.ListingSettlement memory newSettlement = av.getSettlement(listingId, 2);
        assertEq(revision, 2);
        assertEq(listing.currentRevision, 2);
        assertEq(listing.uri, "uri-v2");
        assertEq(listing.priceUsdcMicros, PRICE + 1_000_000);
        assertTrue(oldSettlement.initialized);
        assertTrue(newSettlement.initialized);
        assertEq(newSettlement.createdAt, block.timestamp);
        assertEq(newSettlement.updatedAt, block.timestamp);
    }

    function test_openDisputeBlocksBumpButAllowsMetadataOnlyUpdate() public {
        vm.prank(reporter);
        av.openReport(author, "ipfs://evidence");

        vm.prank(author);
        av.updateSkillListing(listingId, "uri-v1", "Allowed Name", "Allowed Description", PRICE);
        assertEq(av.getListing(listingId).name, "Allowed Name");

        vm.prank(author);
        vm.expectRevert(AgentVouchEvm.DisputeLocked.selector);
        av.updateSkillListing(listingId, "uri-v2", "Allowed Name", "Allowed Description", PRICE);

        vm.prank(author);
        vm.expectRevert(AgentVouchEvm.DisputeLocked.selector);
        av.updateSkillListing(listingId, "uri-v1", "Allowed Name", "Allowed Description", PRICE + 1_000_000);
    }

    function test_pausedNonAuthorMissingAndRemovedReverts() public {
        vm.prank(otherAuthor);
        vm.expectRevert(AgentVouchEvm.NotListingAuthor.selector);
        av.updateSkillListing(listingId, "uri-v1", "Name", "Description", PRICE);

        vm.prank(author);
        vm.expectRevert(AgentVouchEvm.ListingNotFound.selector);
        av.updateSkillListing(bytes32("missing"), "uri", "Name", "Description", PRICE);

        vm.prank(admin);
        av.setPaused(true);
        vm.prank(author);
        vm.expectRevert();
        av.updateSkillListing(listingId, "uri-v1", "Name", "Description", PRICE);

        vm.prank(admin);
        av.setPaused(false);
        vm.prank(author);
        av.removeSkillListing(listingId);
        vm.prank(author);
        vm.expectRevert(AgentVouchEvm.ListingNotActive.selector);
        av.updateSkillListing(listingId, "uri-v1", "Name", "Description", PRICE);
    }

    function test_fieldValidationAndPriceFloor() public {
        vm.startPrank(author);
        vm.expectRevert(AgentVouchEvm.EmptyListingUri.selector);
        av.updateSkillListing(listingId, "", "Name", "Description", PRICE);
        vm.expectRevert(AgentVouchEvm.EmptyListingName.selector);
        av.updateSkillListing(listingId, "uri-v1", "", "Description", PRICE);
        vm.expectRevert(AgentVouchEvm.ListingUriTooLong.selector);
        av.updateSkillListing(listingId, _longString(257), "Name", "Description", PRICE);
        vm.expectRevert(AgentVouchEvm.ListingNameTooLong.selector);
        av.updateSkillListing(listingId, "uri-v1", _longString(65), "Description", PRICE);
        vm.expectRevert(AgentVouchEvm.ListingDescriptionTooLong.selector);
        av.updateSkillListing(listingId, "uri-v1", "Name", _longString(257), PRICE);
        vm.expectRevert(AgentVouchEvm.BelowMinPaidPrice.selector);
        av.updateSkillListing(listingId, "uri-v1", "Name", "Description", MIN_PAID - 1);
        vm.stopPrank();
    }

    function test_exactMaxFieldLengthsAccepted() public {
        string memory maxUri = _longString(256);
        string memory maxName = _longString(64);
        string memory maxDescription = _longString(256);

        vm.prank(author);
        uint64 revision = av.updateSkillListing(listingId, maxUri, maxName, maxDescription, PRICE);

        AgentVouchTypes.SkillListing memory listing = av.getListing(listingId);
        assertEq(revision, 2);
        assertEq(listing.currentRevision, 2);
        assertEq(listing.uri, maxUri);
        assertEq(listing.name, maxName);
        assertEq(listing.description, maxDescription);
        assertEq(listing.priceUsdcMicros, PRICE);
        assertTrue(av.getSettlement(listingId, 2).initialized);
    }

    function test_freePaidTransitionsMaintainCounterAndBondFloor() public {
        vm.prank(author);
        vm.expectRevert(AgentVouchEvm.FreeListingBondFloor.selector);
        av.updateSkillListing(listingId, "uri-v1", "Name", "Description", 0);

        vm.startPrank(author);
        av.depositAuthorBond(FLOOR);
        av.updateSkillListing(listingId, "uri-v1", "Name", "Description", 0);
        assertEq(av.getProfile(author).activeFreeListingCount, 1);
        av.updateSkillListing(listingId, "uri-v1", "Name", "Description", PRICE);
        assertEq(av.getProfile(author).activeFreeListingCount, 0);
        vm.stopPrank();
    }

    function test_oldRevisionProceedsRemainWithdrawableAfterBump() public {
        vm.prank(buyer);
        av.purchaseSkill(listingId);
        assertEq(av.getSettlement(listingId, 1).authorProceedsUsdcMicros, PRICE);

        vm.prank(author);
        av.updateSkillListing(listingId, "uri-v2", "Name", "Description", PRICE + 1_000_000);

        uint256 beforeBalance = usdc.balanceOf(author);
        vm.prank(author);
        av.withdrawAuthorProceeds(listingId, 1, PRICE);
        assertEq(usdc.balanceOf(author) - beforeBalance, PRICE);
        assertEq(av.getSettlement(listingId, 1).authorProceedsUsdcMicros, 0);
        assertEq(av.getSettlement(listingId, 2).authorProceedsUsdcMicros, 0);
    }

    function test_purchaseAtNewRevisionAndSameBuyerCanBuyAgain() public {
        vm.prank(buyer);
        bytes32 rev1Purchase = av.purchaseSkill(listingId);

        vm.prank(author);
        av.updateSkillListing(listingId, "uri-v2", "Name", "Description", PRICE + 1_000_000);

        vm.prank(buyer);
        bytes32 rev2Purchase = av.purchaseSkill(listingId);

        assertTrue(rev1Purchase != rev2Purchase);
        assertEq(av.getPurchase(rev1Purchase).revision, 1);
        assertEq(av.getPurchase(rev2Purchase).revision, 2);
        assertEq(av.getPurchase(rev2Purchase).priceUsdcMicros, PRICE + 1_000_000);
        assertEq(av.getSettlement(listingId, 2).authorProceedsUsdcMicros, PRICE + 1_000_000);
    }

    function test_staleEip3009AuthorizationFailsAfterBump() public {
        vm.warp(1000);
        bytes32 oldNonce = _boundNonce(buyer2, listingId, 1, PRICE);
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(buyer2Pk, buyer2, PRICE, 0, block.timestamp + 1 hours, oldNonce);

        vm.prank(author);
        av.updateSkillListing(listingId, "uri-v2", "Name", "Description", PRICE + 1_000_000);

        vm.prank(relayer);
        vm.expectRevert(bytes("auth: invalid signature"));
        av.purchaseWithAuthorization(listingId, buyer2, 0, block.timestamp + 1 hours, v, r, s);
        assertFalse(usdc.authorizationState(buyer2, oldNonce));
    }
}
