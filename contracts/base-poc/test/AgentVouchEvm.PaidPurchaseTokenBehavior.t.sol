// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgentVouchEvm} from "../src/AgentVouchEvm.sol";
import {AgentVouchTypes} from "../src/libraries/AgentVouchTypes.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract AdversarialUSDC is MockUSDC {
    bool public returnFalse;
    mapping(address => bool) public blockedRecipient;

    function setReturnFalse(bool enabled) external {
        returnFalse = enabled;
    }

    function setBlockedRecipient(address recipient, bool blocked) external {
        blockedRecipient[recipient] = blocked;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (blockedRecipient[to]) revert("blocked recipient");
        if (returnFalse) return false;
        return super.transfer(to, value);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (blockedRecipient[to]) revert("blocked recipient");
        if (returnFalse) return false;
        return super.transferFrom(from, to, value);
    }
}

/// @notice ERC-20-shaped token whose transfer methods return no data, matching
///         the legacy token behavior SafeERC20 is designed to support.
contract NoReturnUSDC {
    string public constant name = "No Return USDC";
    string public constant symbol = "nrUSDC";
    uint8 public constant decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function transfer(address to, uint256 amount) external {
        _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

contract PaidPurchaseTokenBehaviorTest is Test {
    address internal constant ADMIN = address(0xA11CE);
    address internal constant AUTHOR = address(0xA0);
    address internal constant BUYER = address(0xB0);
    address internal constant RESERVE = address(0xD00D);

    function test_falseReturnRollsBackReceiptConsumptionAndCreditHandling() public {
        AdversarialUSDC token = new AdversarialUSDC();
        AgentVouchEvm av = _deploy(address(token));
        _seedAdversarial(token, av, AUTHOR);
        _seedAdversarial(token, av, BUYER);
        (bytes32 listing, bytes32 purchase) = _listingAndPurchase(av);

        token.setReturnFalse(true);
        vm.prank(BUYER);
        vm.expectRevert();
        av.openPaidPurchaseReport(AUTHOR, listing, purchase, "evidence");

        token.setReturnFalse(false);
        vm.prank(BUYER);
        uint64 reportId = av.openPaidPurchaseReport(AUTHOR, listing, purchase, "evidence");
        (,,,,, uint64 reviewDeadline,,,,) = av.getPaidPurchaseReportCore(reportId);
        vm.warp(reviewDeadline);
        av.closePaidPurchaseReportCredit(reportId);

        token.setReturnFalse(true);
        vm.prank(BUYER);
        vm.expectRevert();
        av.claimPaidPurchaseReportCredit(reportId);

        token.setReturnFalse(false);
        vm.prank(BUYER);
        av.claimPaidPurchaseReportCredit(reportId);
        (,,,,,,,, bool handled) = av.getPaidPurchaseReportSettlement(reportId);
        assertTrue(handled);
    }

    function test_blacklistedBuyerAndReserveCannotBlockFinalizationOrCorruptClaims() public {
        AdversarialUSDC token = new AdversarialUSDC();
        AgentVouchEvm av = _deploy(address(token));
        _seedAdversarial(token, av, AUTHOR);
        _seedAdversarial(token, av, BUYER);
        (bytes32 listing, bytes32 purchase) = _listingAndPurchase(av);

        token.setBlockedRecipient(BUYER, true);
        token.setBlockedRecipient(RESERVE, true);
        vm.prank(BUYER);
        uint64 reportId = av.openPaidPurchaseReport(AUTHOR, listing, purchase, "evidence");
        vm.startPrank(ADMIN);
        av.reviewPaidPurchaseReport(reportId, true);
        av.resolvePaidPurchaseReport(reportId, uint8(AgentVouchTypes.PaidPurchaseReportRuling.Upheld));
        vm.stopPrank();

        (,,,,,,,, uint8 status, uint8 outcome) = av.getPaidPurchaseReportCore(reportId);
        assertEq(status, uint8(AgentVouchTypes.PaidPurchaseReportStatus.Terminal));
        assertEq(outcome, uint8(AgentVouchTypes.PaidPurchaseReportOutcome.Upheld));

        vm.prank(BUYER);
        vm.expectRevert("blocked recipient");
        av.claimPaidPurchaseReportCredit(reportId);
        token.setBlockedRecipient(BUYER, false);
        vm.prank(BUYER);
        av.claimPaidPurchaseReportCredit(reportId);

        // This uphold has no reserve excess, so create deterministic reserve credit
        // through a separate rejected report on a fresh receipt.
        vm.prank(AUTHOR);
        av.updateSkillListing(listing, "ipfs://skill-v2", "skill", "desc", 10_000_000);
        vm.prank(BUYER);
        bytes32 secondPurchase = av.purchaseSkill(listing);
        vm.prank(BUYER);
        uint64 secondReport = av.openPaidPurchaseReport(AUTHOR, listing, secondPurchase, "evidence-2");
        vm.prank(ADMIN);
        av.reviewPaidPurchaseReport(secondReport, false);

        vm.prank(RESERVE);
        vm.expectRevert("blocked recipient");
        av.claimRestitutionReserve();
        token.setBlockedRecipient(RESERVE, false);
        vm.prank(RESERVE);
        av.claimRestitutionReserve();
    }

    function test_noReturnTokenSupportsPurchaseReportAndCreditClaim() public {
        NoReturnUSDC token = new NoReturnUSDC();
        AgentVouchEvm av = _deploy(address(token));
        _seedNoReturn(token, av, AUTHOR);
        _seedNoReturn(token, av, BUYER);
        (bytes32 listing, bytes32 purchase) = _listingAndPurchase(av);

        vm.prank(BUYER);
        uint64 reportId = av.openPaidPurchaseReport(AUTHOR, listing, purchase, "evidence");
        (,,,,, uint64 reviewDeadline,,,,) = av.getPaidPurchaseReportCore(reportId);
        vm.warp(reviewDeadline);
        av.closePaidPurchaseReportCredit(reportId);
        uint256 beforeBalance = token.balanceOf(BUYER);
        vm.prank(BUYER);
        av.claimPaidPurchaseReportCredit(reportId);
        assertEq(token.balanceOf(BUYER) - beforeBalance, 5_000_000);
    }

    function _deploy(address token) internal returns (AgentVouchEvm av) {
        vm.chainId(84532);
        av = new AgentVouchEvm(token, ADMIN);
        vm.prank(ADMIN);
        av.initializeConfig(_cfg(token));
    }

    function _listingAndPurchase(AgentVouchEvm av) internal returns (bytes32 listing, bytes32 purchase) {
        vm.prank(AUTHOR);
        listing = av.createSkillListing(keccak256("token-behavior"), "ipfs://skill", "skill", "desc", 10_000_000);
        vm.prank(BUYER);
        purchase = av.purchaseSkill(listing);
    }

    function _seedAdversarial(AdversarialUSDC token, AgentVouchEvm av, address who) internal {
        token.mint(who, 100_000_000);
        vm.startPrank(who);
        token.approve(address(av), type(uint256).max);
        av.registerAgent("ipfs://agent");
        vm.stopPrank();
    }

    function _seedNoReturn(NoReturnUSDC token, AgentVouchEvm av, address who) internal {
        token.mint(who, 100_000_000);
        vm.startPrank(who);
        token.approve(address(av), type(uint256).max);
        av.registerAgent("ipfs://agent");
        vm.stopPrank();
    }

    function _cfg(address token) internal pure returns (AgentVouchTypes.Config memory c) {
        c.usdc = token;
        c.chainContext = "eip155:84532";
        c.minVouchStakeUsdcMicros = 1_000_000;
        c.disputeBondUsdcMicros = 5_000_000;
        c.minAuthorBondForFreeListingUsdcMicros = 1_000_000;
        c.minPaidListingPriceUsdcMicros = 10_000;
        c.authorShareBps = 6_000;
        c.voucherShareBps = 4_000;
        c.slashPercentage = 50;
        c.refundClaimWindowSeconds = 7 days;
        c.treasuryRecipient = RESERVE;
    }
}
