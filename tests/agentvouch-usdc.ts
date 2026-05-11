import { assert } from "chai";
import {
  ONE_USDC,
  assertTokenDelta,
  claimVoucherRevenue,
  createActor,
  depositAuthorBond,
  getTestContext,
  openAuthorDispute,
  purchaseSkill,
  registerAgent,
  resolveAuthorDispute,
  setupPaidListingWithVouch,
  tokenAmount,
  u64,
} from "./helpers/agentvouchUsdc";

describe("agentvouch usdc-native protocol", () => {
  it("runs the USDC-native publish, vouch, purchase, claim, and dismissed dispute path", async () => {
    const ctx = await getTestContext();
    const { author, voucher, buyer, bond, vouch, listing, position } =
      await setupPaidListingWithVouch(ctx);

    const purchase = await purchaseSkill(
      ctx,
      buyer,
      author,
      listing.skillListing,
      listing.vault,
      "purchase_skill happy path"
    );
    const authorBalanceBeforeClaim = await tokenAmount(ctx, author.usdc);
    assert.equal(
      Number(authorBalanceBeforeClaim),
      20 * ONE_USDC - 4 * ONE_USDC
    );

    const voucherBalanceBefore = await tokenAmount(ctx, voucher.usdc);
    await claimVoucherRevenue(
      ctx,
      voucher,
      author,
      listing.skillListing,
      position,
      vouch.vouch,
      listing.vault,
      "claim_voucher_revenue happy path"
    );
    await assertTokenDelta(ctx, voucher.usdc, voucherBalanceBefore, 799_999);

    const challenger = await createActor(ctx);
    await registerAgent(ctx, challenger, "https://example.com/challenger.json");
    const disputeId = u64(Date.now());
    const dispute = await openAuthorDispute(
      ctx,
      challenger,
      author,
      listing.skillListing,
      purchase,
      disputeId,
      "open_author_dispute dismissed path"
    );

    const treasuryBefore = await tokenAmount(ctx, ctx.protocolTreasuryVault);
    await resolveAuthorDispute(
      ctx,
      author,
      challenger,
      disputeId,
      dispute,
      { dismissed: {} },
      [],
      "resolve_author_dispute dismissed path"
    );
    await assertTokenDelta(
      ctx,
      ctx.protocolTreasuryVault,
      treasuryBefore,
      0.5 * ONE_USDC
    );

    const authorBond = await ctx.program.account.authorBond.fetch(
      bond.authorBond
    );
    assert.equal(Number(authorBond.amountUsdcMicros), 4 * ONE_USDC);
  });

  it("initializes config with local USDC mint and protocol vaults", async () => {
    const ctx = await getTestContext();
    const config = await ctx.program.account.reputationConfig.fetch(ctx.config);
    assert.equal(config.usdcMint.toBase58(), ctx.usdcMint.toBase58());
    assert.equal(
      config.protocolTreasuryVault.toBase58(),
      ctx.protocolTreasuryVault.toBase58()
    );
    assert.equal(
      config.x402SettlementVault.toBase58(),
      ctx.x402SettlementVault.toBase58()
    );
  });
});
