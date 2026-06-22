import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import anchor from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const require = createRequire(import.meta.url);
const idl = require("../target/idl/agentvouch.json");

const PROGRAM_ID = new PublicKey(
  "AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg"
);
const DEVNET_RPC_URL = "https://api.devnet.solana.com";
const DEVNET_USDC_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);
const DEVNET_CHAIN_CONTEXT = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const DEFAULT_AUTHOR_BOND_USDC_MICROS = 1_000_000n;
const DEFAULT_VOUCH_USDC_MICROS = 1_000_000n;
const DEFAULT_PRICE_USDC_MICROS = 1_000_000n;
const AUTHOR_SOL_FLOOR_LAMPORTS = BigInt(Math.round(0.1 * LAMPORTS_PER_SOL));
const M13_REPUTATION_CONFIG_MIN_LEN = 491;
const STATE_DIR = path.resolve(".agent-keys/m11-devnet-smoke");

function parseArgs(argv) {
  const options = {
    apply: false,
    pauseSmoke: false,
    rpcUrl: process.env.AGENTVOUCH_RPC_URL ?? DEVNET_RPC_URL,
    funderKeypair:
      process.env.AGENTVOUCH_SMOKE_FUNDER_KEYPAIR ??
      path.join(os.homedir(), ".config/solana/id.json"),
    authorityKeypair: process.env.AGENTVOUCH_SMOKE_AUTHORITY_KEYPAIR,
    stateDir: process.env.AGENTVOUCH_SMOKE_STATE_DIR ?? STATE_DIR,
    skillId: process.env.AGENTVOUCH_SMOKE_SKILL_ID,
    disputeId: process.env.AGENTVOUCH_SMOKE_DISPUTE_ID
      ? BigInt(process.env.AGENTVOUCH_SMOKE_DISPUTE_ID)
      : BigInt(Date.now()),
    authorBondUsdcMicros: DEFAULT_AUTHOR_BOND_USDC_MICROS,
    vouchUsdcMicros: DEFAULT_VOUCH_USDC_MICROS,
    priceUsdcMicros: DEFAULT_PRICE_USDC_MICROS,
    refundPoolUsdcMicros: DEFAULT_PRICE_USDC_MICROS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value after ${arg}`);
      }
      index += 1;
      return value;
    };

    if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--pause-smoke") {
      options.pauseSmoke = true;
    } else if (arg === "--rpc-url") {
      options.rpcUrl = next();
    } else if (arg === "--funder-keypair") {
      options.funderKeypair = next();
    } else if (arg === "--authority-keypair") {
      options.authorityKeypair = next();
    } else if (arg === "--state-dir") {
      options.stateDir = next();
    } else if (arg === "--skill-id") {
      options.skillId = next();
    } else if (arg === "--dispute-id") {
      options.disputeId = BigInt(next());
    } else if (arg === "--author-bond-usdc-micros") {
      options.authorBondUsdcMicros = BigInt(next());
    } else if (arg === "--vouch-usdc-micros") {
      options.vouchUsdcMicros = BigInt(next());
    } else if (arg === "--price-usdc-micros") {
      options.priceUsdcMicros = BigInt(next());
    } else if (arg === "--refund-pool-usdc-micros") {
      options.refundPoolUsdcMicros = BigInt(next());
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function expandTilde(filePath) {
  if (filePath === "~") return os.homedir();
  if (filePath.startsWith("~/"))
    return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

function enumVariant(value) {
  if (!value || typeof value !== "object") return String(value);
  return Object.keys(value)[0] ?? String(value);
}

function loadKeypair(filePath) {
  const secret = JSON.parse(readFileSync(expandTilde(filePath), "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function loadOrCreateKeypair(filePath) {
  if (existsSync(filePath)) return loadKeypair(filePath);

  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const keypair = Keypair.generate();
  writeFileSync(filePath, JSON.stringify(Array.from(keypair.secretKey)), {
    mode: 0o600,
  });
  return keypair;
}

function pda(...seeds) {
  return PublicKey.findProgramAddressSync(
    seeds.map((seed) => (typeof seed === "string" ? Buffer.from(seed) : seed)),
    PROGRAM_ID
  )[0];
}

function u64Le(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function bn(value) {
  return new anchor.BN(value.toString());
}

function tokenAccountAddress(owner) {
  return getAssociatedTokenAddressSync(
    DEVNET_USDC_MINT,
    owner,
    false,
    TOKEN_PROGRAM_ID
  );
}

async function tokenBalance(connection, address) {
  try {
    const account = await getAccount(
      connection,
      address,
      "confirmed",
      TOKEN_PROGRAM_ID
    );
    return account.amount;
  } catch {
    return null;
  }
}

async function accountExists(connection, address) {
  return (await connection.getAccountInfo(address, "confirmed")) !== null;
}

async function fetchNullable(fetcher, address) {
  try {
    return await fetcher.fetch(address);
  } catch {
    return null;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const generatedSkillId = `a1smoke-${Date.now().toString(36)}`;
  const stateDir = path.resolve(options.stateDir);
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });

  const funder = loadKeypair(options.funderKeypair);
  const authority = options.authorityKeypair
    ? loadKeypair(options.authorityKeypair)
    : null;
  const authorKeypairPath = path.join(stateDir, "author-keypair.json");
  const author = loadOrCreateKeypair(authorKeypairPath);
  const actorKeypairPath = path.join(stateDir, "actor-keypair.json");
  const actor = loadOrCreateKeypair(actorKeypairPath);
  const skillIdPath = path.join(stateDir, "skill-id.txt");
  let persistedSkillId =
    options.skillId ??
    (existsSync(skillIdPath)
      ? readFileSync(skillIdPath, "utf8").trim()
      : generatedSkillId);
  if (Buffer.byteLength(persistedSkillId) > 32) {
    if (options.skillId) {
      throw new Error(
        "Skill id must fit in one Solana PDA seed (32 bytes max)."
      );
    }
    persistedSkillId = generatedSkillId;
  }
  if (
    !existsSync(skillIdPath) ||
    readFileSync(skillIdPath, "utf8").trim() !== persistedSkillId
  ) {
    writeFileSync(skillIdPath, persistedSkillId);
  }
  const pauseSkillId = `${persistedSkillId.slice(0, 26)}-pause`;

  const connection = new anchor.web3.Connection(options.rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(funder),
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  const program = new anchor.Program(idl, provider);

  const config = pda("config");
  const actorProfile = pda("agent", actor.publicKey.toBuffer());
  const authorProfile = pda("agent", author.publicKey.toBuffer());
  const authorBond = pda("author_bond", author.publicKey.toBuffer());
  const authorBondVaultAuthority = pda(
    "author_bond_vault_authority",
    author.publicKey.toBuffer()
  );
  const authorBondVault = pda("author_bond_vault", author.publicKey.toBuffer());
  const skillListing = pda(
    "skill",
    author.publicKey.toBuffer(),
    Buffer.from(persistedSkillId)
  );
  const pauseSkillListing = pda(
    "skill",
    author.publicKey.toBuffer(),
    Buffer.from(pauseSkillId)
  );
  const authorRewardVaultAuthority = pda(
    "author_reward_vault_authority",
    authorProfile.toBuffer()
  );
  const authorRewardVault = pda(
    "author_reward_vault",
    authorProfile.toBuffer()
  );
  let listingRevision = 0n;
  let listingRevisionSeed = u64Le(listingRevision);
  let listingSettlement = pda(
    "listing_settlement",
    skillListing.toBuffer(),
    listingRevisionSeed
  );
  let authorProceedsVaultAuthority = pda(
    "author_proceeds_vault_authority",
    listingSettlement.toBuffer()
  );
  let authorProceedsVault = pda(
    "author_proceeds_vault",
    listingSettlement.toBuffer()
  );
  const vouch = pda("vouch", actorProfile.toBuffer(), authorProfile.toBuffer());
  const vouchVaultAuthority = pda(
    "vouch_vault_authority",
    actorProfile.toBuffer(),
    authorProfile.toBuffer()
  );
  const vouchVault = pda(
    "vouch_vault",
    actorProfile.toBuffer(),
    authorProfile.toBuffer()
  );
  const listingVouchPosition = pda(
    "listing_vouch_position",
    skillListing.toBuffer(),
    vouch.toBuffer()
  );
  let purchase = pda(
    "purchase",
    actor.publicKey.toBuffer(),
    skillListing.toBuffer(),
    listingRevisionSeed
  );
  const pauseListingRevisionSeed = u64Le(0n);
  const pauseListingSettlement = pda(
    "listing_settlement",
    pauseSkillListing.toBuffer(),
    pauseListingRevisionSeed
  );
  const pauseAuthorProceedsVaultAuthority = pda(
    "author_proceeds_vault_authority",
    pauseListingSettlement.toBuffer()
  );
  const pauseAuthorProceedsVault = pda(
    "author_proceeds_vault",
    pauseListingSettlement.toBuffer()
  );
  const disputeIdSeed = u64Le(options.disputeId);
  const authorDispute = pda(
    "author_dispute",
    author.publicKey.toBuffer(),
    disputeIdSeed
  );
  const disputeBondVaultAuthority = pda(
    "dispute_bond_vault_authority",
    author.publicKey.toBuffer(),
    disputeIdSeed
  );
  const disputeBondVault = pda(
    "dispute_bond_vault",
    author.publicKey.toBuffer(),
    disputeIdSeed
  );
  const disputeVouchLink = pda(
    "dispute_vouch_link",
    authorDispute.toBuffer(),
    vouch.toBuffer()
  );
  const refundPool = pda("refund_pool", authorDispute.toBuffer());
  const refundVaultAuthority = pda(
    "refund_vault_authority",
    refundPool.toBuffer()
  );
  const refundVault = pda("refund_vault", refundPool.toBuffer());
  const refundClaim = pda(
    "refund_claim",
    refundPool.toBuffer(),
    purchase.toBuffer()
  );
  const funderUsdcAccount = tokenAccountAddress(funder.publicKey);
  const actorUsdcAccount = tokenAccountAddress(actor.publicKey);
  const authorUsdcAccount = tokenAccountAddress(author.publicKey);

  const configAccountInfo = await connection.getAccountInfo(
    config,
    "confirmed"
  );
  if (!configAccountInfo) {
    throw new Error(
      `Config PDA ${config.toBase58()} does not exist on devnet. Run initialize_config first.`
    );
  }
  if (!configAccountInfo.owner.equals(PROGRAM_ID)) {
    throw new Error(
      `Config PDA ${config.toBase58()} is owned by ${configAccountInfo.owner.toBase58()}, expected ${PROGRAM_ID.toBase58()}.`
    );
  }
  if (configAccountInfo.data.length < M13_REPUTATION_CONFIG_MIN_LEN) {
    throw new Error(
      `Config PDA ${config.toBase58()} is ${
        configAccountInfo.data.length
      } bytes, expected at least ${M13_REPUTATION_CONFIG_MIN_LEN} for M13. Run npm run migrate:config -- --apply with the config authority, then rerun this smoke.`
    );
  }

  const configAccount = await program.account.reputationConfig.fetch(config);
  if (configAccount.usdcMint.toBase58() !== DEVNET_USDC_MINT.toBase58()) {
    throw new Error("Config USDC mint does not match devnet USDC.");
  }
  if (configAccount.chainContext !== DEVNET_CHAIN_CONTEXT) {
    throw new Error("Config chain context does not match devnet CAIP-2.");
  }
  const requiredAuthority = options.pauseSmoke
    ? configAccount.pauseAuthority
    : configAccount.configAuthority;
  const requiredAuthorityLabel = options.pauseSmoke
    ? "pause authority"
    : "config authority";
  if (
    authority &&
    authority.publicKey.toBase58() !== requiredAuthority.toBase58()
  ) {
    throw new Error(
      `Authority keypair ${authority.publicKey.toBase58()} does not match ${requiredAuthorityLabel} ${requiredAuthority.toBase58()}.`
    );
  }
  const disputeBondUsdcMicros = BigInt(
    configAccount.disputeBondUsdcMicros.toString()
  );

  const initialFunderSol = await connection.getBalance(
    funder.publicKey,
    "confirmed"
  );
  const initialAuthorSol = await connection.getBalance(
    author.publicKey,
    "confirmed"
  );
  const initialActorSol = await connection.getBalance(
    actor.publicKey,
    "confirmed"
  );
  const initialFunderUsdc = await tokenBalance(connection, funderUsdcAccount);
  const initialActorUsdc = await tokenBalance(connection, actorUsdcAccount);
  const initialAuthorUsdc = await tokenBalance(connection, authorUsdcAccount);
  const existingAuthorBond = await fetchNullable(
    program.account.authorBond,
    authorBond
  );
  const existingSkillListing = await fetchNullable(
    program.account.skillListing,
    skillListing
  );
  if (existingSkillListing?.currentRevision !== undefined) {
    listingRevision = BigInt(existingSkillListing.currentRevision.toString());
    listingRevisionSeed = u64Le(listingRevision);
    listingSettlement = pda(
      "listing_settlement",
      skillListing.toBuffer(),
      listingRevisionSeed
    );
    authorProceedsVaultAuthority = pda(
      "author_proceeds_vault_authority",
      listingSettlement.toBuffer()
    );
    authorProceedsVault = pda(
      "author_proceeds_vault",
      listingSettlement.toBuffer()
    );
    purchase = pda(
      "purchase",
      actor.publicKey.toBuffer(),
      skillListing.toBuffer(),
      listingRevisionSeed
    );
  }
  const existingVouch = await fetchNullable(program.account.vouch, vouch);
  const existingListingVouchPosition = await fetchNullable(
    program.account.listingVouchPosition,
    listingVouchPosition
  );
  const existingPurchase = await fetchNullable(
    program.account.purchase,
    purchase
  );
  const existingAuthorDispute = await fetchNullable(
    program.account.authorDispute,
    authorDispute
  );

  const summary = {
    mode: options.apply ? "apply" : "dry-run",
    smokeMode: options.pauseSmoke ? "pause" : "full",
    rpcUrl: options.rpcUrl,
    programId: PROGRAM_ID.toBase58(),
    usdcMint: DEVNET_USDC_MINT.toBase58(),
    chainContext: configAccount.chainContext,
    stateDir,
    funder: funder.publicKey.toBase58(),
    authority: authority?.publicKey.toBase58() ?? null,
    actor: actor.publicKey.toBase58(),
    author: author.publicKey.toBase58(),
    authorKeypairPath,
    actorKeypairPath,
    skillId: persistedSkillId,
    pauseSkillId,
    amounts: {
      authorBondUsdcMicros: options.authorBondUsdcMicros.toString(),
      vouchUsdcMicros: options.vouchUsdcMicros.toString(),
      priceUsdcMicros: options.priceUsdcMicros.toString(),
      disputeBondUsdcMicros: disputeBondUsdcMicros.toString(),
      requestedRefundPoolUsdcMicros: options.refundPoolUsdcMicros.toString(),
      expectedAuthorPurchaseShareUsdcMicros: (
        (options.priceUsdcMicros * BigInt(configAccount.authorShareBps)) /
        10_000n
      ).toString(),
      expectedVoucherRewardUsdcMicros: (
        (options.priceUsdcMicros * BigInt(configAccount.voucherShareBps)) /
        10_000n
      ).toString(),
    },
    accounts: {
      config: config.toBase58(),
      actorProfile: actorProfile.toBase58(),
      authorProfile: authorProfile.toBase58(),
      funderUsdcAccount: funderUsdcAccount.toBase58(),
      actorUsdcAccount: actorUsdcAccount.toBase58(),
      authorUsdcAccount: authorUsdcAccount.toBase58(),
      authorBond: authorBond.toBase58(),
      authorBondVaultAuthority: authorBondVaultAuthority.toBase58(),
      authorBondVault: authorBondVault.toBase58(),
      skillListing: skillListing.toBase58(),
      pauseSkillListing: pauseSkillListing.toBase58(),
      authorRewardVaultAuthority: authorRewardVaultAuthority.toBase58(),
      authorRewardVault: authorRewardVault.toBase58(),
      vouch: vouch.toBase58(),
      vouchVaultAuthority: vouchVaultAuthority.toBase58(),
      vouchVault: vouchVault.toBase58(),
      listingVouchPosition: listingVouchPosition.toBase58(),
      purchase: purchase.toBase58(),
      authorDispute: authorDispute.toBase58(),
      disputeBondVaultAuthority: disputeBondVaultAuthority.toBase58(),
      disputeBondVault: disputeBondVault.toBase58(),
      disputeVouchLink: disputeVouchLink.toBase58(),
      refundPool: refundPool.toBase58(),
      refundVaultAuthority: refundVaultAuthority.toBase58(),
      refundVault: refundVault.toBase58(),
      refundClaim: refundClaim.toBase58(),
    },
    preflight: {
      funderSol: initialFunderSol / LAMPORTS_PER_SOL,
      actorSol: initialActorSol / LAMPORTS_PER_SOL,
      authorSol: initialAuthorSol / LAMPORTS_PER_SOL,
      funderUsdcMicros: initialFunderUsdc?.toString() ?? "missing",
      actorUsdcMicros: initialActorUsdc?.toString() ?? "missing",
      authorUsdcMicros: initialAuthorUsdc?.toString() ?? "missing",
      authorBondExists: Boolean(existingAuthorBond),
      skillListingExists: Boolean(existingSkillListing),
      vouchExists: Boolean(existingVouch),
      listingVouchPositionExists: Boolean(existingListingVouchPosition),
      purchaseExists: Boolean(existingPurchase),
      authorDisputeExists: Boolean(existingAuthorDispute),
      configAuthority: configAccount.configAuthority.toBase58(),
      pauseAuthority: configAccount.pauseAuthority.toBase58(),
      paused: configAccount.paused,
    },
    plannedSteps: options.pauseSmoke
      ? [
          "prepare a fresh paid listing with a linked vouch and one purchase",
          "set paused true with the configured pause authority",
          "prove a new paid listing is blocked while paused",
          "claim voucher revenue while paused",
          "set paused false with the configured pause authority",
          "prove the previously blocked paid listing can be created after unpause",
        ]
      : [
          "fund author SOL for account rent if below 0.1 SOL",
          "fund actor SOL for account rent if below 0.1 SOL",
          "create author USDC ATA if missing",
          "fund author USDC ATA for the author bond if needed",
          "create and fund actor USDC ATA for vouching and purchasing",
          "register actor/voucher/buyer profile",
          "register author profile",
          "deposit author bond",
          "create paid skill listing and settlement vaults",
          "create USDC vouch from funder to author",
          "link the vouch to the paid listing",
          "purchase listing as funder/buyer",
          "claim voucher revenue to funder USDC ATA",
          "if an authority keypair is provided: open an author dispute, resolve upheld, slash linked vouches, create a refund pool, and claim the buyer refund",
        ],
  };

  if (!options.apply) {
    console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
    return;
  }

  if (initialFunderUsdc === null) {
    throw new Error("Funder USDC ATA is missing.");
  }
  const requiredUsdc =
    options.authorBondUsdcMicros +
    options.vouchUsdcMicros +
    options.priceUsdcMicros +
    (authority ? disputeBondUsdcMicros : 0n);
  if (initialFunderUsdc < requiredUsdc) {
    throw new Error(
      `Funder has ${initialFunderUsdc} micro-USDC, expected at least ${requiredUsdc}.`
    );
  }

  const transactions = [];
  async function send(label, transaction, signers) {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      signers,
      {
        commitment: "confirmed",
      }
    );
    transactions.push({ label, signature });
    return signature;
  }

  async function expectFailure(label, buildTransaction, signers, expectedText) {
    try {
      await send(label, await buildTransaction(), signers);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes(expectedText)) {
        throw new Error(
          `${label} failed, but not with "${expectedText}": ${message}`
        );
      }
      transactions.push({
        label,
        expectedFailure: true,
        reason: message.split("\n")[0],
      });
      return;
    }
    throw new Error(`${label} unexpectedly succeeded.`);
  }

  if (BigInt(initialAuthorSol) < AUTHOR_SOL_FLOOR_LAMPORTS) {
    await send(
      "fund-author-sol",
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: funder.publicKey,
          toPubkey: author.publicKey,
          lamports: Number(
            AUTHOR_SOL_FLOOR_LAMPORTS - BigInt(initialAuthorSol)
          ),
        })
      ),
      [funder]
    );
  }

  if (BigInt(initialActorSol) < AUTHOR_SOL_FLOOR_LAMPORTS) {
    await send(
      "fund-actor-sol",
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: funder.publicKey,
          toPubkey: actor.publicKey,
          lamports: Number(AUTHOR_SOL_FLOOR_LAMPORTS - BigInt(initialActorSol)),
        })
      ),
      [funder]
    );
  }

  const latestAuthorUsdc = await tokenBalance(connection, authorUsdcAccount);
  const setupAuthorUsdc = new Transaction();
  if (latestAuthorUsdc === null) {
    setupAuthorUsdc.add(
      createAssociatedTokenAccountInstruction(
        funder.publicKey,
        authorUsdcAccount,
        author.publicKey,
        DEVNET_USDC_MINT
      )
    );
  }
  const fundedBondAmount = existingAuthorBond?.amountUsdcMicros
    ? BigInt(existingAuthorBond.amountUsdcMicros.toString())
    : 0n;
  const remainingBondAmount =
    options.authorBondUsdcMicros > fundedBondAmount
      ? options.authorBondUsdcMicros - fundedBondAmount
      : 0n;
  const authorUsdcAfterAta = latestAuthorUsdc ?? 0n;
  if (remainingBondAmount > authorUsdcAfterAta) {
    setupAuthorUsdc.add(
      createTransferCheckedInstruction(
        funderUsdcAccount,
        DEVNET_USDC_MINT,
        authorUsdcAccount,
        funder.publicKey,
        remainingBondAmount - authorUsdcAfterAta,
        6
      )
    );
  }
  if (setupAuthorUsdc.instructions.length > 0) {
    await send("prepare-author-usdc", setupAuthorUsdc, [funder]);
  }

  const latestActorUsdc = await tokenBalance(connection, actorUsdcAccount);
  const setupActorUsdc = new Transaction();
  if (latestActorUsdc === null) {
    setupActorUsdc.add(
      createAssociatedTokenAccountInstruction(
        funder.publicKey,
        actorUsdcAccount,
        actor.publicKey,
        DEVNET_USDC_MINT
      )
    );
  }
  const requiredActorUsdc =
    options.vouchUsdcMicros +
    options.priceUsdcMicros +
    (authority ? disputeBondUsdcMicros : 0n);
  const actorUsdcAfterAta = latestActorUsdc ?? 0n;
  if (requiredActorUsdc > actorUsdcAfterAta) {
    setupActorUsdc.add(
      createTransferCheckedInstruction(
        funderUsdcAccount,
        DEVNET_USDC_MINT,
        actorUsdcAccount,
        funder.publicKey,
        requiredActorUsdc - actorUsdcAfterAta,
        6
      )
    );
  }
  if (setupActorUsdc.instructions.length > 0) {
    await send("prepare-actor-usdc", setupActorUsdc, [funder]);
  }

  if (!(await accountExists(connection, actorProfile))) {
    const tx = await program.methods
      .registerAgent("https://agentvouch.xyz/smoke/actor.json")
      .accountsStrict({
        agentProfile: actorProfile,
        authority: actor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    await send("register-actor-profile", tx, [actor]);
  }

  if (!(await accountExists(connection, authorProfile))) {
    const tx = await program.methods
      .registerAgent("https://agentvouch.xyz/smoke/author.json")
      .accountsStrict({
        agentProfile: authorProfile,
        authority: author.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    await send("register-author-profile", tx, [author]);
  }

  const refreshedAuthorBond = await fetchNullable(
    program.account.authorBond,
    authorBond
  );
  const refreshedBondAmount = refreshedAuthorBond?.amountUsdcMicros
    ? BigInt(refreshedAuthorBond.amountUsdcMicros.toString())
    : 0n;
  const bondDeposit =
    options.authorBondUsdcMicros > refreshedBondAmount
      ? options.authorBondUsdcMicros - refreshedBondAmount
      : 0n;
  if (bondDeposit > 0n) {
    const tx = await program.methods
      .depositAuthorBond(bn(bondDeposit))
      .accountsStrict({
        authorBond,
        authorProfile,
        config,
        usdcMint: DEVNET_USDC_MINT,
        authorUsdcAccount,
        authorBondVaultAuthority,
        authorBondVault,
        author: author.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    await send("deposit-author-bond", tx, [author]);
  }

  if (!(await accountExists(connection, skillListing))) {
    const tx = await program.methods
      .createSkillListing(
        persistedSkillId,
        `https://agentvouch.xyz/smoke/${persistedSkillId}.md`,
        "M11 Devnet Smoke",
        "USDC-native devnet smoke listing",
        bn(options.priceUsdcMicros)
      )
      .accountsStrict({
        skillListing,
        authorProfile,
        config,
        authorBond: null,
        usdcMint: DEVNET_USDC_MINT,
        listingSettlement,
        authorProceedsVaultAuthority,
        authorProceedsVault,
        author: author.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    await send("create-skill-listing", tx, [author]);
  }

  if (!(await accountExists(connection, listingSettlement))) {
    const tx = await program.methods
      .initializeListingSettlement()
      .accountsStrict({
        skillListing,
        config,
        usdcMint: DEVNET_USDC_MINT,
        listingSettlement,
        authorProceedsVaultAuthority,
        authorProceedsVault,
        author: author.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    await send("initialize-listing-settlement", tx, [author]);
  }

  if (!(await accountExists(connection, vouch))) {
    const tx = await program.methods
      .vouch(bn(options.vouchUsdcMicros))
      .accountsStrict({
        vouch,
        voucherProfile: actorProfile,
        voucheeProfile: authorProfile,
        config,
        usdcMint: DEVNET_USDC_MINT,
        voucherUsdcAccount: actorUsdcAccount,
        vouchVaultAuthority,
        vouchVault,
        authorRewardVaultAuthority,
        authorRewardVault,
        voucher: actor.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    await send("create-vouch", tx, [actor]);
  }

  if (!(await accountExists(connection, listingVouchPosition))) {
    const tx = await program.methods
      .linkVouchToListing()
      .accountsStrict({
        skillListing,
        listingVouchPosition,
        vouch,
        voucherProfile: actorProfile,
        authorProfile,
        config,
        voucher: actor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    await send("link-vouch-to-listing", tx, [actor]);
  }

  if (!(await accountExists(connection, purchase))) {
    const tx = await program.methods
      .purchaseSkill()
      .accountsStrict({
        skillListing,
        purchase,
        author: author.publicKey,
        authorProfile,
        config,
        usdcMint: DEVNET_USDC_MINT,
        buyerUsdcAccount: actorUsdcAccount,
        listingSettlement,
        authorProceedsVaultAuthority,
        authorProceedsVault,
        authorRewardVaultAuthority,
        authorRewardVault,
        buyer: actor.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    await send("purchase-skill", tx, [actor]);
  }

  if (options.pauseSmoke) {
    if (!authority) {
      throw new Error(
        "Pause smoke requires AGENTVOUCH_SMOKE_AUTHORITY_KEYPAIR or --authority-keypair for config.pause_authority."
      );
    }
    if (await accountExists(connection, pauseSkillListing)) {
      throw new Error(
        `Pause smoke listing ${pauseSkillListing.toBase58()} already exists. Pass a fresh --skill-id.`
      );
    }

    async function setPausedValue(paused, label) {
      const tx = await program.methods
        .setPaused(paused)
        .accountsStrict({
          config,
          pauseAuthority: authority.publicKey,
        })
        .transaction();
      await send(label, tx, [authority]);

      const pauseConfig = await program.account.reputationConfig.fetch(config);
      if (pauseConfig.paused !== paused) {
        throw new Error(
          `set_paused(${paused}) did not persist config.paused = ${paused}.`
        );
      }
    }

    async function unpauseAfterFailure() {
      try {
        const currentConfig = await program.account.reputationConfig.fetch(
          config
        );
        if (currentConfig.paused) {
          await setPausedValue(false, "set-paused-false-cleanup");
        }
      } catch (cleanupError) {
        console.error(
          "Pause smoke failed after pausing, and cleanup unpause also failed:",
          cleanupError
        );
      }
    }

    try {
      await setPausedValue(true, "set-paused-true");

      await expectFailure(
        "paused-create-skill-listing",
        () =>
          program.methods
            .createSkillListing(
              pauseSkillId,
              `https://agentvouch.xyz/smoke/${pauseSkillId}.md`,
              "A3 Pause Smoke",
              "Pause smoke listing",
              bn(options.priceUsdcMicros)
            )
            .accountsStrict({
              skillListing: pauseSkillListing,
              authorProfile,
              config,
              authorBond: null,
              usdcMint: DEVNET_USDC_MINT,
              listingSettlement: pauseListingSettlement,
              authorProceedsVaultAuthority: pauseAuthorProceedsVaultAuthority,
              authorProceedsVault: pauseAuthorProceedsVault,
              author: author.publicKey,
              tokenProgram: TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .transaction(),
        [author],
        "Protocol is paused"
      );

      let tx = await program.methods
        .claimVoucherRevenue()
        .accountsStrict({
          authorProfile,
          vouch,
          voucherProfile: actorProfile,
          config,
          usdcMint: DEVNET_USDC_MINT,
          authorRewardVaultAuthority,
          authorRewardVault,
          voucherUsdcAccount: actorUsdcAccount,
          voucher: actor.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .transaction();
      await send("claim-voucher-revenue-while-paused", tx, [actor]);

      await setPausedValue(false, "set-paused-false");
    } catch (error) {
      await unpauseAfterFailure();
      throw error;
    }

    const tx = await program.methods
      .createSkillListing(
        pauseSkillId,
        `https://agentvouch.xyz/smoke/${pauseSkillId}.md`,
        "A3 Pause Smoke",
        "Pause smoke listing",
        bn(options.priceUsdcMicros)
      )
      .accountsStrict({
        skillListing: pauseSkillListing,
        authorProfile,
        config,
        authorBond: null,
        usdcMint: DEVNET_USDC_MINT,
        listingSettlement: pauseListingSettlement,
        authorProceedsVaultAuthority: pauseAuthorProceedsVaultAuthority,
        authorProceedsVault: pauseAuthorProceedsVault,
        author: author.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    await send("create-skill-listing-after-unpause", tx, [author]);

    const finalPauseListing = await program.account.skillListing.fetch(
      pauseSkillListing
    );
    const finalConfig = await program.account.reputationConfig.fetch(config);
    console.log(
      JSON.stringify(
        {
          ok: true,
          ...summary,
          transactions,
          postState: {
            paused: finalConfig.paused,
            pauseSkillListing: pauseSkillListing.toBase58(),
            pauseListingStatus: enumVariant(finalPauseListing.status),
          },
        },
        null,
        2
      )
    );
    return;
  }

  try {
    const tx = await program.methods
      .claimVoucherRevenue()
      .accountsStrict({
        authorProfile,
        vouch,
        voucherProfile: actorProfile,
        config,
        usdcMint: DEVNET_USDC_MINT,
        authorRewardVaultAuthority,
        authorRewardVault,
        voucherUsdcAccount: actorUsdcAccount,
        voucher: actor.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .transaction();
    await send("claim-voucher-revenue", tx, [actor]);
  } catch (error) {
    transactions.push({
      label: "claim-voucher-revenue",
      skipped: true,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  let disputeResult;
  if (!authority) {
    disputeResult = {
      skipped: true,
      reason:
        "resolve_author_dispute requires the config authority keypair; no AGENTVOUCH_SMOKE_AUTHORITY_KEYPAIR was provided.",
    };
  } else {
    if (await accountExists(connection, authorDispute)) {
      throw new Error(
        `Author dispute ${authorDispute.toBase58()} already exists. Pass a fresh --dispute-id or --skill-id.`
      );
    }

    let tx = await program.methods
      .openAuthorDispute(
        bn(options.disputeId),
        { failedDelivery: {} },
        `https://agentvouch.xyz/smoke/${persistedSkillId}/evidence.json`
      )
      .accountsStrict({
        authorDispute,
        authorProfile,
        config,
        skillListing,
        purchase,
        listingSettlement,
        usdcMint: DEVNET_USDC_MINT,
        challengerUsdcAccount: actorUsdcAccount,
        disputeBondVaultAuthority,
        disputeBondVault,
        challenger: actor.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    await send("open-author-dispute", tx, [actor]);

    tx = await program.methods
      .resolveAuthorDispute(bn(options.disputeId), { upheld: {} })
      .accountsStrict({
        authorDispute,
        authorProfile,
        skillListing,
        config,
        authority: authority.publicKey,
        usdcMint: DEVNET_USDC_MINT,
        disputeBondVaultAuthority,
        disputeBondVault,
        protocolTreasuryVault: configAccount.protocolTreasuryVault,
        listingSettlement,
        authorBondVaultAuthority,
        challenger: actor.publicKey,
        challengerUsdcAccount: actorUsdcAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: authorBond, isWritable: true, isSigner: false },
        { pubkey: authorBondVault, isWritable: true, isSigner: false },
      ])
      .transaction();
    await send("resolve-author-dispute-upheld", tx, [authority]);

    tx = await program.methods
      .slashDisputeVouches()
      .accountsStrict({
        authorDispute,
        authorProfile,
        skillListing,
        listingSettlement,
        config,
        usdcMint: DEVNET_USDC_MINT,
        authorProceedsVault,
        cranker: actor.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([
        { pubkey: listingVouchPosition, isWritable: true, isSigner: false },
        { pubkey: vouch, isWritable: true, isSigner: false },
        { pubkey: vouchVault, isWritable: true, isSigner: false },
        { pubkey: vouchVaultAuthority, isWritable: false, isSigner: false },
        { pubkey: disputeVouchLink, isWritable: true, isSigner: false },
      ])
      .transaction();
    await send("slash-dispute-vouches", tx, [actor]);

    tx = await program.methods
      .createRefundPool(bn(options.refundPoolUsdcMicros))
      .accountsStrict({
        authorDispute,
        skillListing,
        listingSettlement,
        config,
        authority: authority.publicKey,
        usdcMint: DEVNET_USDC_MINT,
        authorProceedsVaultAuthority,
        authorProceedsVault,
        refundPool,
        refundVaultAuthority,
        refundVault,
        challengerUsdcAccount: actorUsdcAccount,
        payer: funder.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    await send("create-refund-pool", tx, [authority, funder]);

    tx = await program.methods
      .claimPurchaseRefund()
      .accountsStrict({
        refundPool,
        purchase,
        refundClaim,
        config,
        usdcMint: DEVNET_USDC_MINT,
        refundVaultAuthority,
        refundVault,
        buyerUsdcAccount: actorUsdcAccount,
        buyer: actor.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    await send("claim-purchase-refund", tx, [actor]);

    const disputeAccount = await program.account.authorDispute.fetch(
      authorDispute
    );
    const refundPoolAccount = await program.account.refundPool.fetch(
      refundPool
    );
    disputeResult = {
      skipped: false,
      disputeId: options.disputeId.toString(),
      status: enumVariant(disputeAccount.status),
      ruling: enumVariant(disputeAccount.ruling),
      linkedVouchCount: disputeAccount.linkedVouchCount.toString(),
      processedVouchCount: disputeAccount.processedVouchCount.toString(),
      authorBondSlashedUsdcMicros:
        disputeAccount.authorBondSlashedUsdcMicros.toString(),
      voucherSlashedUsdcMicros:
        disputeAccount.voucherSlashedUsdcMicros.toString(),
      refundPoolUsdcMicros: refundPoolAccount.totalPoolUsdcMicros.toString(),
      claimedRefundUsdcMicros: refundPoolAccount.claimedUsdcMicros.toString(),
      refundPoolRemainingUsdcMicros:
        refundPoolAccount.remainingPoolUsdcMicros.toString(),
    };
  }

  const finalListing = await program.account.skillListing.fetch(skillListing);
  const finalVouch = await program.account.vouch.fetch(vouch);
  const finalAuthorProfile = await program.account.agentProfile.fetch(
    authorProfile
  );
  const finalPurchase = await program.account.purchase.fetch(purchase);
  const finalAuthorBond = await program.account.authorBond.fetch(authorBond);
  const finalFunderUsdc = await tokenBalance(connection, funderUsdcAccount);
  const finalActorUsdc = await tokenBalance(connection, actorUsdcAccount);
  const finalAuthorUsdc = await tokenBalance(connection, authorUsdcAccount);
  const finalAuthorRewardVault = await tokenBalance(
    connection,
    authorRewardVault
  );
  const finalAuthorProceedsVault = await tokenBalance(
    connection,
    authorProceedsVault
  );
  const finalVouchVault = await tokenBalance(connection, vouchVault);
  const finalSettlement = await program.account.listingSettlement.fetch(
    listingSettlement
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        ...summary,
        transactions,
        postState: {
          authorBondUsdcMicros: finalAuthorBond.amountUsdcMicros.toString(),
          listingTotalDownloads: finalListing.totalDownloads.toString(),
          listingTotalRevenueUsdcMicros:
            finalListing.totalRevenueUsdcMicros.toString(),
          authorUnclaimedVoucherRevenueUsdcMicros:
            finalAuthorProfile.unclaimedVoucherRevenueUsdcMicros.toString(),
          vouchCumulativeRevenueUsdcMicros:
            finalVouch.cumulativeRevenueUsdcMicros.toString(),
          vouchStatus: enumVariant(finalVouch.status),
          listingActiveRewardPositionCount:
            finalListing.activeRewardPositionCount.toString(),
          purchasePricePaidUsdcMicros:
            finalPurchase.pricePaidUsdcMicros.toString(),
          settlementWithdrawableAuthorProceedsUsdcMicros:
            finalSettlement.withdrawableAuthorProceedsUsdcMicros.toString(),
          settlementSlashedDepositUsdcMicros:
            finalSettlement.slashedDepositUsdcMicros.toString(),
          settlementLockedByDispute:
            finalSettlement.lockedByDispute?.toBase58?.() ?? null,
          funderUsdcMicros: finalFunderUsdc?.toString() ?? "missing",
          actorUsdcMicros: finalActorUsdc?.toString() ?? "missing",
          authorUsdcMicros: finalAuthorUsdc?.toString() ?? "missing",
          authorProceedsVaultUsdcMicros:
            finalAuthorProceedsVault?.toString() ?? "missing",
          authorRewardVaultUsdcMicros:
            finalAuthorRewardVault?.toString() ?? "missing",
          vouchVaultUsdcMicros: finalVouchVault?.toString() ?? "missing",
        },
        dispute: disputeResult,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
