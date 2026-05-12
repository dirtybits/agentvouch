import { Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { assert } from "chai";
import {
  ONE_USDC,
  assertTokenDelta,
  authorBondPda,
  authorBondVault,
  authorBondVaultAuthority,
  authorRewardVault,
  authorRewardVaultAuthority,
  createActor,
  createAtaForMint,
  createSkillListing,
  createVouch,
  createWrongMint,
  depositAuthorBond,
  expectFailure,
  getTestContext,
  registerAgent,
  revokeVouch,
  setupPaidListingWithVouch,
  tokenAmount,
  u64,
  uniqueSkillId,
  vouchPda,
  vouchVault,
  vouchVaultAuthority,
  withdrawAuthorBond,
} from "./helpers/agentvouchUsdc";

describe("agentvouch usdc bonds and vouches", () => {
  it("deposits and withdraws author bond USDC", async () => {
    const ctx = await getTestContext();
    const author = await createActor(ctx);
    await registerAgent(ctx, author);

    const authorBefore = await tokenAmount(ctx, author.usdc);
    const bond = await depositAuthorBond(ctx, author, 3 * ONE_USDC);
    await assertTokenDelta(ctx, bond.vault, 0n, 3 * ONE_USDC);

    await withdrawAuthorBond(ctx, author, ONE_USDC);
    await assertTokenDelta(ctx, author.usdc, authorBefore, -2 * ONE_USDC);

    const authorBond = await ctx.program.account.authorBond.fetch(
      bond.authorBond
    );
    assert.equal(Number(authorBond.amountUsdcMicros), 2 * ONE_USDC);
  });

  it("revokes an unlinked vouch and returns the stake", async () => {
    const ctx = await getTestContext();
    const author = await createActor(ctx);
    const voucher = await createActor(ctx);
    await registerAgent(ctx, author);
    await registerAgent(ctx, voucher);

    await createVouch(ctx, voucher, author, 2 * ONE_USDC);
    const voucherBeforeRevoke = await tokenAmount(ctx, voucher.usdc);
    const vouch = await revokeVouch(ctx, voucher, author);
    await assertTokenDelta(
      ctx,
      voucher.usdc,
      voucherBeforeRevoke,
      2 * ONE_USDC
    );

    const vouchAccount = await ctx.program.account.vouch.fetch(vouch.vouch);
    assert.equal(Number(vouchAccount.stakeUsdcMicros), 0);
  });

  it("rejects invalid author bond deposits", async () => {
    const ctx = await getTestContext();
    const author = await createActor(ctx);
    const other = await createActor(ctx);
    const emptyAuthor = await createActor(ctx, 0);
    await registerAgent(ctx, author);
    await registerAgent(ctx, emptyAuthor);

    const authorBond = authorBondPda(ctx.program, author.keypair.publicKey);
    const vaultAuthority = authorBondVaultAuthority(
      ctx.program,
      author.keypair.publicKey
    );
    const vault = authorBondVault(ctx.program, author.keypair.publicKey);

    await expectFailure(
      ctx.program.methods
        .depositAuthorBond(u64(0))
        .accounts({
          authorBond,
          authorProfile: author.profile,
          config: ctx.config,
          usdcMint: ctx.usdcMint,
          authorUsdcAccount: author.usdc,
          authorBondVaultAuthority: vaultAuthority,
          authorBondVault: vault,
          author: author.keypair.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([author.keypair])
        .rpc(),
      "Amount must be greater than zero"
    );

    await expectFailure(
      ctx.program.methods
        .depositAuthorBond(u64(ONE_USDC))
        .accounts({
          authorBond,
          authorProfile: author.profile,
          config: ctx.config,
          usdcMint: ctx.usdcMint,
          authorUsdcAccount: other.usdc,
          authorBondVaultAuthority: vaultAuthority,
          authorBondVault: vault,
          author: author.keypair.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([author.keypair])
        .rpc(),
      "Token account owner is invalid"
    );

    const wrongMint = await createWrongMint(ctx);
    const wrongMintAta = await createAtaForMint(
      ctx,
      author.keypair.publicKey,
      wrongMint
    );
    await expectFailure(
      ctx.program.methods
        .depositAuthorBond(u64(ONE_USDC))
        .accounts({
          authorBond,
          authorProfile: author.profile,
          config: ctx.config,
          usdcMint: wrongMint,
          authorUsdcAccount: wrongMintAta,
          authorBondVaultAuthority: vaultAuthority,
          authorBondVault: vault,
          author: author.keypair.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([author.keypair])
        .rpc(),
      "USDC mint does not match config"
    );

    await expectFailure(
      ctx.program.methods
        .depositAuthorBond(u64(ONE_USDC))
        .accounts({
          authorBond,
          authorProfile: author.profile,
          config: ctx.config,
          usdcMint: ctx.usdcMint,
          authorUsdcAccount: author.usdc,
          authorBondVaultAuthority: vaultAuthority,
          authorBondVault: vault,
          author: author.keypair.publicKey,
          tokenProgram: SystemProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .signers([author.keypair])
        .rpc(),
      ["InvalidProgramId", "Program", "tokenProgram"]
    );

    await expectFailure(depositAuthorBond(ctx, emptyAuthor, ONE_USDC), [
      "insufficient funds",
      "InsufficientFunds",
      "custom program error",
    ]);

    await expectFailure(
      ctx.program.methods
        .depositAuthorBond(u64(ONE_USDC))
        .accounts({
          authorBond,
          authorProfile: author.profile,
          config: ctx.config,
          usdcMint: ctx.usdcMint,
          authorUsdcAccount: Keypair.generate().publicKey,
          authorBondVaultAuthority: vaultAuthority,
          authorBondVault: vault,
          author: author.keypair.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([author.keypair])
        .rpc(),
      ["AccountNotInitialized", "not initialized", "AccountNotFound"]
    );
  });

  it("rejects invalid vouch actions", async () => {
    const ctx = await getTestContext();
    const author = await createActor(ctx);
    const voucher = await createActor(ctx);
    await registerAgent(ctx, author);
    await registerAgent(ctx, voucher);

    const selfVouch = vouchPda(ctx.program, author.profile, author.profile);
    const selfVaultAuthority = vouchVaultAuthority(
      ctx.program,
      author.profile,
      author.profile
    );
    const selfVault = vouchVault(ctx.program, author.profile, author.profile);
    await expectFailure(
      ctx.program.methods
        .vouch(u64(ONE_USDC))
        .accountsStrict({
          vouch: selfVouch,
          voucherProfile: author.profile,
          voucheeProfile: author.profile,
          config: ctx.config,
          usdcMint: ctx.usdcMint,
          voucherUsdcAccount: author.usdc,
          vouchVaultAuthority: selfVaultAuthority,
          vouchVault: selfVault,
          authorRewardVaultAuthority: authorRewardVaultAuthority(
            ctx.program,
            author.profile
          ),
          authorRewardVault: authorRewardVault(ctx.program, author.profile),
          voucher: author.keypair.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([author.keypair])
        .rpc(),
      "Cannot vouch for yourself"
    );

    await expectFailure(
      ctx.program.methods
        .vouch(u64(ONE_USDC - 1))
        .accountsStrict({
          vouch: vouchPda(ctx.program, voucher.profile, author.profile),
          voucherProfile: voucher.profile,
          voucheeProfile: author.profile,
          config: ctx.config,
          usdcMint: ctx.usdcMint,
          voucherUsdcAccount: voucher.usdc,
          vouchVaultAuthority: vouchVaultAuthority(
            ctx.program,
            voucher.profile,
            author.profile
          ),
          vouchVault: vouchVault(ctx.program, voucher.profile, author.profile),
          authorRewardVaultAuthority: authorRewardVaultAuthority(
            ctx.program,
            author.profile
          ),
          authorRewardVault: authorRewardVault(ctx.program, author.profile),
          voucher: voucher.keypair.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([voucher.keypair])
        .rpc(),
      "Stake amount is below minimum"
    );
  });

  it("blocks withdrawal and revoke when protocol state is locked", async () => {
    const ctx = await getTestContext();
    const freeAuthor = await createActor(ctx);
    await registerAgent(ctx, freeAuthor);
    const freeBond = await depositAuthorBond(ctx, freeAuthor, ONE_USDC);
    await createSkillListing(
      ctx,
      freeAuthor,
      uniqueSkillId("free"),
      0,
      freeBond.authorBond
    );

    await expectFailure(
      withdrawAuthorBond(ctx, freeAuthor, ONE_USDC),
      "Active free listings require the configured minimum author bond"
    );

    const { author, voucher, bond } = await setupPaidListingWithVouch(ctx);
    await revokeVouch(ctx, voucher, author);
    const authorProfile = await ctx.program.account.agentProfile.fetch(
      author.profile
    );
    assert.equal(Number(authorProfile.totalVouchStakeUsdcMicros), 0);

    const authorBond = await ctx.program.account.authorBond.fetch(
      bond.authorBond
    );
    assert.equal(Number(authorBond.amountUsdcMicros), 4 * ONE_USDC);
  });
});
