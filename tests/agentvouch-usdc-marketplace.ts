import { SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { assert } from "chai";
import {
  ONE_USDC,
  authorBondPda,
  assertTokenDelta,
  claimPurchaseRefund,
  claimVoucherRevenue,
  createRefundPool,
  createActor,
  createSkillListing,
  createVouch,
  depositAuthorBond,
  expectFailure,
  getTestContext,
  linkVouchToListing,
  openAuthorDispute,
  purchasePda,
  purchaseSkill,
  registerAgent,
  resolveAuthorDispute,
  setupPaidListingWithVouch,
  tokenAmount,
  u64,
  withdrawAuthorProceeds,
  unlinkVouchFromListing,
  uniqueSkillId,
} from "./helpers/agentvouchUsdc";

describe("agentvouch usdc marketplace rewards", () => {
  it("records purchase splits and reward index accounting", async () => {
    const ctx = await getTestContext();
    const { author, buyer, listing } = await setupPaidListingWithVouch(
      ctx,
      5 * ONE_USDC
    );

    const authorBefore = await tokenAmount(ctx, author.usdc);
    const proceedsBefore = await tokenAmount(ctx, listing.proceedsVault);
    const rewardVaultBefore = await tokenAmount(ctx, listing.vault);
    const purchase = await purchaseSkill(
      ctx,
      buyer,
      author,
      listing.skillListing,
      listing.vault,
      "purchase_skill split accounting"
    );

    await assertTokenDelta(ctx, author.usdc, authorBefore, 0);
    await assertTokenDelta(
      ctx,
      listing.proceedsVault,
      proceedsBefore,
      3 * ONE_USDC
    );
    await assertTokenDelta(ctx, listing.vault, rewardVaultBefore, 2 * ONE_USDC);

    const listingAccount = await ctx.program.account.skillListing.fetch(
      listing.skillListing
    );
    const purchaseAccount = await ctx.program.account.purchase.fetch(purchase);
    assert.equal(Number(listingAccount.totalRevenueUsdcMicros), 5 * ONE_USDC);
    assert.equal(
      Number(listingAccount.totalAuthorRevenueUsdcMicros),
      3 * ONE_USDC
    );
    assert.equal(
      Number(listingAccount.totalVoucherRevenueUsdcMicros),
      2 * ONE_USDC
    );
    assert.equal(Number(purchaseAccount.pricePaidUsdcMicros), 5 * ONE_USDC);
    assert.equal(Number(purchaseAccount.listingRevision), 0);
    assert.equal(
      purchaseAccount.listingSettlement.toBase58(),
      listing.settlement.toBase58()
    );

    await withdrawAuthorProceeds(
      ctx,
      author,
      listing.skillListing,
      3 * ONE_USDC
    );
    await assertTokenDelta(ctx, author.usdc, authorBefore, 3 * ONE_USDC);
  });

  it("accrues rewards on unlink and allows the voucher to claim later", async () => {
    const ctx = await getTestContext();
    const { author, voucher, buyer, vouch, listing, position } =
      await setupPaidListingWithVouch(ctx);

    await purchaseSkill(
      ctx,
      buyer,
      author,
      listing.skillListing,
      listing.vault
    );
    await unlinkVouchFromListing(
      ctx,
      voucher,
      author,
      listing.skillListing,
      position,
      vouch.vouch
    );

    const positionAfterUnlink =
      await ctx.program.account.listingVouchPosition.fetch(position);
    assert.property(positionAfterUnlink.status, "unlinked");
    assert.equal(Number(positionAfterUnlink.pendingRewardsUsdcMicros), 799_999);

    const voucherBefore = await tokenAmount(ctx, voucher.usdc);
    await claimVoucherRevenue(
      ctx,
      voucher,
      author,
      listing.skillListing,
      position,
      vouch.vouch,
      listing.vault
    );
    await assertTokenDelta(ctx, voucher.usdc, voucherBefore, 799_999);
  });

  it("rejects unsupported prices and purchases without active reward stake", async () => {
    const ctx = await getTestContext();
    const author = await createActor(ctx);
    const buyer = await createActor(ctx);
    await registerAgent(ctx, author);
    await depositAuthorBond(ctx, author, ONE_USDC);

    await expectFailure(
      createSkillListing(ctx, author, uniqueSkillId("floor"), 1),
      "Price must be zero or at least the minimum paid listing price"
    );

    const listing = await createSkillListing(
      ctx,
      author,
      uniqueSkillId("nostake"),
      ONE_USDC
    );
    await expectFailure(
      purchaseSkill(ctx, buyer, author, listing.skillListing, listing.vault),
      "Paid purchases require active linked vouch stake"
    );
  });

  it("rejects invalid purchase and claim accounts", async () => {
    const ctx = await getTestContext();
    const { author, voucher, buyer, vouch, listing, position } =
      await setupPaidListingWithVouch(ctx);
    const purchase = purchasePda(
      ctx.program,
      buyer.keypair.publicKey,
      listing.skillListing
    );

    await expectFailure(
      ctx.program.methods
        .purchaseSkill()
        .accounts({
          skillListing: listing.skillListing,
          purchase,
          author: author.keypair.publicKey,
          authorProfile: author.profile,
          config: ctx.config,
          usdcMint: ctx.usdcMint,
          buyerUsdcAccount: buyer.usdc,
          listingSettlement: listing.settlement,
          authorProceedsVaultAuthority: listing.proceedsVaultAuthority,
          authorProceedsVault: buyer.usdc,
          rewardVault: listing.vault,
          buyer: buyer.keypair.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer.keypair])
        .rpc(),
      "Token account owner is invalid"
    );

    await expectFailure(
      ctx.program.methods
        .purchaseSkill()
        .accounts({
          skillListing: listing.skillListing,
          purchase,
          author: author.keypair.publicKey,
          authorProfile: author.profile,
          config: ctx.config,
          usdcMint: ctx.usdcMint,
          buyerUsdcAccount: buyer.usdc,
          listingSettlement: listing.settlement,
          authorProceedsVaultAuthority: listing.proceedsVaultAuthority,
          authorProceedsVault: listing.proceedsVault,
          rewardVault: ctx.protocolTreasuryVault,
          buyer: buyer.keypair.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer.keypair])
        .rpc(),
      "Reward vault does not match listing state"
    );

    await expectFailure(
      claimVoucherRevenue(
        ctx,
        voucher,
        author,
        listing.skillListing,
        position,
        vouch.vouch,
        listing.vault
      ),
      "No unclaimed revenue available"
    );
  });

  it("locks settlement during paid disputes and supports bounded buyer refund claims", async () => {
    const ctx = await getTestContext();
    const { author, buyer, challenger, listing, bond } = {
      ...(await setupPaidListingWithVouch(ctx, 5 * ONE_USDC)),
      challenger: await createActor(ctx),
    };
    const purchase = await purchaseSkill(
      ctx,
      buyer,
      author,
      listing.skillListing,
      listing.vault
    );
    const disputeId = u64(Date.now() % 1_000_000);
    const dispute = await openAuthorDispute(
      ctx,
      challenger,
      author,
      listing.skillListing,
      purchase,
      disputeId
    );

    await expectFailure(
      withdrawAuthorProceeds(ctx, author, listing.skillListing, ONE_USDC),
      "Author proceeds are locked by an open dispute"
    );

    await resolveAuthorDispute(
      ctx,
      author,
      challenger,
      disputeId,
      dispute,
      { upheld: {} },
      [
        {
          pubkey: authorBondPda(ctx.program, author.keypair.publicKey),
          isWritable: true,
          isSigner: false,
        },
        {
          pubkey: bond.vault,
          isWritable: true,
          isSigner: false,
        },
      ]
    );

    const buyerBefore = await tokenAmount(ctx, buyer.usdc);
    const { refundPool } = await createRefundPool(
      ctx,
      author,
      challenger,
      dispute,
      2 * ONE_USDC
    );
    await claimPurchaseRefund(ctx, buyer, refundPool, purchase);
    await assertTokenDelta(ctx, buyer.usdc, buyerBefore, 2 * ONE_USDC);

    await expectFailure(claimPurchaseRefund(ctx, buyer, refundPool, purchase), [
      "already in use",
      "already exists",
    ]);
  });

  it("enforces the max active reward position cap", async () => {
    const ctx = await getTestContext();
    const author = await createActor(ctx);
    await registerAgent(ctx, author);
    await depositAuthorBond(ctx, author, ONE_USDC);
    const listing = await createSkillListing(
      ctx,
      author,
      uniqueSkillId("maxlinks"),
      ONE_USDC
    );

    for (let index = 0; index < 32; index += 1) {
      const voucher = await createActor(ctx);
      await registerAgent(ctx, voucher);
      const vouch = await createVouch(ctx, voucher, author, ONE_USDC);
      await linkVouchToListing(
        ctx,
        voucher,
        author,
        listing.skillListing,
        vouch.vouch,
        index === 31 ? "link_vouch_to_listing max active path" : undefined
      );
    }

    const listingAccount = await ctx.program.account.skillListing.fetch(
      listing.skillListing
    );
    assert.equal(Number(listingAccount.activeRewardPositionCount), 32);

    const extraVoucher = await createActor(ctx);
    await registerAgent(ctx, extraVoucher);
    const extraVouch = await createVouch(ctx, extraVoucher, author, ONE_USDC);
    await expectFailure(
      linkVouchToListing(
        ctx,
        extraVoucher,
        author,
        listing.skillListing,
        extraVouch.vouch
      ),
      "Listing has reached the active reward position limit"
    );
  });
});
