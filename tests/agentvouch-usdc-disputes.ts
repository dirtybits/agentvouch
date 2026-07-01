import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { assert } from "chai";
import {
  ONE_USDC,
  assertTokenDelta,
  authorBondPda,
  authorBondVaultAuthority,
  createActor,
  createSkillListing,
  depositAuthorBond,
  expectFailure,
  getTestContext,
  openAuthorDispute,
  purchaseSkill,
  registerAgent,
  resolveAuthorDispute,
  setupPaidListingWithVouch,
  tokenAmount,
  u64,
  uniqueSkillId,
} from "./helpers/agentvouchUsdc";

describe("agentvouch usdc disputes", () => {
  it("resolves a free-listing (AuthorBondOnly) dispute through the bond-only path without parking for voucher slashing", async () => {
    // Free listings carry AuthorBondOnly liability: open_author_dispute does not
    // lock the listing or settlement, and resolve must reach Resolved directly
    // (never SlashingVouchers, which is the paid AuthorBondThenVouchers path).
    // Guards this terminal branch of the slashing-aware resolve rewrite against
    // regression, since every other dispute/slashing test uses paid listings.
    const ctx = await getTestContext();
    const author = await createActor(ctx);
    const challenger = await createActor(ctx);
    await registerAgent(ctx, author);
    await registerAgent(ctx, challenger);
    const bond = await depositAuthorBond(ctx, author, 4 * ONE_USDC);
    const listing = await createSkillListing(
      ctx,
      author,
      uniqueSkillId("free"),
      0,
      bond.authorBond
    );

    const disputeId = u64(Date.now() + 50);
    const dispute = await openAuthorDispute(
      ctx,
      challenger,
      author,
      listing.skillListing,
      null,
      disputeId
    );

    // Free dispute leaves the listing unlocked (AuthorBondOnly).
    const listingAtOpen = await ctx.program.account.skillListing.fetch(
      listing.skillListing
    );
    assert.isNull(listingAtOpen.lockedByDispute);

    const challengerBefore = await tokenAmount(ctx, challenger.usdc);
    await resolveAuthorDispute(
      ctx,
      author,
      challenger,
      disputeId,
      dispute,
      { upheld: {} },
      [
        { pubkey: bond.authorBond, isWritable: true, isSigner: false },
        { pubkey: bond.vault, isWritable: true, isSigner: false },
      ]
    );

    // Resolved in one shot: no SlashingVouchers park, dispute count cleared,
    // author bond slashed (50%) to the challenger.
    const disputeAccount = await ctx.program.account.authorDispute.fetch(
      dispute.authorDispute
    );
    assert.deepEqual(disputeAccount.ruling, { upheld: {} });
    assert.deepEqual(disputeAccount.status, { resolved: {} });
    assert.isNotNull(disputeAccount.resolvedAt);
    assert.equal(disputeAccount.linkedVouchCount, 0);
    assert.equal(Number(disputeAccount.voucherSlashedUsdcMicros), 0);

    const authorProfile = await ctx.program.account.agentProfile.fetch(
      author.profile
    );
    assert.equal(authorProfile.openAuthorDisputes, 0);
    assert.equal(authorProfile.upheldAuthorDisputes, 1);
    assert.equal(Number(authorProfile.authorBondUsdcMicros), 2 * ONE_USDC);
    await assertTokenDelta(
      ctx,
      challenger.usdc,
      challengerBefore,
      2.5 * ONE_USDC
    );
  });

  it("returns dispute bond to challenger and slashes author bond when upheld", async () => {
    const ctx = await getTestContext();
    const { author, buyer, bond, listing } = await setupPaidListingWithVouch(
      ctx
    );
    const challenger = await createActor(ctx);
    await registerAgent(ctx, challenger);
    const purchase = await purchaseSkill(
      ctx,
      buyer,
      author,
      listing.skillListing,
      listing.vault
    );
    const disputeId = u64(Date.now() + 100);
    const dispute = await openAuthorDispute(
      ctx,
      challenger,
      author,
      listing.skillListing,
      purchase,
      disputeId
    );

    const challengerBefore = await tokenAmount(ctx, challenger.usdc);
    await resolveAuthorDispute(
      ctx,
      author,
      challenger,
      disputeId,
      dispute,
      { upheld: {} },
      [
        {
          pubkey: bond.authorBond,
          isWritable: true,
          isSigner: false,
        },
        {
          pubkey: bond.vault,
          isWritable: true,
          isSigner: false,
        },
      ],
      "resolve_author_dispute upheld slash path"
    );

    await assertTokenDelta(
      ctx,
      challenger.usdc,
      challengerBefore,
      2.5 * ONE_USDC
    );
    const authorBond = await ctx.program.account.authorBond.fetch(
      bond.authorBond
    );
    const authorProfile = await ctx.program.account.agentProfile.fetch(
      author.profile
    );
    assert.equal(Number(authorBond.amountUsdcMicros), 2 * ONE_USDC);
    assert.equal(Number(authorProfile.authorBondUsdcMicros), 2 * ONE_USDC);
    assert.equal(Number(authorProfile.upheldAuthorDisputes), 1);
  });

  it("rejects unauthorized and duplicate dispute resolution", async () => {
    const ctx = await getTestContext();
    const { author, buyer, listing } = await setupPaidListingWithVouch(ctx);
    const challenger = await createActor(ctx);
    const unauthorized = await createActor(ctx);
    await registerAgent(ctx, challenger);
    const purchase = await purchaseSkill(
      ctx,
      buyer,
      author,
      listing.skillListing,
      listing.vault
    );
    const disputeId = u64(Date.now() + 200);
    const dispute = await openAuthorDispute(
      ctx,
      challenger,
      author,
      listing.skillListing,
      purchase,
      disputeId
    );

    await expectFailure(
      ctx.program.methods
        .resolveAuthorDispute(disputeId, { dismissed: {} })
        .accountsStrict({
          authorDispute: dispute.authorDispute,
          authorProfile: author.profile,
          skillListing: listing.skillListing,
          config: ctx.config,
          authority: unauthorized.keypair.publicKey,
          usdcMint: ctx.usdcMint,
          disputeBondVaultAuthority: dispute.disputeVaultAuthority,
          disputeBondVault: dispute.disputeVault,
          protocolTreasuryVault: ctx.protocolTreasuryVault,
          listingSettlement: listing.settlement,
          authorBondVaultAuthority: authorBondVaultAuthority(
            ctx.program,
            author.keypair.publicKey
          ),
          challenger: challenger.keypair.publicKey,
          challengerUsdcAccount: challenger.usdc,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([unauthorized.keypair])
        .rpc(),
      "Only config authority can resolve disputes"
    );

    await resolveAuthorDispute(ctx, author, challenger, disputeId, dispute, {
      dismissed: {},
    });

    await expectFailure(
      resolveAuthorDispute(ctx, author, challenger, disputeId, dispute, {
        dismissed: {},
      }),
      "Author dispute is not open"
    );
  });

  it("rejects invalid dispute accounts", async () => {
    const ctx = await getTestContext();
    const { author, buyer, listing } = await setupPaidListingWithVouch(ctx);
    const challenger = await createActor(ctx);
    const wrongChallenger = await createActor(ctx);
    await registerAgent(ctx, challenger);
    const purchase = await purchaseSkill(
      ctx,
      buyer,
      author,
      listing.skillListing,
      listing.vault
    );
    const disputeId = u64(Date.now() + 300);
    const dispute = await openAuthorDispute(
      ctx,
      challenger,
      author,
      listing.skillListing,
      purchase,
      disputeId
    );

    await expectFailure(
      ctx.program.methods
        .resolveAuthorDispute(disputeId, { dismissed: {} })
        .accountsStrict({
          authorDispute: dispute.authorDispute,
          authorProfile: author.profile,
          skillListing: listing.skillListing,
          config: ctx.config,
          authority: ctx.configAdmin.publicKey,
          usdcMint: ctx.usdcMint,
          disputeBondVaultAuthority: dispute.disputeVaultAuthority,
          disputeBondVault: dispute.disputeVault,
          protocolTreasuryVault: ctx.protocolTreasuryVault,
          listingSettlement: listing.settlement,
          authorBondVaultAuthority: authorBondVaultAuthority(
            ctx.program,
            author.keypair.publicKey
          ),
          challenger: challenger.keypair.publicKey,
          challengerUsdcAccount: wrongChallenger.usdc,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([ctx.configAdmin])
        .rpc(),
      "Token account owner is invalid"
    );

    const secondListing = await createSkillListing(
      ctx,
      author,
      uniqueSkillId("mismatch"),
      ONE_USDC
    );
    await expectFailure(
      openAuthorDispute(
        ctx,
        wrongChallenger,
        author,
        secondListing.skillListing,
        purchase,
        u64(Date.now() + 400)
      ),
      "Provided purchase does not match the disputed skill listing"
    );
  });
});
