import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { assert } from "chai";
import {
  ONE_USDC,
  assertTokenDelta,
  claimPurchaseRefund,
  claimVoucherRevenue,
  createActor,
  createRefundPool,
  createSkillListing,
  createVouch,
  expectFailure,
  getTestContext,
  linkVouchToListing,
  openAuthorDispute,
  purchaseSkill,
  registerAgent,
  resolveAuthorDispute,
  revokeVouch,
  slashDisputeVouches,
  tokenAmount,
  u64,
  uniqueSkillId,
  unlinkVouchFromListing,
  withdrawAuthorProceeds,
  vouchVault,
} from "./helpers/agentvouchUsdc";

// Test config (initialize_config defaults): slash_percentage = 50,
// challenger_reward_bps = 1000 (10%, capped 1 USDC), author/voucher split
// 60/40, dispute bond 0.5 USDC, author proceeds lock 0 seconds.

async function setupLinkedVoucherListing(
  ctx: Awaited<ReturnType<typeof getTestContext>>,
  voucherStakesUsdcMicros: number[],
  priceUsdcMicros = 5 * ONE_USDC
) {
  const author = await createActor(ctx);
  const buyer = await createActor(ctx);
  const challenger = await createActor(ctx);
  await registerAgent(ctx, author);
  await registerAgent(ctx, challenger);
  const skillId = uniqueSkillId("slash");
  const listing = await createSkillListing(
    ctx,
    author,
    skillId,
    priceUsdcMicros
  );
  const vouchers = [];
  for (const stake of voucherStakesUsdcMicros) {
    const voucher = await createActor(ctx);
    await registerAgent(ctx, voucher);
    const vouch = await createVouch(ctx, voucher, author, stake);
    const position = await linkVouchToListing(
      ctx,
      voucher,
      author,
      listing.skillListing,
      vouch.vouch
    );
    vouchers.push({ voucher, vouch, position, stake });
  }
  return { author, buyer, challenger, skillId, listing, vouchers };
}

function slashAccounts(
  vouchers: {
    voucher: { profile: any };
    vouch: { vouch: any };
    position: any;
  }[]
) {
  return vouchers.map((entry) => ({
    position: entry.position,
    vouch: entry.vouch.vouch,
    voucherProfile: entry.voucher.profile,
  }));
}

describe("agentvouch usdc voucher slashing", () => {
  it("parks an upheld paid dispute and slashes linked vouchers via permissionless crank", async () => {
    const ctx = await getTestContext();
    const { author, buyer, challenger, listing, vouchers } =
      await setupLinkedVoucherListing(ctx, [4 * ONE_USDC, 2 * ONE_USDC]);
    const purchase = await purchaseSkill(
      ctx,
      buyer,
      author,
      listing.skillListing,
      listing.vault
    );

    const disputeId = u64(Date.now() + 1_000);
    const dispute = await openAuthorDispute(
      ctx,
      challenger,
      author,
      listing.skillListing,
      purchase,
      disputeId
    );

    // No author bond in this setup: bond slash path is covered elsewhere.
    await resolveAuthorDispute(ctx, author, challenger, disputeId, dispute, {
      upheld: {},
    });

    let disputeAccount = await ctx.program.account.authorDispute.fetch(
      dispute.authorDispute
    );
    assert.deepEqual(disputeAccount.status, { slashingVouchers: {} });
    assert.equal(disputeAccount.linkedVouchCount, 2);
    assert.equal(disputeAccount.processedVouchCount, 0);
    assert.isNull(disputeAccount.resolvedAt);
    let authorProfile = await ctx.program.account.agentProfile.fetch(
      author.profile
    );
    assert.equal(authorProfile.openAuthorDisputes, 1);
    assert.equal(authorProfile.upheldAuthorDisputes, 1);

    const proceedsBefore = await tokenAmount(ctx, listing.proceedsVault);
    const vaultABefore = await tokenAmount(
      ctx,
      vouchVault(ctx.program, vouchers[0].voucher.profile, author.profile)
    );

    const cranker = await createActor(ctx);
    await slashDisputeVouches(
      ctx,
      author,
      dispute,
      listing.skillListing,
      slashAccounts(vouchers),
      cranker,
      "slash_dispute_vouches page of 2"
    );

    // 50% slash: 2 + 1 USDC moved into the proceeds vault, ring-fenced.
    await assertTokenDelta(
      ctx,
      listing.proceedsVault,
      proceedsBefore,
      3 * ONE_USDC
    );
    await assertTokenDelta(
      ctx,
      vouchVault(ctx.program, vouchers[0].voucher.profile, author.profile),
      vaultABefore,
      -2 * ONE_USDC
    );

    disputeAccount = await ctx.program.account.authorDispute.fetch(
      dispute.authorDispute
    );
    assert.deepEqual(disputeAccount.status, { resolved: {} });
    assert.equal(disputeAccount.processedVouchCount, 2);
    assert.equal(Number(disputeAccount.voucherSlashedUsdcMicros), 3 * ONE_USDC);
    assert.isNotNull(disputeAccount.resolvedAt);

    authorProfile = await ctx.program.account.agentProfile.fetch(
      author.profile
    );
    assert.equal(authorProfile.openAuthorDisputes, 0);
    assert.equal(Number(authorProfile.totalVouchStakeUsdcMicros), 0);
    assert.equal(authorProfile.totalVouchesReceived, 0);

    for (const entry of vouchers) {
      const vouchAccount = await ctx.program.account.vouch.fetch(
        entry.vouch.vouch
      );
      assert.deepEqual(vouchAccount.status, { slashed: {} });
      assert.equal(Number(vouchAccount.stakeUsdcMicros), entry.stake / 2);
      const positionAccount =
        await ctx.program.account.listingVouchPosition.fetch(entry.position);
      assert.deepEqual(positionAccount.status, { slashed: {} });
      assert.equal(Number(positionAccount.rewardStakeUsdcMicros), 0);
    }

    const listingAccount = await ctx.program.account.skillListing.fetch(
      listing.skillListing
    );
    assert.equal(Number(listingAccount.activeRewardStakeUsdcMicros), 0);
    assert.equal(listingAccount.activeRewardPositionCount, 0);
    // Locks stay until the refund pool consumes the settlement.
    assert.isNotNull(listingAccount.lockedByDispute);
    const settlementAccount = await ctx.program.account.listingSettlement.fetch(
      listing.settlement
    );
    assert.isNotNull(settlementAccount.lockedByDispute);
    assert.equal(
      Number(settlementAccount.slashedDepositUsdcMicros),
      3 * ONE_USDC
    );
    assert.equal(
      Number(settlementAccount.withdrawableAuthorProceedsUsdcMicros),
      3 * ONE_USDC
    );
  });

  it("ring-fences slashed deposits: refund-pool-only, excluded from the challenger reward base", async () => {
    const ctx = await getTestContext();
    const { author, buyer, challenger, listing, vouchers } =
      await setupLinkedVoucherListing(ctx, [4 * ONE_USDC, 2 * ONE_USDC]);
    const purchase = await purchaseSkill(
      ctx,
      buyer,
      author,
      listing.skillListing,
      listing.vault
    );
    const disputeId = u64(Date.now() + 2_000);
    const dispute = await openAuthorDispute(
      ctx,
      challenger,
      author,
      listing.skillListing,
      purchase,
      disputeId
    );
    await resolveAuthorDispute(ctx, author, challenger, disputeId, dispute, {
      upheld: {},
    });
    const cranker = await createActor(ctx);
    await slashDisputeVouches(
      ctx,
      author,
      dispute,
      listing.skillListing,
      slashAccounts(vouchers),
      cranker
    );

    // withdrawable = 3 (60% of 5), slashed = 3 (50% of 6 staked).
    // Challenger reward base is proceeds only: 10% of 3 = 0.3 — NOT 10% of 6.
    // Pool capacity = 3 - 0.3 + 3 = 5.7.
    const challengerBefore = await tokenAmount(ctx, challenger.usdc);
    const { refundPool, refundVault } = await createRefundPool(
      ctx,
      author,
      challenger,
      dispute,
      10 * ONE_USDC
    );
    await assertTokenDelta(
      ctx,
      challenger.usdc,
      challengerBefore,
      0.3 * ONE_USDC
    );
    assert.equal(Number(await tokenAmount(ctx, refundVault)), 5.7 * ONE_USDC);

    const settlementAccount = await ctx.program.account.listingSettlement.fetch(
      listing.settlement
    );
    // Slashed deposits drain first and fully; proceeds cover the remainder.
    assert.equal(Number(settlementAccount.slashedDepositUsdcMicros), 0);
    assert.equal(
      Number(settlementAccount.withdrawableAuthorProceedsUsdcMicros),
      0
    );
    assert.isNull(settlementAccount.lockedByDispute);
    const listingAccount = await ctx.program.account.skillListing.fetch(
      listing.skillListing
    );
    assert.isNull(listingAccount.lockedByDispute);

    // Buyer refund capped at the purchase price snapshot.
    const buyerBefore = await tokenAmount(ctx, buyer.usdc);
    await claimPurchaseRefund(ctx, buyer, refundPool, purchase);
    await assertTokenDelta(ctx, buyer.usdc, buyerBefore, 5 * ONE_USDC);

    // Nothing withdrawable remains for the author; slashed money never was.
    await expectFailure(
      withdrawAuthorProceeds(ctx, author, listing.skillListing, ONE_USDC),
      "Insufficient withdrawable author proceeds"
    );
  });

  it("creates a refund pool from slashed deposits alone after the author withdrew all proceeds", async () => {
    const ctx = await getTestContext();
    const { author, buyer, challenger, listing, vouchers } =
      await setupLinkedVoucherListing(ctx, [2 * ONE_USDC]);
    const purchase = await purchaseSkill(
      ctx,
      buyer,
      author,
      listing.skillListing,
      listing.vault
    );
    // Author drains the withdrawable proceeds before any dispute exists.
    await withdrawAuthorProceeds(
      ctx,
      author,
      listing.skillListing,
      3 * ONE_USDC
    );

    const disputeId = u64(Date.now() + 3_000);
    const dispute = await openAuthorDispute(
      ctx,
      challenger,
      author,
      listing.skillListing,
      purchase,
      disputeId
    );
    await resolveAuthorDispute(ctx, author, challenger, disputeId, dispute, {
      upheld: {},
    });
    const cranker = await createActor(ctx);
    await slashDisputeVouches(
      ctx,
      author,
      dispute,
      listing.skillListing,
      slashAccounts(vouchers),
      cranker
    );

    // withdrawable = 0, slashed = 1: the pool must still be creatable, the
    // challenger reward (proceeds-based) is zero.
    const challengerBefore = await tokenAmount(ctx, challenger.usdc);
    const { refundPool, refundVault } = await createRefundPool(
      ctx,
      author,
      challenger,
      dispute,
      10 * ONE_USDC
    );
    await assertTokenDelta(ctx, challenger.usdc, challengerBefore, 0);
    assert.equal(Number(await tokenAmount(ctx, refundVault)), ONE_USDC);

    const buyerBefore = await tokenAmount(ctx, buyer.usdc);
    await claimPurchaseRefund(ctx, buyer, refundPool, purchase);
    await assertTokenDelta(ctx, buyer.usdc, buyerBefore, ONE_USDC);
  });

  it("blocks slash-set dodges: link, unlink, revision bumps, and revoke while dispute-locked", async () => {
    const ctx = await getTestContext();
    const { author, buyer, challenger, skillId, listing, vouchers } =
      await setupLinkedVoucherListing(ctx, [2 * ONE_USDC]);
    const purchase = await purchaseSkill(
      ctx,
      buyer,
      author,
      listing.skillListing,
      listing.vault
    );
    const disputeId = u64(Date.now() + 4_000);
    const dispute = await openAuthorDispute(
      ctx,
      challenger,
      author,
      listing.skillListing,
      purchase,
      disputeId
    );

    const listingAccount = await ctx.program.account.skillListing.fetch(
      listing.skillListing
    );
    assert.equal(
      listingAccount.lockedByDispute?.toBase58(),
      dispute.authorDispute.toBase58()
    );

    // Unlink out of the slash set: blocked.
    await expectFailure(
      unlinkVouchFromListing(
        ctx,
        vouchers[0].voucher,
        author,
        listing.skillListing,
        vouchers[0].position,
        vouchers[0].vouch.vouch
      ),
      "Listing is locked by an open dispute"
    );

    // Link into the frozen slash set: blocked.
    const lateVoucher = await createActor(ctx);
    await registerAgent(ctx, lateVoucher);
    const lateVouch = await createVouch(ctx, lateVoucher, author, ONE_USDC);
    await expectFailure(
      linkVouchToListing(
        ctx,
        lateVoucher,
        author,
        listing.skillListing,
        lateVouch.vouch
      ),
      "Listing is locked by an open dispute"
    );

    // Settlement rotation via revision bump: blocked.
    await expectFailure(
      ctx.program.methods
        .updateSkillListing(
          skillId,
          "ipfs://rotated-content",
          `Skill ${skillId}`,
          "USDC-native test skill",
          u64(5 * ONE_USDC)
        )
        .accountsStrict({
          skillListing: listing.skillListing,
          authorProfile: author.profile,
          config: ctx.config,
          authorBond: null,
          author: author.keypair.publicKey,
        })
        .signers([author.keypair])
        .rpc(),
      "Listing is locked by an open dispute"
    );

    // Non-revision metadata updates stay allowed while locked.
    await ctx.program.methods
      .updateSkillListing(
        skillId,
        `ipfs://${skillId}`,
        "Renamed while disputed",
        "USDC-native test skill",
        u64(5 * ONE_USDC)
      )
      .accountsStrict({
        skillListing: listing.skillListing,
        authorProfile: author.profile,
        config: ctx.config,
        authorBond: null,
        author: author.keypair.publicKey,
      })
      .signers([author.keypair])
      .rpc();

    // Money exit while the dispute is open: blocked.
    await expectFailure(
      revokeVouch(ctx, vouchers[0].voucher, author),
      "Cannot revoke while the vouched author has an open dispute"
    );

    await resolveAuthorDispute(ctx, author, challenger, disputeId, dispute, {
      upheld: {},
    });

    // Mid-slash (SlashingVouchers): the revoke lock still holds.
    await expectFailure(
      revokeVouch(ctx, vouchers[0].voucher, author),
      "Cannot revoke while the vouched author has an open dispute"
    );

    // Mid-slash: membership is still frozen — the listing stays dispute-locked
    // until create_refund_pool clears it, so unlink out of and link into the
    // slash set both remain blocked during the SlashingVouchers window.
    await expectFailure(
      unlinkVouchFromListing(
        ctx,
        vouchers[0].voucher,
        author,
        listing.skillListing,
        vouchers[0].position,
        vouchers[0].vouch.vouch
      ),
      "Listing is locked by an open dispute"
    );
    await expectFailure(
      linkVouchToListing(
        ctx,
        lateVoucher,
        author,
        listing.skillListing,
        lateVouch.vouch
      ),
      "Listing is locked by an open dispute"
    );

    const cranker = await createActor(ctx);
    await slashDisputeVouches(
      ctx,
      author,
      dispute,
      listing.skillListing,
      slashAccounts(vouchers),
      cranker
    );

    // Post-finalization: residual reclaim succeeds, vouchee aggregates are
    // untouched by the reclaim (already settled at slash time).
    const voucherBefore = await tokenAmount(ctx, vouchers[0].voucher.usdc);
    const profileBefore = await ctx.program.account.agentProfile.fetch(
      author.profile
    );
    await revokeVouch(ctx, vouchers[0].voucher, author);
    await assertTokenDelta(
      ctx,
      vouchers[0].voucher.usdc,
      voucherBefore,
      ONE_USDC
    );
    const profileAfter = await ctx.program.account.agentProfile.fetch(
      author.profile
    );
    assert.equal(
      Number(profileAfter.totalVouchStakeUsdcMicros),
      Number(profileBefore.totalVouchStakeUsdcMicros)
    );
    assert.equal(
      profileAfter.totalVouchesReceived,
      profileBefore.totalVouchesReceived
    );
    const vouchAccount = await ctx.program.account.vouch.fetch(
      vouchers[0].vouch.vouch
    );
    assert.deepEqual(vouchAccount.status, { revoked: {} });
    assert.equal(Number(vouchAccount.stakeUsdcMicros), 0);
  });

  it("slashes a large position set across multiple crank pages", async () => {
    const ctx = await getTestContext();
    const stakes = Array(5).fill(ONE_USDC);
    const { author, buyer, challenger, listing, vouchers } =
      await setupLinkedVoucherListing(ctx, stakes);
    const purchase = await purchaseSkill(
      ctx,
      buyer,
      author,
      listing.skillListing,
      listing.vault
    );
    const disputeId = u64(Date.now() + 5_000);
    const dispute = await openAuthorDispute(
      ctx,
      challenger,
      author,
      listing.skillListing,
      purchase,
      disputeId
    );
    await resolveAuthorDispute(ctx, author, challenger, disputeId, dispute, {
      upheld: {},
    });

    const cranker = await createActor(ctx);
    // Page 1: the max page size (4) — also proves the tx-size bound (R3).
    await slashDisputeVouches(
      ctx,
      author,
      dispute,
      listing.skillListing,
      slashAccounts(vouchers.slice(0, 4)),
      cranker,
      "slash_dispute_vouches page of 4"
    );

    let disputeAccount = await ctx.program.account.authorDispute.fetch(
      dispute.authorDispute
    );
    assert.deepEqual(disputeAccount.status, { slashingVouchers: {} });
    assert.equal(disputeAccount.processedVouchCount, 4);

    // Mid-slash: refund pool refused, double-crank of a settled position
    // refused, money exits still locked.
    await expectFailure(
      createRefundPool(ctx, author, challenger, dispute, ONE_USDC),
      "Author dispute is not resolved"
    );
    await expectFailure(
      slashDisputeVouches(
        ctx,
        author,
        dispute,
        listing.skillListing,
        slashAccounts(vouchers.slice(0, 1)),
        cranker
      ),
      "Position is not active"
    );
    await expectFailure(
      revokeVouch(ctx, vouchers[4].voucher, author),
      "Cannot revoke while the vouched author has an open dispute"
    );

    // Page 2 finalizes.
    await slashDisputeVouches(
      ctx,
      author,
      dispute,
      listing.skillListing,
      slashAccounts(vouchers.slice(4)),
      cranker
    );
    disputeAccount = await ctx.program.account.authorDispute.fetch(
      dispute.authorDispute
    );
    assert.deepEqual(disputeAccount.status, { resolved: {} });
    assert.equal(disputeAccount.processedVouchCount, 5);
    assert.equal(
      Number(disputeAccount.voucherSlashedUsdcMicros),
      2.5 * ONE_USDC
    );
    const authorProfile = await ctx.program.account.agentProfile.fetch(
      author.profile
    );
    assert.equal(authorProfile.openAuthorDisputes, 0);
  });

  it("skip-settles stale positions whose vouch was revoked before the dispute", async () => {
    const ctx = await getTestContext();
    const { author, buyer, challenger, listing, vouchers } =
      await setupLinkedVoucherListing(ctx, [2 * ONE_USDC]);
    // Legal pre-dispute revoke: the vouch dies but the position stays Active.
    await revokeVouch(ctx, vouchers[0].voucher, author);

    const purchase = await purchaseSkill(
      ctx,
      buyer,
      author,
      listing.skillListing,
      listing.vault
    );
    const disputeId = u64(Date.now() + 6_000);
    const dispute = await openAuthorDispute(
      ctx,
      challenger,
      author,
      listing.skillListing,
      purchase,
      disputeId
    );
    await resolveAuthorDispute(ctx, author, challenger, disputeId, dispute, {
      upheld: {},
    });

    let disputeAccount = await ctx.program.account.authorDispute.fetch(
      dispute.authorDispute
    );
    assert.deepEqual(disputeAccount.status, { slashingVouchers: {} });
    assert.equal(disputeAccount.linkedVouchCount, 1);

    const voucherVault = vouchVault(
      ctx.program,
      vouchers[0].voucher.profile,
      author.profile
    );
    const vaultBefore = await tokenAmount(ctx, voucherVault);
    const cranker = await createActor(ctx);
    await slashDisputeVouches(
      ctx,
      author,
      dispute,
      listing.skillListing,
      slashAccounts(vouchers),
      cranker
    );

    // Zero slash, converged bookkeeping, dead position, clean listing.
    await assertTokenDelta(ctx, voucherVault, vaultBefore, 0);
    disputeAccount = await ctx.program.account.authorDispute.fetch(
      dispute.authorDispute
    );
    assert.deepEqual(disputeAccount.status, { resolved: {} });
    assert.equal(Number(disputeAccount.voucherSlashedUsdcMicros), 0);
    const settlementAccount = await ctx.program.account.listingSettlement.fetch(
      listing.settlement
    );
    assert.equal(Number(settlementAccount.slashedDepositUsdcMicros), 0);
    const positionAccount =
      await ctx.program.account.listingVouchPosition.fetch(
        vouchers[0].position
      );
    assert.deepEqual(positionAccount.status, { slashed: {} });
    const listingAccount = await ctx.program.account.skillListing.fetch(
      listing.skillListing
    );
    assert.equal(Number(listingAccount.activeRewardStakeUsdcMicros), 0);
    assert.equal(listingAccount.activeRewardPositionCount, 0);
    const vouchAccount = await ctx.program.account.vouch.fetch(
      vouchers[0].vouch.vouch
    );
    assert.deepEqual(vouchAccount.status, { revoked: {} });
  });

  it("stops reward accrual on slashed residual stake and keeps the reward vault solvent", async () => {
    const ctx = await getTestContext();
    // Voucher A (4 USDC) links to the disputed listing; voucher B (2 USDC)
    // backs the author without linking, so B survives the slash.
    const { author, buyer, challenger, listing, vouchers } =
      await setupLinkedVoucherListing(ctx, [4 * ONE_USDC]);
    const voucherB = await createActor(ctx);
    await registerAgent(ctx, voucherB);
    const vouchB = await createVouch(ctx, voucherB, author, 2 * ONE_USDC);

    // Purchase 1 (price 5): voucher pool 2 USDC over 6 USDC total stake.
    const purchase = await purchaseSkill(
      ctx,
      buyer,
      author,
      listing.skillListing,
      listing.vault
    );

    const disputeId = u64(Date.now() + 7_000);
    const dispute = await openAuthorDispute(
      ctx,
      challenger,
      author,
      listing.skillListing,
      purchase,
      disputeId
    );
    await resolveAuthorDispute(ctx, author, challenger, disputeId, dispute, {
      upheld: {},
    });
    const cranker = await createActor(ctx);
    await slashDisputeVouches(
      ctx,
      author,
      dispute,
      listing.skillListing,
      slashAccounts(vouchers),
      cranker
    );

    // Purchase 2 on a fresh listing by the same author: the voucher pool
    // (2 USDC) must distribute over B's stake only — A's residual is dead.
    const listing2 = await createSkillListing(
      ctx,
      author,
      uniqueSkillId("postslash"),
      5 * ONE_USDC
    );
    const buyer2 = await createActor(ctx);
    await purchaseSkill(
      ctx,
      buyer2,
      author,
      listing2.skillListing,
      listing2.vault
    );

    // A claims only the pre-slash accrual: 4/6 of purchase-1 pool = 1.333333.
    const aBefore = await tokenAmount(ctx, vouchers[0].voucher.usdc);
    await claimVoucherRevenue(
      ctx,
      vouchers[0].voucher,
      author,
      listing.skillListing,
      vouchers[0].position,
      vouchers[0].vouch.vouch,
      listing.vault
    );
    await assertTokenDelta(ctx, vouchers[0].voucher.usdc, aBefore, 1_333_333);

    // B claims its purchase-1 share (2/6 of 2) plus the whole purchase-2
    // pool: 666,666 + 2,000,000.
    const bBefore = await tokenAmount(ctx, voucherB.usdc);
    await claimVoucherRevenue(
      ctx,
      voucherB,
      author,
      listing.skillListing,
      vouchers[0].position,
      vouchB.vouch,
      listing.vault
    );
    await assertTokenDelta(ctx, voucherB.usdc, bBefore, 2_666_666);

    // Solvency: nothing over-distributed; only rounding dust remains.
    const authorProfile = await ctx.program.account.agentProfile.fetch(
      author.profile
    );
    assert.isAtMost(Number(authorProfile.unclaimedVoucherRevenueUsdcMicros), 2);

    // A's dead position earns nothing further: a second claim has nothing.
    await expectFailure(
      claimVoucherRevenue(
        ctx,
        vouchers[0].voucher,
        author,
        listing.skillListing,
        vouchers[0].position,
        vouchers[0].vouch.vouch,
        listing.vault
      ),
      "No unclaimed revenue available"
    );
  });

  it("dismissed paid dispute clears both locks and leaves vouchers untouched", async () => {
    const ctx = await getTestContext();
    const { author, buyer, challenger, listing, vouchers } =
      await setupLinkedVoucherListing(ctx, [2 * ONE_USDC]);
    const purchase = await purchaseSkill(
      ctx,
      buyer,
      author,
      listing.skillListing,
      listing.vault
    );
    const disputeId = u64(Date.now() + 8_000);
    const dispute = await openAuthorDispute(
      ctx,
      challenger,
      author,
      listing.skillListing,
      purchase,
      disputeId
    );
    await resolveAuthorDispute(ctx, author, challenger, disputeId, dispute, {
      dismissed: {},
    });

    const disputeAccount = await ctx.program.account.authorDispute.fetch(
      dispute.authorDispute
    );
    assert.deepEqual(disputeAccount.status, { resolved: {} });
    assert.equal(disputeAccount.linkedVouchCount, 0);
    const listingAccount = await ctx.program.account.skillListing.fetch(
      listing.skillListing
    );
    assert.isNull(listingAccount.lockedByDispute);
    const settlementAccount = await ctx.program.account.listingSettlement.fetch(
      listing.settlement
    );
    assert.isNull(settlementAccount.lockedByDispute);
    const vouchAccount = await ctx.program.account.vouch.fetch(
      vouchers[0].vouch.vouch
    );
    assert.deepEqual(vouchAccount.status, { active: {} });

    // Membership operations resume after dismissal.
    await unlinkVouchFromListing(
      ctx,
      vouchers[0].voucher,
      author,
      listing.skillListing,
      vouchers[0].position,
      vouchers[0].vouch.vouch
    );
  });

  it("blocks remove/close of a dispute-locked listing until the refund pool clears the lock", async () => {
    const ctx = await getTestContext();
    const { author, buyer, challenger, skillId, listing, vouchers } =
      await setupLinkedVoucherListing(ctx, [2 * ONE_USDC]);
    const purchase = await purchaseSkill(
      ctx,
      buyer,
      author,
      listing.skillListing,
      listing.vault
    );
    const disputeId = u64(Date.now() + 9_000);
    const dispute = await openAuthorDispute(
      ctx,
      challenger,
      author,
      listing.skillListing,
      purchase,
      disputeId
    );

    const removeSkillListing = () =>
      ctx.program.methods
        .removeSkillListing(skillId)
        .accountsStrict({
          skillListing: listing.skillListing,
          authorProfile: author.profile,
          author: author.keypair.publicKey,
        })
        .signers([author.keypair])
        .rpc();
    const closeSkillListing = () =>
      ctx.program.methods
        .closeSkillListing(skillId)
        .accountsStrict({
          skillListing: listing.skillListing,
          authorProfile: author.profile,
          author: author.keypair.publicKey,
        })
        .signers([author.keypair])
        .rpc();

    // Locked at open: removing (the first step toward close_skill_listing,
    // which would delete the account slash_dispute_vouches/create_refund_pool
    // must read) is blocked.
    await expectFailure(
      removeSkillListing(),
      "Listing is locked by an open dispute"
    );

    await resolveAuthorDispute(ctx, author, challenger, disputeId, dispute, {
      upheld: {},
    });
    const cranker = await createActor(ctx);
    await slashDisputeVouches(
      ctx,
      author,
      dispute,
      listing.skillListing,
      slashAccounts(vouchers),
      cranker
    );

    // Resolved but still locked: create_refund_pool, not resolve/slash, clears
    // the listing lock — so remove stays blocked through this window.
    const disputeAccount = await ctx.program.account.authorDispute.fetch(
      dispute.authorDispute
    );
    assert.deepEqual(disputeAccount.status, { resolved: {} });
    await expectFailure(
      removeSkillListing(),
      "Listing is locked by an open dispute"
    );

    await createRefundPool(ctx, author, challenger, dispute, ONE_USDC);
    const listingAccount = await ctx.program.account.skillListing.fetch(
      listing.skillListing
    );
    assert.isNull(listingAccount.lockedByDispute);

    // Lock cleared: remove then close both succeed and the PDA is reclaimed.
    await removeSkillListing();
    await closeSkillListing();
    const closed = await ctx.program.account.skillListing.fetchNullable(
      listing.skillListing
    );
    assert.isNull(closed);
  });
});
