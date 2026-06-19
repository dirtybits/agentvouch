import { assert } from "chai";
import {
  ONE_USDC,
  assertTokenDelta,
  claimVoucherRevenue,
  claimPurchaseRefund,
  createActor,
  createSkillListing,
  createRefundPool,
  createVouch,
  depositAuthorBond,
  expectFailure,
  fundX402SettlementVault,
  getTestContext,
  linkVouchToListing,
  openAuthorDispute,
  purchaseSkill,
  registerAgent,
  resolveAuthorDispute,
  setPaused,
  settleX402Purchase,
  setupPaidListingWithVouch,
  tokenAmount,
  u64,
  withdrawAuthorBond,
  withdrawAuthorProceeds,
} from "./helpers/agentvouchUsdc";

describe("agentvouch usdc-native protocol", () => {
  afterEach(async () => {
    const ctx = await getTestContext();
    const config = await ctx.program.account.reputationConfig.fetch(ctx.config);
    if (config.paused) {
      await setPaused(ctx, false);
    }
  });

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

  it("lets pause authority toggle the protocol and rejects other signers", async () => {
    const ctx = await getTestContext();
    const stranger = await createActor(ctx);

    await expectFailure(
      setPaused(ctx, true, stranger.keypair),
      "Pause authority mismatch"
    );

    await setPaused(ctx, true);
    let config = await ctx.program.account.reputationConfig.fetch(ctx.config);
    assert.equal(config.paused, true);

    await setPaused(ctx, true);
    config = await ctx.program.account.reputationConfig.fetch(ctx.config);
    assert.equal(config.paused, true);

    await setPaused(ctx, false);
    config = await ctx.program.account.reputationConfig.fetch(ctx.config);
    assert.equal(config.paused, false);
  });

  it("blocks new risk and author collateral exits while paused", async () => {
    const ctx = await getTestContext();
    const { author, voucher, buyer, bond, vouch, listing } =
      await setupPaidListingWithVouch(ctx);
    const challenger = await createActor(ctx);
    const extraVoucher = await createActor(ctx);
    await registerAgent(ctx, challenger, "https://example.com/challenger.json");
    await registerAgent(ctx, extraVoucher, "https://example.com/voucher2.json");

    await setPaused(ctx, true);

    await expectFailure(
      createSkillListing(ctx, author, "paused-listing", 2 * ONE_USDC),
      "Protocol is paused"
    );
    await expectFailure(
      depositAuthorBond(ctx, author, ONE_USDC),
      "Protocol is paused"
    );
    await expectFailure(
      createVouch(ctx, extraVoucher, author, ONE_USDC),
      "Protocol is paused"
    );
    await expectFailure(
      linkVouchToListing(
        ctx,
        voucher,
        author,
        listing.skillListing,
        vouch.vouch
      ),
      "Protocol is paused"
    );
    await expectFailure(
      purchaseSkill(
        ctx,
        buyer,
        author,
        listing.skillListing,
        listing.vault
      ),
      "Protocol is paused"
    );
    await fundX402SettlementVault(ctx, 2 * ONE_USDC);
    await expectFailure(
      settleX402Purchase(
        ctx,
        buyer,
        author,
        listing.skillListing,
        Buffer.alloc(32, 42),
        Buffer.alloc(32, 43),
        2 * ONE_USDC
      ),
      "Protocol is paused"
    );
    await expectFailure(
      openAuthorDispute(
        ctx,
        challenger,
        author,
        listing.skillListing,
        null,
        u64(Date.now())
      ),
      "Protocol is paused"
    );
    await expectFailure(
      withdrawAuthorBond(ctx, author, ONE_USDC),
      "Protocol is paused"
    );

    await setPaused(ctx, false);
    await withdrawAuthorBond(ctx, author, ONE_USDC);
    const authorBond = await ctx.program.account.authorBond.fetch(
      bond.authorBond
    );
    assert.equal(Number(authorBond.amountUsdcMicros), 3 * ONE_USDC);
  });

  it("allows buyer refunds and voucher revenue claims while paused", async () => {
    const ctx = await getTestContext();
    const refundAuthor = await createActor(ctx);
    const refundBuyer = await createActor(ctx);
    const challenger = await createActor(ctx);

    await registerAgent(
      ctx,
      refundAuthor,
      "https://example.com/refund-author.json"
    );
    await registerAgent(
      ctx,
      challenger,
      "https://example.com/refund-challenger.json"
    );

    const vouch = await setupPaidListingWithVouch(ctx, 2 * ONE_USDC);
    await purchaseSkill(
      ctx,
      vouch.buyer,
      vouch.author,
      vouch.listing.skillListing,
      vouch.listing.vault
    );
    const voucherBalanceBefore = await tokenAmount(ctx, vouch.voucher.usdc);

    await setPaused(ctx, true);
    await claimVoucherRevenue(
      ctx,
      vouch.voucher,
      vouch.author,
      vouch.listing.skillListing,
      vouch.position,
      vouch.vouch.vouch,
      vouch.listing.vault
    );
    await assertTokenDelta(
      ctx,
      vouch.voucher.usdc,
      voucherBalanceBefore,
      799_999
    );

    await expectFailure(
      withdrawAuthorProceeds(
        ctx,
        vouch.author,
        vouch.listing.skillListing,
        ONE_USDC
      ),
      "Protocol is paused"
    );

    await setPaused(ctx, false);

    const refundListing = await createSkillListing(
      ctx,
      refundAuthor,
      "pause-refund",
      2 * ONE_USDC
    );
    const refundPurchase = await purchaseSkill(
      ctx,
      refundBuyer,
      refundAuthor,
      refundListing.skillListing,
      refundListing.vault
    );
    const disputeId = u64(Date.now() + 99);
    const dispute = await openAuthorDispute(
      ctx,
      challenger,
      refundAuthor,
      refundListing.skillListing,
      refundPurchase,
      disputeId
    );
    await resolveAuthorDispute(
      ctx,
      refundAuthor,
      challenger,
      disputeId,
      dispute,
      { upheld: {} }
    );
    const refundPool = await createRefundPool(
      ctx,
      refundAuthor,
      challenger,
      dispute,
      2 * ONE_USDC
    );

    const buyerBalanceBeforeRefund = await tokenAmount(ctx, refundBuyer.usdc);
    await setPaused(ctx, true);
    await claimPurchaseRefund(
      ctx,
      refundBuyer,
      refundPool.refundPool,
      refundPurchase
    );
    await assertTokenDelta(
      ctx,
      refundBuyer.usdc,
      buyerBalanceBeforeRefund,
      1.8 * ONE_USDC
    );
  });
});
