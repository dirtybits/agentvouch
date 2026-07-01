import { Keypair, SystemProgram } from "@solana/web3.js";
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
  fundSol,
  fundX402SettlementVault,
  getTestContext,
  linkVouchToListing,
  openAuthorDispute,
  purchasePda,
  purchaseSkill,
  registerAgent,
  resolveAuthorDispute,
  settleX402Purchase,
  setupPaidListingWithVouch,
  tokenAmount,
  u64,
  withdrawAuthorProceeds,
  uniqueSkillId,
} from "./helpers/agentvouchUsdc";

describe("agentvouch usdc marketplace rewards", () => {
  it("keeps protocol fee deferred while author and voucher shares consume the full split", async () => {
    const ctx = await getTestContext();
    const config = await ctx.program.account.reputationConfig.fetch(ctx.config);
    const authorShareBps = Number(config.authorShareBps);
    const voucherShareBps = Number(config.voucherShareBps);
    const protocolFeeBps = Number(config.protocolFeeBps);

    assert.equal(protocolFeeBps, 0);
    assert.equal(authorShareBps, 6_000);
    assert.equal(voucherShareBps, 4_000);
    assert.equal(authorShareBps + voucherShareBps + protocolFeeBps, 10_000);
    assert.equal(authorShareBps + voucherShareBps, 10_000);
  });

  it("settles x402 purchases through the protocol vault and preserves voucher economics", async () => {
    const ctx = await getTestContext();
    const { author, buyer, listing } = await setupPaidListingWithVouch(
      ctx,
      5 * ONE_USDC
    );

    await fundX402SettlementVault(ctx, 5 * ONE_USDC);

    const settlementBefore = await tokenAmount(ctx, ctx.x402SettlementVault);
    const proceedsBefore = await tokenAmount(ctx, listing.proceedsVault);
    const rewardVaultBefore = await tokenAmount(ctx, listing.vault);
    const paymentRefHash = Buffer.alloc(32, 1);
    const settlementTxSignatureHash = Buffer.alloc(32, 2);
    const { purchase, receipt, signatureGuard } = await settleX402Purchase(
      ctx,
      buyer,
      author,
      listing.skillListing,
      paymentRefHash,
      settlementTxSignatureHash,
      5 * ONE_USDC,
      "settle_x402_purchase split accounting"
    );

    await assertTokenDelta(
      ctx,
      ctx.x402SettlementVault,
      settlementBefore,
      -5 * ONE_USDC
    );
    await assertTokenDelta(
      ctx,
      listing.proceedsVault,
      proceedsBefore,
      3 * ONE_USDC
    );
    await assertTokenDelta(ctx, listing.vault, rewardVaultBefore, 2 * ONE_USDC);

    const purchaseAccount = await ctx.program.account.purchase.fetch(purchase);
    const receiptAccount =
      await ctx.program.account.x402SettlementReceipt.fetch(receipt);
    const signatureGuardAccount =
      await ctx.program.account.x402SettlementSignatureGuard.fetch(
        signatureGuard
      );

    assert.equal(
      purchaseAccount.buyer.toBase58(),
      buyer.keypair.publicKey.toBase58()
    );
    assert.equal(Number(purchaseAccount.pricePaidUsdcMicros), 5 * ONE_USDC);
    assert.equal(Number(purchaseAccount.authorShareUsdcMicros), 3 * ONE_USDC);
    assert.equal(Number(purchaseAccount.voucherPoolUsdcMicros), 2 * ONE_USDC);
    assert.equal(receiptAccount.purchase.toBase58(), purchase.toBase58());
    assert.deepEqual(
      Buffer.from(receiptAccount.paymentRefHash),
      paymentRefHash
    );
    assert.deepEqual(
      Buffer.from(receiptAccount.settlementTxSignatureHash),
      settlementTxSignatureHash
    );
    assert.equal(signatureGuardAccount.receipt.toBase58(), receipt.toBase58());
  });

  it("rejects x402 settlement amount mismatches", async () => {
    const ctx = await getTestContext();
    const { author, buyer, listing } = await setupPaidListingWithVouch(
      ctx,
      ONE_USDC
    );

    await fundX402SettlementVault(ctx, ONE_USDC);

    await expectFailure(
      settleX402Purchase(
        ctx,
        buyer,
        author,
        listing.skillListing,
        Buffer.alloc(32, 3),
        Buffer.alloc(32, 4),
        ONE_USDC + 1
      ),
      "x402 settlement amount must match the listing price"
    );
  });

  it("rejects duplicate x402 payment refs and settlement signatures", async () => {
    const ctx = await getTestContext();
    const author = await createActor(ctx);
    const buyer = await createActor(ctx);
    const secondBuyer = await createActor(ctx);
    await registerAgent(ctx, author);

    const listing = await createSkillListing(
      ctx,
      author,
      uniqueSkillId("x402dupa"),
      ONE_USDC
    );
    const secondListing = await createSkillListing(
      ctx,
      author,
      uniqueSkillId("x402dupb"),
      ONE_USDC
    );
    await fundX402SettlementVault(ctx, 3 * ONE_USDC);

    const paymentRefHash = Buffer.alloc(32, 5);
    const settlementTxSignatureHash = Buffer.alloc(32, 6);
    await settleX402Purchase(
      ctx,
      buyer,
      author,
      listing.skillListing,
      paymentRefHash,
      settlementTxSignatureHash,
      ONE_USDC
    );

    await expectFailure(
      settleX402Purchase(
        ctx,
        secondBuyer,
        author,
        secondListing.skillListing,
        paymentRefHash,
        Buffer.alloc(32, 7),
        ONE_USDC
      ),
      "already in use"
    );

    await expectFailure(
      settleX402Purchase(
        ctx,
        secondBuyer,
        author,
        secondListing.skillListing,
        Buffer.alloc(32, 8),
        settlementTxSignatureHash,
        ONE_USDC
      ),
      "already in use"
    );
  });

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

  it("accrues author-wide rewards and allows the voucher to claim", async () => {
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

    const vouchBeforeClaim = await ctx.program.account.vouch.fetch(vouch.vouch);
    assert.equal(Number(vouchBeforeClaim.pendingRewardsUsdcMicros), 0);

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

  it("rejects unsupported prices", async () => {
    const ctx = await getTestContext();
    const author = await createActor(ctx);
    await registerAgent(ctx, author);

    await expectFailure(
      createSkillListing(ctx, author, uniqueSkillId("floor"), 1),
      "Price must be zero or at least the minimum paid listing price"
    );
  });

  it("allows paid purchases with no slashable backing", async () => {
    const ctx = await getTestContext();
    const author = await createActor(ctx);
    const buyer = await createActor(ctx);
    await registerAgent(ctx, author);

    const listing = await createSkillListing(
      ctx,
      author,
      uniqueSkillId("noback"),
      ONE_USDC
    );
    const proceedsBefore = await tokenAmount(ctx, listing.proceedsVault);
    const purchase = await purchaseSkill(
      ctx,
      buyer,
      author,
      listing.skillListing,
      listing.vault
    );

    await assertTokenDelta(
      ctx,
      listing.proceedsVault,
      proceedsBefore,
      ONE_USDC
    );
    assert.equal(Number(await tokenAmount(ctx, listing.vault)), 0);

    const listingAccount = await ctx.program.account.skillListing.fetch(
      listing.skillListing
    );
    const authorProfile = await ctx.program.account.agentProfile.fetch(
      author.profile
    );
    const purchaseAccount = await ctx.program.account.purchase.fetch(purchase);
    assert.equal(Number(listingAccount.totalRevenueUsdcMicros), ONE_USDC);
    assert.equal(Number(listingAccount.totalAuthorRevenueUsdcMicros), ONE_USDC);
    assert.equal(Number(listingAccount.totalVoucherRevenueUsdcMicros), 0);
    assert.equal(Number(authorProfile.unclaimedVoucherRevenueUsdcMicros), 0);
    assert.equal(Number(purchaseAccount.authorShareUsdcMicros), ONE_USDC);
    assert.equal(Number(purchaseAccount.voucherPoolUsdcMicros), 0);
  });

  it("allows paid purchases backed only by author self-stake", async () => {
    const ctx = await getTestContext();
    const author = await createActor(ctx);
    const buyer = await createActor(ctx);
    await registerAgent(ctx, author);
    await depositAuthorBond(ctx, author, ONE_USDC);

    const listing = await createSkillListing(
      ctx,
      author,
      uniqueSkillId("selfback"),
      ONE_USDC
    );
    const proceedsBefore = await tokenAmount(ctx, listing.proceedsVault);
    const purchase = await purchaseSkill(
      ctx,
      buyer,
      author,
      listing.skillListing,
      listing.vault
    );

    await assertTokenDelta(
      ctx,
      listing.proceedsVault,
      proceedsBefore,
      ONE_USDC
    );
    assert.equal(Number(await tokenAmount(ctx, listing.vault)), 0);

    const purchaseAccount = await ctx.program.account.purchase.fetch(purchase);
    assert.equal(Number(purchaseAccount.authorShareUsdcMicros), ONE_USDC);
    assert.equal(Number(purchaseAccount.voucherPoolUsdcMicros), 0);
  });

  it("allows a separate rent payer to sponsor purchase account creation", async () => {
    const ctx = await getTestContext();
    const author = await createActor(ctx);
    const buyer = await createActor(ctx);
    await registerAgent(ctx, author);
    const listing = await createSkillListing(
      ctx,
      author,
      uniqueSkillId("rentpay"),
      5 * ONE_USDC
    );
    const rentPayer = Keypair.generate();
    await fundSol(ctx.provider, rentPayer, 1);

    const buyerLamportsBefore = await ctx.provider.connection.getBalance(
      buyer.keypair.publicKey
    );
    const rentPayerLamportsBefore = await ctx.provider.connection.getBalance(
      rentPayer.publicKey
    );
    const purchase = await purchaseSkill(
      ctx,
      buyer,
      author,
      listing.skillListing,
      listing.vault,
      "purchase_skill sponsored rent payer",
      { rentPayer }
    );
    const buyerLamportsAfter = await ctx.provider.connection.getBalance(
      buyer.keypair.publicKey
    );
    const rentPayerLamportsAfter = await ctx.provider.connection.getBalance(
      rentPayer.publicKey
    );

    assert.equal(buyerLamportsAfter, buyerLamportsBefore);
    assert.isBelow(rentPayerLamportsAfter, rentPayerLamportsBefore);

    const purchaseAccount = await ctx.program.account.purchase.fetch(purchase);
    const authorProfile = await ctx.program.account.agentProfile.fetch(
      author.profile
    );
    assert.equal(
      purchaseAccount.buyer.toBase58(),
      buyer.keypair.publicKey.toBase58()
    );
    assert.equal(
      authorProfile.rewardVaultRentPayer.toBase58(),
      rentPayer.publicKey.toBase58()
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
        .accountsStrict({
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
          authorRewardVaultAuthority: listing.vaultAuthority,
          authorRewardVault: listing.vault,
          buyer: buyer.keypair.publicKey,
          rentPayer: buyer.keypair.publicKey,
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
        .accountsStrict({
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
          authorRewardVaultAuthority: listing.vaultAuthority,
          authorRewardVault: ctx.protocolTreasuryVault,
          buyer: buyer.keypair.publicKey,
          rentPayer: buyer.keypair.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer.keypair])
        .rpc(),
      "A seeds constraint was violated"
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
