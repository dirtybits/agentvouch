import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { assert } from "chai";
import {
  ONE_USDC,
  assertTokenDelta,
  authorBondPda,
  authorBondVaultAuthority,
  createActor,
  createSkillListing,
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
