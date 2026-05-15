import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { assert } from "chai";
import { Agentvouch } from "../../target/types/agentvouch";

export const USDC_DECIMALS = 6;
export const ONE_USDC = 1_000_000;

export type TestActor = {
  keypair: Keypair;
  usdc: PublicKey;
  profile: PublicKey;
};

export type TestContext = {
  provider: anchor.AnchorProvider;
  program: Program<Agentvouch>;
  payer: Keypair;
  configAdmin: Keypair;
  usdcMint: PublicKey;
  config: PublicKey;
  protocolTreasuryVaultAuthority: PublicKey;
  protocolTreasuryVault: PublicKey;
  x402SettlementVaultAuthority: PublicKey;
  x402SettlementVault: PublicKey;
};

let cachedContext: Promise<TestContext> | null = null;

export function getProvider() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  return provider;
}

export function getProgram() {
  return anchor.workspace.Agentvouch as Program<Agentvouch>;
}

export function u64(value: number | bigint) {
  return new anchor.BN(value.toString());
}

export function uniqueSkillId(prefix = "skill") {
  return `${prefix.slice(0, 8)}-${Date.now()
    .toString(36)
    .slice(-6)}-${Math.random().toString(16).slice(2, 8)}`.slice(0, 32);
}

export function pda(
  program: Program<Agentvouch>,
  seeds: (Buffer | Uint8Array)[]
) {
  return PublicKey.findProgramAddressSync(seeds, program.programId)[0];
}

export function agentPda(program: Program<Agentvouch>, authority: PublicKey) {
  return pda(program, [Buffer.from("agent"), authority.toBuffer()]);
}

export function authorBondPda(program: Program<Agentvouch>, author: PublicKey) {
  return pda(program, [Buffer.from("author_bond"), author.toBuffer()]);
}

export function authorBondVaultAuthority(
  program: Program<Agentvouch>,
  author: PublicKey
) {
  return pda(program, [
    Buffer.from("author_bond_vault_authority"),
    author.toBuffer(),
  ]);
}

export function authorBondVault(
  program: Program<Agentvouch>,
  author: PublicKey
) {
  return pda(program, [Buffer.from("author_bond_vault"), author.toBuffer()]);
}

export function vouchPda(
  program: Program<Agentvouch>,
  voucherProfile: PublicKey,
  authorProfile: PublicKey
) {
  return pda(program, [
    Buffer.from("vouch"),
    voucherProfile.toBuffer(),
    authorProfile.toBuffer(),
  ]);
}

export function vouchVaultAuthority(
  program: Program<Agentvouch>,
  voucherProfile: PublicKey,
  authorProfile: PublicKey
) {
  return pda(program, [
    Buffer.from("vouch_vault_authority"),
    voucherProfile.toBuffer(),
    authorProfile.toBuffer(),
  ]);
}

export function vouchVault(
  program: Program<Agentvouch>,
  voucherProfile: PublicKey,
  authorProfile: PublicKey
) {
  return pda(program, [
    Buffer.from("vouch_vault"),
    voucherProfile.toBuffer(),
    authorProfile.toBuffer(),
  ]);
}

export function authorRewardVaultAuthority(
  program: Program<Agentvouch>,
  authorProfile: PublicKey
) {
  return pda(program, [
    Buffer.from("author_reward_vault_authority"),
    authorProfile.toBuffer(),
  ]);
}

export function authorRewardVault(
  program: Program<Agentvouch>,
  authorProfile: PublicKey
) {
  return pda(program, [
    Buffer.from("author_reward_vault"),
    authorProfile.toBuffer(),
  ]);
}

export function skillListingPda(
  program: Program<Agentvouch>,
  author: PublicKey,
  skillId: string
) {
  return pda(program, [
    Buffer.from("skill"),
    author.toBuffer(),
    Buffer.from(skillId),
  ]);
}

export function rewardVaultAuthority(
  program: Program<Agentvouch>,
  skillListing: PublicKey
) {
  return pda(program, [
    Buffer.from("listing_reward_vault_authority"),
    skillListing.toBuffer(),
  ]);
}

export function rewardVault(
  program: Program<Agentvouch>,
  skillListing: PublicKey
) {
  return pda(program, [
    Buffer.from("listing_reward_vault"),
    skillListing.toBuffer(),
  ]);
}

export function listingSettlementPda(
  program: Program<Agentvouch>,
  skillListing: PublicKey,
  revision = 0
) {
  const revisionBytes = new anchor.BN(revision).toArrayLike(Buffer, "le", 8);
  return pda(program, [
    Buffer.from("listing_settlement"),
    skillListing.toBuffer(),
    revisionBytes,
  ]);
}

export function authorProceedsVaultAuthority(
  program: Program<Agentvouch>,
  listingSettlement: PublicKey
) {
  return pda(program, [
    Buffer.from("author_proceeds_vault_authority"),
    listingSettlement.toBuffer(),
  ]);
}

export function authorProceedsVault(
  program: Program<Agentvouch>,
  listingSettlement: PublicKey
) {
  return pda(program, [
    Buffer.from("author_proceeds_vault"),
    listingSettlement.toBuffer(),
  ]);
}

export function listingVouchPosition(
  program: Program<Agentvouch>,
  skillListing: PublicKey,
  vouch: PublicKey
) {
  return pda(program, [
    Buffer.from("listing_vouch_position"),
    skillListing.toBuffer(),
    vouch.toBuffer(),
  ]);
}

export function purchasePda(
  program: Program<Agentvouch>,
  buyer: PublicKey,
  skillListing: PublicKey,
  revision = 0
) {
  const revisionBytes = new anchor.BN(revision).toArrayLike(Buffer, "le", 8);
  return pda(program, [
    Buffer.from("purchase"),
    buyer.toBuffer(),
    skillListing.toBuffer(),
    revisionBytes,
  ]);
}

export function refundPoolPda(
  program: Program<Agentvouch>,
  authorDispute: PublicKey
) {
  return pda(program, [Buffer.from("refund_pool"), authorDispute.toBuffer()]);
}

export function refundVaultAuthority(
  program: Program<Agentvouch>,
  refundPool: PublicKey
) {
  return pda(program, [
    Buffer.from("refund_vault_authority"),
    refundPool.toBuffer(),
  ]);
}

export function refundVault(
  program: Program<Agentvouch>,
  refundPool: PublicKey
) {
  return pda(program, [Buffer.from("refund_vault"), refundPool.toBuffer()]);
}

export function refundClaimPda(
  program: Program<Agentvouch>,
  refundPool: PublicKey,
  purchase: PublicKey
) {
  return pda(program, [
    Buffer.from("refund_claim"),
    refundPool.toBuffer(),
    purchase.toBuffer(),
  ]);
}

export function x402SettlementReceiptPda(
  program: Program<Agentvouch>,
  paymentRefHash: Buffer
) {
  return pda(program, [
    Buffer.from("x402_settlement_receipt"),
    paymentRefHash,
  ]);
}

export function x402SettlementSignatureGuardPda(
  program: Program<Agentvouch>,
  settlementTxSignatureHash: Buffer
) {
  return pda(program, [
    Buffer.from("x402_settlement_signature"),
    settlementTxSignatureHash,
  ]);
}

export function disputeBondVaultAuthority(
  program: Program<Agentvouch>,
  author: PublicKey,
  disputeId: anchor.BN
) {
  return pda(program, [
    Buffer.from("dispute_bond_vault_authority"),
    author.toBuffer(),
    disputeId.toArrayLike(Buffer, "le", 8),
  ]);
}

export function disputeBondVault(
  program: Program<Agentvouch>,
  author: PublicKey,
  disputeId: anchor.BN
) {
  return pda(program, [
    Buffer.from("dispute_bond_vault"),
    author.toBuffer(),
    disputeId.toArrayLike(Buffer, "le", 8),
  ]);
}

export function authorDisputePda(
  program: Program<Agentvouch>,
  author: PublicKey,
  disputeId: anchor.BN
) {
  return pda(program, [
    Buffer.from("author_dispute"),
    author.toBuffer(),
    disputeId.toArrayLike(Buffer, "le", 8),
  ]);
}

export async function fundSol(
  provider: anchor.AnchorProvider,
  keypair: Keypair,
  sol = 5
) {
  const sig = await provider.connection.requestAirdrop(
    keypair.publicKey,
    sol * anchor.web3.LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(sig, "confirmed");
}

export async function getTestContext(): Promise<TestContext> {
  if (cachedContext) return cachedContext;
  cachedContext = (async () => {
    const provider = getProvider();
    const program = getProgram();
    const payer = (provider.wallet as anchor.Wallet).payer;
    const configAdmin = Keypair.generate();

    await fundSol(provider, configAdmin);

    const usdcMint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      USDC_DECIMALS
    );

    const config = pda(program, [Buffer.from("config")]);
    const protocolTreasuryVaultAuthority = pda(program, [
      Buffer.from("treasury_vault_authority"),
    ]);
    const protocolTreasuryVault = pda(program, [Buffer.from("treasury_vault")]);
    const x402SettlementVaultAuthority = pda(program, [
      Buffer.from("x402_settlement_vault_authority"),
    ]);
    const x402SettlementVault = getAssociatedTokenAddressSync(
      usdcMint,
      x402SettlementVaultAuthority,
      true
    );

    await program.methods
      .initializeConfig(
        "solana:localnet",
        configAdmin.publicKey,
        configAdmin.publicKey,
        configAdmin.publicKey,
        configAdmin.publicKey,
        50,
        u64(86_400)
      )
      .accountsStrict({
        config,
        usdcMint,
        protocolTreasuryVaultAuthority,
        protocolTreasuryVault,
        x402SettlementVaultAuthority,
        x402SettlementVault,
        authority: configAdmin.publicKey,
        payer: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return {
      provider,
      program,
      payer,
      configAdmin,
      usdcMint,
      config,
      protocolTreasuryVaultAuthority,
      protocolTreasuryVault,
      x402SettlementVaultAuthority,
      x402SettlementVault,
    };
  })();
  return cachedContext;
}

export async function createActor(
  ctx: TestContext,
  initialUsdcMicros = 20 * ONE_USDC
): Promise<TestActor> {
  const keypair = Keypair.generate();
  await fundSol(ctx.provider, keypair);
  const usdc = (
    await getOrCreateAssociatedTokenAccount(
      ctx.provider.connection,
      ctx.payer,
      ctx.usdcMint,
      keypair.publicKey
    )
  ).address;
  if (initialUsdcMicros > 0) {
    await mintTo(
      ctx.provider.connection,
      ctx.payer,
      ctx.usdcMint,
      usdc,
      ctx.payer,
      initialUsdcMicros
    );
  }
  return {
    keypair,
    usdc,
    profile: agentPda(ctx.program, keypair.publicKey),
  };
}

export async function createAtaForMint(
  ctx: TestContext,
  owner: PublicKey,
  mint: PublicKey
) {
  return (
    await getOrCreateAssociatedTokenAccount(
      ctx.provider.connection,
      ctx.payer,
      mint,
      owner
    )
  ).address;
}

export async function createWrongMint(ctx: TestContext) {
  return createMint(
    ctx.provider.connection,
    ctx.payer,
    ctx.payer.publicKey,
    null,
    USDC_DECIMALS
  );
}

export async function mintToActor(
  ctx: TestContext,
  actor: TestActor,
  amountUsdcMicros: number
) {
  await mintTo(
    ctx.provider.connection,
    ctx.payer,
    ctx.usdcMint,
    actor.usdc,
    ctx.payer,
    amountUsdcMicros
  );
}

export async function fundX402SettlementVault(
  ctx: TestContext,
  amountUsdcMicros: number
) {
  await mintTo(
    ctx.provider.connection,
    ctx.payer,
    ctx.usdcMint,
    ctx.x402SettlementVault,
    ctx.payer,
    amountUsdcMicros
  );
}

export async function tokenAmount(ctx: TestContext, tokenAccount: PublicKey) {
  return (await getAccount(ctx.provider.connection, tokenAccount)).amount;
}

export async function assertTokenDelta(
  ctx: TestContext,
  tokenAccount: PublicKey,
  before: bigint,
  expectedDelta: number | bigint
) {
  const after = await tokenAmount(ctx, tokenAccount);
  assert.equal(Number(after - before), Number(expectedDelta));
}

export async function expectFailure(
  action: Promise<unknown>,
  expected: string | string[]
) {
  try {
    await action;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const expectations = Array.isArray(expected) ? expected : [expected];
    assert.isTrue(
      expectations.some((needle) => message.includes(needle)),
      `Expected error to include one of ${expectations.join(
        ", "
      )}, got: ${message}`
    );
    return;
  }
  assert.fail("Expected transaction to fail");
}

export async function registerAgent(
  ctx: TestContext,
  actor: TestActor,
  metadataUri = "https://example.com/agent.json"
) {
  await ctx.program.methods
    .registerAgent(metadataUri)
    .accountsStrict({
      agentProfile: actor.profile,
      authority: actor.keypair.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([actor.keypair])
    .rpc();
}

export async function depositAuthorBond(
  ctx: TestContext,
  author: TestActor,
  amountUsdcMicros: number
) {
  const authorBond = authorBondPda(ctx.program, author.keypair.publicKey);
  const vaultAuthority = authorBondVaultAuthority(
    ctx.program,
    author.keypair.publicKey
  );
  const vault = authorBondVault(ctx.program, author.keypair.publicKey);
  await ctx.program.methods
    .depositAuthorBond(u64(amountUsdcMicros))
    .accountsStrict({
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
    .rpc();
  return { authorBond, vaultAuthority, vault };
}

export async function withdrawAuthorBond(
  ctx: TestContext,
  author: TestActor,
  amountUsdcMicros: number
) {
  const authorBond = authorBondPda(ctx.program, author.keypair.publicKey);
  const vaultAuthority = authorBondVaultAuthority(
    ctx.program,
    author.keypair.publicKey
  );
  const vault = authorBondVault(ctx.program, author.keypair.publicKey);
  await ctx.program.methods
    .withdrawAuthorBond(u64(amountUsdcMicros))
    .accountsStrict({
      authorBond,
      authorProfile: author.profile,
      config: ctx.config,
      usdcMint: ctx.usdcMint,
      authorBondVaultAuthority: vaultAuthority,
      authorBondVault: vault,
      authorUsdcAccount: author.usdc,
      author: author.keypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([author.keypair])
    .rpc();
  return { authorBond, vaultAuthority, vault };
}

export async function createVouch(
  ctx: TestContext,
  voucher: TestActor,
  author: TestActor,
  stakeUsdcMicros: number
) {
  const vouch = vouchPda(ctx.program, voucher.profile, author.profile);
  const vaultAuthority = vouchVaultAuthority(
    ctx.program,
    voucher.profile,
    author.profile
  );
  const vault = vouchVault(ctx.program, voucher.profile, author.profile);
  const authorRewardsAuthority = authorRewardVaultAuthority(
    ctx.program,
    author.profile
  );
  const authorRewardsVault = authorRewardVault(ctx.program, author.profile);
  await ctx.program.methods
    .vouch(u64(stakeUsdcMicros))
    .accountsStrict({
      vouch,
      voucherProfile: voucher.profile,
      voucheeProfile: author.profile,
      config: ctx.config,
      usdcMint: ctx.usdcMint,
      voucherUsdcAccount: voucher.usdc,
      vouchVaultAuthority: vaultAuthority,
      vouchVault: vault,
      authorRewardVaultAuthority: authorRewardsAuthority,
      authorRewardVault: authorRewardsVault,
      voucher: voucher.keypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([voucher.keypair])
    .rpc();
  return {
    vouch,
    vaultAuthority,
    vault,
    authorRewardsAuthority,
    authorRewardsVault,
  };
}

export async function revokeVouch(
  ctx: TestContext,
  voucher: TestActor,
  author: TestActor
) {
  const vouch = vouchPda(ctx.program, voucher.profile, author.profile);
  const vaultAuthority = vouchVaultAuthority(
    ctx.program,
    voucher.profile,
    author.profile
  );
  const vault = vouchVault(ctx.program, voucher.profile, author.profile);
  await ctx.program.methods
    .revokeVouch()
    .accountsStrict({
      vouch,
      voucherProfile: voucher.profile,
      voucheeProfile: author.profile,
      config: ctx.config,
      usdcMint: ctx.usdcMint,
      vouchVaultAuthority: vaultAuthority,
      vouchVault: vault,
      voucherUsdcAccount: voucher.usdc,
      voucher: voucher.keypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([voucher.keypair])
    .rpc();
  return { vouch, vaultAuthority, vault };
}

export async function createSkillListing(
  ctx: TestContext,
  author: TestActor,
  skillId: string,
  priceUsdcMicros: number,
  authorBond?: PublicKey
) {
  const skillListing = skillListingPda(
    ctx.program,
    author.keypair.publicKey,
    skillId
  );
  const vaultAuthority = authorRewardVaultAuthority(
    ctx.program,
    author.profile
  );
  const vault = authorRewardVault(ctx.program, author.profile);
  const settlement = listingSettlementPda(ctx.program, skillListing);
  const proceedsVaultAuthority = authorProceedsVaultAuthority(
    ctx.program,
    settlement
  );
  const proceedsVault = authorProceedsVault(ctx.program, settlement);
  await ctx.program.methods
    .createSkillListing(
      skillId,
      `ipfs://${skillId}`,
      `Skill ${skillId}`,
      "USDC-native test skill",
      u64(priceUsdcMicros)
    )
    .accountsStrict({
      skillListing,
      authorProfile: author.profile,
      config: ctx.config,
      authorBond: priceUsdcMicros === 0 ? authorBond : null,
      usdcMint: ctx.usdcMint,
      listingSettlement: settlement,
      authorProceedsVaultAuthority: proceedsVaultAuthority,
      authorProceedsVault: proceedsVault,
      author: author.keypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([author.keypair])
    .rpc();
  return {
    skillListing,
    vaultAuthority,
    vault,
    settlement,
    proceedsVaultAuthority,
    proceedsVault,
  };
}

export async function linkVouchToListing(
  ctx: TestContext,
  voucher: TestActor,
  author: TestActor,
  skillListing: PublicKey,
  vouch: PublicKey,
  label?: string
) {
  const position = listingVouchPosition(ctx.program, skillListing, vouch);
  const builder = ctx.program.methods
    .linkVouchToListing()
    .accountsStrict({
      skillListing,
      listingVouchPosition: position,
      vouch,
      voucherProfile: voucher.profile,
      authorProfile: author.profile,
      config: ctx.config,
      voucher: voucher.keypair.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([voucher.keypair]);
  if (label) await sendWithMetrics(ctx, label, builder);
  else await builder.rpc();
  return position;
}

export async function unlinkVouchFromListing(
  ctx: TestContext,
  voucher: TestActor,
  author: TestActor,
  skillListing: PublicKey,
  position: PublicKey,
  vouch: PublicKey
) {
  await ctx.program.methods
    .unlinkVouchFromListing()
    .accountsStrict({
      skillListing,
      listingVouchPosition: position,
      vouch,
      voucherProfile: voucher.profile,
      authorProfile: author.profile,
      config: ctx.config,
      voucher: voucher.keypair.publicKey,
    })
    .signers([voucher.keypair])
    .rpc();
}

export async function purchaseSkill(
  ctx: TestContext,
  buyer: TestActor,
  author: TestActor,
  skillListing: PublicKey,
  rewardTokenVault: PublicKey,
  label?: string
) {
  const listingAccount = await ctx.program.account.skillListing.fetch(
    skillListing
  );
  const revision = Number(listingAccount.currentRevision);
  const settlement = listingAccount.currentSettlement;
  const proceedsVault = listingAccount.currentAuthorProceedsVault;
  const purchase = purchasePda(
    ctx.program,
    buyer.keypair.publicKey,
    skillListing,
    revision
  );
  const builder = ctx.program.methods
    .purchaseSkill()
    .accountsStrict({
      skillListing,
      purchase,
      author: author.keypair.publicKey,
      authorProfile: author.profile,
      config: ctx.config,
      usdcMint: ctx.usdcMint,
      buyerUsdcAccount: buyer.usdc,
      listingSettlement: settlement,
      authorProceedsVaultAuthority: authorProceedsVaultAuthority(
        ctx.program,
        settlement
      ),
      authorProceedsVault: proceedsVault,
      authorRewardVaultAuthority: authorRewardVaultAuthority(
        ctx.program,
        author.profile
      ),
      authorRewardVault: authorRewardVault(ctx.program, author.profile),
      buyer: buyer.keypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([buyer.keypair]);
  if (label) await sendWithMetrics(ctx, label, builder);
  else await builder.rpc();
  return purchase;
}

export async function settleX402Purchase(
  ctx: TestContext,
  buyer: TestActor,
  author: TestActor,
  skillListing: PublicKey,
  paymentRefHash: Buffer,
  settlementTxSignatureHash: Buffer,
  amountUsdcMicros: number,
  label?: string
) {
  const listingAccount = await ctx.program.account.skillListing.fetch(
    skillListing
  );
  const revision = Number(listingAccount.currentRevision);
  const settlement = listingAccount.currentSettlement;
  const proceedsVault = listingAccount.currentAuthorProceedsVault;
  const purchase = purchasePda(
    ctx.program,
    buyer.keypair.publicKey,
    skillListing,
    revision
  );
  const receipt = x402SettlementReceiptPda(ctx.program, paymentRefHash);
  const signatureGuard = x402SettlementSignatureGuardPda(
    ctx.program,
    settlementTxSignatureHash
  );
  const builder = ctx.program.methods
    .settleX402Purchase(
      Array.from(paymentRefHash),
      Array.from(settlementTxSignatureHash),
      buyer.keypair.publicKey,
      u64(amountUsdcMicros)
    )
    .accountsStrict({
      skillListing,
      purchase,
      author: author.keypair.publicKey,
      authorProfile: author.profile,
      config: ctx.config,
      usdcMint: ctx.usdcMint,
      x402SettlementVaultAuthority: ctx.x402SettlementVaultAuthority,
      x402SettlementVault: ctx.x402SettlementVault,
      listingSettlement: settlement,
      authorProceedsVaultAuthority: authorProceedsVaultAuthority(
        ctx.program,
        settlement
      ),
      authorProceedsVault: proceedsVault,
      authorRewardVaultAuthority: authorRewardVaultAuthority(
        ctx.program,
        author.profile
      ),
      authorRewardVault: authorRewardVault(ctx.program, author.profile),
      x402SettlementReceipt: receipt,
      x402SettlementSignatureGuard: signatureGuard,
      settlementAuthority: ctx.configAdmin.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([ctx.configAdmin]);
  if (label) await sendWithMetrics(ctx, label, builder);
  else await builder.rpc();
  return { purchase, receipt, signatureGuard };
}

export async function withdrawAuthorProceeds(
  ctx: TestContext,
  author: TestActor,
  skillListing: PublicKey,
  amountUsdcMicros: number
) {
  const listingAccount = await ctx.program.account.skillListing.fetch(
    skillListing
  );
  const settlement = listingAccount.currentSettlement;
  const proceedsVault = listingAccount.currentAuthorProceedsVault;
  await ctx.program.methods
    .withdrawAuthorProceeds(u64(amountUsdcMicros))
    .accountsStrict({
      skillListing,
      listingSettlement: settlement,
      config: ctx.config,
      usdcMint: ctx.usdcMint,
      authorProceedsVaultAuthority: authorProceedsVaultAuthority(
        ctx.program,
        settlement
      ),
      authorProceedsVault: proceedsVault,
      authorUsdcAccount: author.usdc,
      author: author.keypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([author.keypair])
    .rpc();
}

export async function claimVoucherRevenue(
  ctx: TestContext,
  voucher: TestActor,
  author: TestActor,
  _skillListing: PublicKey,
  _position: PublicKey,
  vouch: PublicKey,
  _rewardTokenVault: PublicKey,
  label?: string
) {
  const builder = ctx.program.methods
    .claimVoucherRevenue()
    .accountsStrict({
      authorProfile: author.profile,
      vouch,
      voucherProfile: voucher.profile,
      config: ctx.config,
      usdcMint: ctx.usdcMint,
      authorRewardVaultAuthority: authorRewardVaultAuthority(
        ctx.program,
        author.profile
      ),
      authorRewardVault: authorRewardVault(ctx.program, author.profile),
      voucherUsdcAccount: voucher.usdc,
      voucher: voucher.keypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([voucher.keypair]);
  if (label) await sendWithMetrics(ctx, label, builder);
  else await builder.rpc();
}

export async function openAuthorDispute(
  ctx: TestContext,
  challenger: TestActor,
  author: TestActor,
  skillListing: PublicKey,
  purchase: PublicKey | null,
  disputeId: anchor.BN,
  label?: string
) {
  const authorDispute = authorDisputePda(
    ctx.program,
    author.keypair.publicKey,
    disputeId
  );
  const disputeVaultAuthority = disputeBondVaultAuthority(
    ctx.program,
    author.keypair.publicKey,
    disputeId
  );
  const disputeVault = disputeBondVault(
    ctx.program,
    author.keypair.publicKey,
    disputeId
  );
  const listingAccount = await ctx.program.account.skillListing.fetch(
    skillListing
  );
  const settlement =
    Number(listingAccount.priceUsdcMicros) > 0
      ? listingAccount.currentSettlement
      : null;
  const builder = ctx.program.methods
    .openAuthorDispute(
      disputeId,
      { failedDelivery: {} },
      "https://example.com/evidence.json"
    )
    .accountsStrict({
      authorDispute,
      authorProfile: author.profile,
      config: ctx.config,
      skillListing,
      purchase,
      listingSettlement: settlement,
      usdcMint: ctx.usdcMint,
      challengerUsdcAccount: challenger.usdc,
      disputeBondVaultAuthority: disputeVaultAuthority,
      disputeBondVault: disputeVault,
      challenger: challenger.keypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([challenger.keypair]);
  if (label) await sendWithMetrics(ctx, label, builder);
  else await builder.rpc();
  return { authorDispute, disputeVaultAuthority, disputeVault };
}

export async function resolveAuthorDispute(
  ctx: TestContext,
  author: TestActor,
  challenger: TestActor,
  disputeId: anchor.BN,
  dispute: {
    authorDispute: PublicKey;
    disputeVaultAuthority: PublicKey;
    disputeVault: PublicKey;
  },
  ruling: { dismissed: {} } | { upheld: {} },
  remainingAccounts: {
    pubkey: PublicKey;
    isWritable: boolean;
    isSigner: boolean;
  }[] = [],
  label?: string
) {
  const disputeAccount = await ctx.program.account.authorDispute.fetch(
    dispute.authorDispute
  );
  const settlement =
    Number(disputeAccount.skillPriceUsdcMicrosSnapshot) > 0
      ? (
          await ctx.program.account.skillListing.fetch(
            disputeAccount.skillListing
          )
        ).currentSettlement
      : null;
  const builder = ctx.program.methods
    .resolveAuthorDispute(disputeId, ruling)
    .accountsStrict({
      authorDispute: dispute.authorDispute,
      authorProfile: author.profile,
      config: ctx.config,
      authority: ctx.configAdmin.publicKey,
      usdcMint: ctx.usdcMint,
      disputeBondVaultAuthority: dispute.disputeVaultAuthority,
      disputeBondVault: dispute.disputeVault,
      protocolTreasuryVault: ctx.protocolTreasuryVault,
      listingSettlement: settlement,
      authorBondVaultAuthority: authorBondVaultAuthority(
        ctx.program,
        author.keypair.publicKey
      ),
      challenger: challenger.keypair.publicKey,
      challengerUsdcAccount: challenger.usdc,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .remainingAccounts(remainingAccounts)
    .signers([ctx.configAdmin]);
  if (label) await sendWithMetrics(ctx, label, builder);
  else await builder.rpc();
}

export async function createRefundPool(
  ctx: TestContext,
  author: TestActor,
  challenger: TestActor,
  dispute: { authorDispute: PublicKey },
  requestedRefundPoolUsdcMicros: number
) {
  const disputeAccount = await ctx.program.account.authorDispute.fetch(
    dispute.authorDispute
  );
  const listingAccount = await ctx.program.account.skillListing.fetch(
    disputeAccount.skillListing
  );
  const settlement = listingAccount.currentSettlement;
  const pool = refundPoolPda(ctx.program, dispute.authorDispute);
  const vault = refundVault(ctx.program, pool);
  await ctx.program.methods
    .createRefundPool(u64(requestedRefundPoolUsdcMicros))
    .accountsStrict({
      authorDispute: dispute.authorDispute,
      skillListing: disputeAccount.skillListing,
      listingSettlement: settlement,
      config: ctx.config,
      authority: ctx.configAdmin.publicKey,
      usdcMint: ctx.usdcMint,
      authorProceedsVaultAuthority: authorProceedsVaultAuthority(
        ctx.program,
        settlement
      ),
      authorProceedsVault: listingAccount.currentAuthorProceedsVault,
      refundPool: pool,
      refundVaultAuthority: refundVaultAuthority(ctx.program, pool),
      refundVault: vault,
      challengerUsdcAccount: challenger.usdc,
      payer: ctx.payer.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([ctx.configAdmin])
    .rpc();
  return { refundPool: pool, refundVault: vault };
}

export async function claimPurchaseRefund(
  ctx: TestContext,
  buyer: TestActor,
  refundPool: PublicKey,
  purchase: PublicKey
) {
  const claim = refundClaimPda(ctx.program, refundPool, purchase);
  const vault = refundVault(ctx.program, refundPool);
  await ctx.program.methods
    .claimPurchaseRefund()
    .accountsStrict({
      refundPool,
      purchase,
      refundClaim: claim,
      config: ctx.config,
      usdcMint: ctx.usdcMint,
      refundVaultAuthority: refundVaultAuthority(ctx.program, refundPool),
      refundVault: vault,
      buyerUsdcAccount: buyer.usdc,
      buyer: buyer.keypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([buyer.keypair])
    .rpc();
  return claim;
}

export async function setupPaidListingWithVouch(
  ctx: TestContext,
  priceUsdcMicros = 2 * ONE_USDC
) {
  const author = await createActor(ctx);
  const voucher = await createActor(ctx);
  const buyer = await createActor(ctx);
  await registerAgent(ctx, author, "https://example.com/author.json");
  await registerAgent(ctx, voucher, "https://example.com/voucher.json");
  const bond = await depositAuthorBond(ctx, author, 4 * ONE_USDC);
  const vouch = await createVouch(ctx, voucher, author, 3 * ONE_USDC);
  const listing = await createSkillListing(
    ctx,
    author,
    uniqueSkillId("skill"),
    priceUsdcMicros,
    bond.authorBond
  );
  const position = listingVouchPosition(
    ctx.program,
    listing.skillListing,
    vouch.vouch
  );
  return { author, voucher, buyer, bond, vouch, listing, position };
}

export async function sendWithMetrics(
  ctx: TestContext,
  label: string,
  builder: any
) {
  const ix = await builder.instruction();
  let simulatedComputeUnits: number | "n/a" = "n/a";
  try {
    const simulation = await builder.simulate();
    simulatedComputeUnits = parseComputeUnits(
      simulation.raw ?? simulation.logs ?? []
    );
  } catch {
    simulatedComputeUnits = "n/a";
  }
  const sig = await builder.rpc();
  const tx = await ctx.provider.connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  const computeUnits =
    tx?.meta?.computeUnitsConsumed ??
    parseComputeUnits(tx?.meta?.logMessages ?? []) ??
    simulatedComputeUnits;
  const accountCount = ix.keys.length + 1;
  console.log(
    `[metrics] ${label}: accounts=${accountCount} compute=${computeUnits}`
  );
  return sig;
}

function parseComputeUnits(logs: string[]) {
  for (const log of logs) {
    const match = log.match(/consumed (\d+) of \d+ compute units/);
    if (match) return Number(match[1]);
  }
  return undefined;
}
