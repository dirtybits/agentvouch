import fs from "fs";
import { createSolanaRpc, address } from "@solana/kit";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  fetchMaybePurchase,
  fetchMaybeReputationConfig,
} from "@/generated/agentvouch/src/generated";
import { getPurchaseSkillInstructionDataEncoder } from "@/generated/agentvouch/src/generated/instructions/purchaseSkill";
import { AGENTVOUCH_PROGRAM_ADDRESS } from "@/generated/agentvouch/src/generated/programs";
import { fetchOnChainSkillListing } from "@/lib/onchain";
import { getAgentVouchChainContext } from "@/lib/protocolMetadata";
import { DEFAULT_SOLANA_RPC_URL } from "@/lib/solanaRpc";
import {
  parseSponsoredCheckoutMicroUsdcPerSol,
  quoteSponsoredCheckoutSetupFee,
} from "@/lib/sponsoredCheckout";

const PROGRAM_ID = new PublicKey(AGENTVOUCH_PROGRAM_ADDRESS);
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
const SYSTEM_PROGRAM_ID = SystemProgram.programId;
// Must stay in sync with `Purchase::SPACE` in
// programs/agentvouch/src/state/purchase.rs (8 disc + 32 buyer + 32 listing +
// 8 ts + 8 revision + 32 settlement + 8 + 8 + 8 + 32 mint + 1 bump = 177).
// Used only to quote the sponsor's rent reimbursement — the program allocates
// the real size, so a drift here silently under/over-charges the setup fee.
const PURCHASE_ACCOUNT_SPACE = 177;
// SPL token account is a fixed 165 bytes.
const TOKEN_ACCOUNT_SPACE = 165;
const USDC_DECIMALS = 6;

type SponsoredPurchasePrepareInput = {
  buyerPubkey: string;
  listingAddress: string;
  skillDbId?: string | null;
  expectedPriceUsdcMicros?: string | number | bigint | null;
  expectedUsdcMint?: string | null;
  maxSetupFeeUsdcMicros?: string | number | bigint | null;
};

type TokenAccountState = {
  exists: boolean;
  mint: PublicKey | null;
  owner: PublicKey | null;
  amount: bigint;
};

export type SponsoredPurchasePrepareResult = {
  transaction: string;
  encoding: "base64";
  blockhash: string;
  lastValidBlockHeight: number;
  quote: {
    priceUsdcMicros: string;
    setupFeeUsdcMicros: string;
    rentLamports: string;
    transactionFeeLamports: string;
    capped: boolean;
  };
  accounts: {
    buyer: string;
    sponsor: string;
    skillListing: string;
    purchase: string;
    buyerUsdcAccount: string;
    sponsorUsdcFeeDestination: string | null;
  };
  expiresAt: string;
};

export type SponsoredPurchaseSubmitResult = {
  signature: string;
  purchasePda: string;
  buyerPubkey: string;
  listingAddress: string;
  setupFeeUsdcMicros: string;
};

function isTruthy(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true";
}

function requireEnabled() {
  if (!isTruthy(process.env.AGENTVOUCH_SPONSORED_CHECKOUT_ENABLED)) {
    throw new Error("Sponsored checkout is not enabled");
  }
}

function parseNonNegativeBigInt(
  value: string | number | bigint | null | undefined,
  label: string
) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = BigInt(value);
  if (parsed < 0n) throw new Error(`${label} must be non-negative`);
  return parsed;
}

function requirePubkey(value: string | undefined | null, label: string) {
  if (!value) throw new Error(`${label} is required`);
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`${label} is not a valid Solana address`);
  }
}

/**
 * SECURITY: the sponsor co-signs the prepared transaction as fee payer + rent
 * payer. If the buyer is *also* the sponsor, the buyer / rent_payer / fee_payer
 * signer slots collapse onto a single key, so `partialSign(sponsor)` fully
 * signs the transaction with no user signature required — letting an attacker
 * drain the sponsor's USDC into an attacker-owned listing. Both the prepare and
 * submit paths must reject buyer == sponsor. See AGENTS.md "Security invariants".
 */
export function assertBuyerIsNotSponsor(buyer: PublicKey, sponsor: PublicKey) {
  if (buyer.equals(sponsor)) {
    throw new Error(
      "Invalid sponsored checkout: buyer must not be the sponsor account"
    );
  }
}

function parseSecretBytes(raw: string, label: string) {
  const trimmed = raw.trim();
  let bytes: number[];
  if (trimmed.startsWith("[")) {
    bytes = JSON.parse(trimmed) as number[];
  } else if (trimmed.startsWith("base64:")) {
    const decoded = Buffer.from(trimmed.slice("base64:".length), "base64");
    const decodedText = decoded.toString("utf8").trim();
    bytes = decodedText.startsWith("[")
      ? (JSON.parse(decodedText) as number[])
      : Array.from(decoded);
  } else if (/^\d+(,\d+)+$/.test(trimmed)) {
    bytes = trimmed.split(",").map((value) => Number(value.trim()));
  } else {
    throw new Error(
      `${label} must be a JSON byte array, comma-delimited byte list, base64:<raw-secret>, or base64:<json-secret>`
    );
  }

  if (
    bytes.length !== 64 ||
    bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
  ) {
    throw new Error(`${label} must contain 64 bytes`);
  }
  return Uint8Array.from(bytes);
}

// Cache the parsed keypair so the secret is read/parsed once per instance
// instead of on every prepare/validate call (less secret handling on the hot
// path). Module-scoped, so it never leaves the server process.
let cachedSponsorKeypair: Keypair | null = null;

function loadSponsorKeypair() {
  if (cachedSponsorKeypair) return cachedSponsorKeypair;
  const inlineSecret = process.env.AGENTVOUCH_SPONSOR_SECRET_KEY;
  const keypairPath = process.env.AGENTVOUCH_SPONSOR_KEYPAIR_PATH;
  if (inlineSecret) {
    cachedSponsorKeypair = Keypair.fromSecretKey(
      parseSecretBytes(inlineSecret, "AGENTVOUCH_SPONSOR_SECRET_KEY")
    );
  } else if (keypairPath) {
    cachedSponsorKeypair = Keypair.fromSecretKey(
      parseSecretBytes(
        fs.readFileSync(keypairPath, "utf8"),
        "AGENTVOUCH_SPONSOR_KEYPAIR_PATH"
      )
    );
  } else {
    throw new Error(
      "AGENTVOUCH_SPONSOR_SECRET_KEY or AGENTVOUCH_SPONSOR_KEYPAIR_PATH is required"
    );
  }
  return cachedSponsorKeypair;
}

function u64Le(value: bigint | number | string) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function pda(...seeds: Array<string | Buffer | Uint8Array>) {
  return PublicKey.findProgramAddressSync(
    seeds.map((seed) => (typeof seed === "string" ? Buffer.from(seed) : seed)),
    PROGRAM_ID
  )[0];
}

function deriveAta(owner: PublicKey, mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

async function fetchTokenAccountState(
  connection: Connection,
  tokenAccount: PublicKey
): Promise<TokenAccountState> {
  const account = await connection.getAccountInfo(tokenAccount, "confirmed");
  if (!account) {
    return { exists: false, mint: null, owner: null, amount: 0n };
  }
  if (!account.owner.equals(TOKEN_PROGRAM_ID) || account.data.length < 72) {
    throw new Error(
      `${tokenAccount.toBase58()} is not a valid SPL token account`
    );
  }
  return {
    exists: true,
    mint: new PublicKey(account.data.subarray(0, 32)),
    owner: new PublicKey(account.data.subarray(32, 64)),
    amount: account.data.readBigUInt64LE(64),
  };
}

function createTransferCheckedInstruction(input: {
  source: PublicKey;
  mint: PublicKey;
  destination: PublicKey;
  owner: PublicKey;
  amount: bigint;
  decimals: number;
}) {
  const data = Buffer.alloc(10);
  data[0] = 12; // SPL Token TransferChecked.
  data.writeBigUInt64LE(input.amount, 1);
  data[9] = input.decimals;

  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: input.source, isSigner: false, isWritable: true },
      { pubkey: input.mint, isSigner: false, isWritable: false },
      { pubkey: input.destination, isSigner: false, isWritable: true },
      { pubkey: input.owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

function readTransferCheckedAmount(instruction: TransactionInstruction) {
  if (
    !instruction.programId.equals(TOKEN_PROGRAM_ID) ||
    instruction.data.length !== 10 ||
    instruction.data[0] !== 12 ||
    instruction.data[9] !== USDC_DECIMALS
  ) {
    throw new Error("Invalid sponsor reimbursement transfer instruction");
  }
  return instruction.data.readBigUInt64LE(1);
}

function createPurchaseInstruction(input: {
  skillListing: PublicKey;
  purchase: PublicKey;
  author: PublicKey;
  authorProfile: PublicKey;
  config: PublicKey;
  usdcMint: PublicKey;
  buyerUsdcAccount: PublicKey;
  listingSettlement: PublicKey;
  authorProceedsVaultAuthority: PublicKey;
  authorProceedsVault: PublicKey;
  authorRewardVaultAuthority: PublicKey;
  authorRewardVault: PublicKey;
  buyer: PublicKey;
  rentPayer: PublicKey;
}) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: input.skillListing, isSigner: false, isWritable: true },
      { pubkey: input.purchase, isSigner: false, isWritable: true },
      { pubkey: input.author, isSigner: false, isWritable: false },
      { pubkey: input.authorProfile, isSigner: false, isWritable: true },
      { pubkey: input.config, isSigner: false, isWritable: false },
      { pubkey: input.usdcMint, isSigner: false, isWritable: false },
      { pubkey: input.buyerUsdcAccount, isSigner: false, isWritable: true },
      { pubkey: input.listingSettlement, isSigner: false, isWritable: true },
      {
        pubkey: input.authorProceedsVaultAuthority,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: input.authorProceedsVault, isSigner: false, isWritable: true },
      {
        pubkey: input.authorRewardVaultAuthority,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: input.authorRewardVault, isSigner: false, isWritable: true },
      { pubkey: input.buyer, isSigner: true, isWritable: true },
      { pubkey: input.rentPayer, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(getPurchaseSkillInstructionDataEncoder().encode({})),
  });
}

function instructionDataEquals(a: Buffer, b: Buffer) {
  return a.length === b.length && a.equals(b);
}

async function resolvePurchaseContext(input: {
  buyerPubkey: string;
  listingAddress: string;
  expectedPriceUsdcMicros?: string | number | bigint | null;
  expectedUsdcMint?: string | null;
  sponsor: PublicKey;
}) {
  const connection = new Connection(DEFAULT_SOLANA_RPC_URL, "confirmed");
  const rpc = createSolanaRpc(DEFAULT_SOLANA_RPC_URL);
  const config = pda("config");
  const configAccount = await fetchMaybeReputationConfig(
    rpc,
    address(config.toBase58())
  );
  if (!configAccount.exists) {
    throw new Error("AgentVouch config account was not found");
  }
  if (configAccount.data.paused) {
    throw new Error("AgentVouch protocol is paused");
  }
  if (configAccount.data.chainContext !== getAgentVouchChainContext()) {
    throw new Error("Configured chain context mismatch");
  }

  const skillListing = requirePubkey(input.listingAddress, "listingAddress");
  const buyer = requirePubkey(input.buyerPubkey, "buyerPubkey");
  assertBuyerIsNotSponsor(buyer, input.sponsor);
  const listing = await fetchOnChainSkillListing(skillListing.toBase58(), {
    useCache: false,
  });
  if (!listing) {
    throw new Error("Skill listing account was not found on-chain");
  }
  if (listing.data.priceUsdcMicros <= 0n) {
    throw new Error("Sponsored checkout only supports paid listings");
  }

  const expectedPrice = parseNonNegativeBigInt(
    input.expectedPriceUsdcMicros,
    "expectedPriceUsdcMicros"
  );
  if (
    expectedPrice !== null &&
    expectedPrice !== listing.data.priceUsdcMicros
  ) {
    throw new Error("Expected price does not match on-chain listing");
  }

  const usdcMint = new PublicKey(String(configAccount.data.usdcMint));
  if (
    input.expectedUsdcMint &&
    !usdcMint.equals(requirePubkey(input.expectedUsdcMint, "expectedUsdcMint"))
  ) {
    throw new Error("Expected USDC mint does not match config");
  }

  const author = new PublicKey(String(listing.data.author));
  const authorProfile = pda("agent", author.toBuffer());
  const listingSettlement = new PublicKey(
    String(listing.data.currentSettlement)
  );
  const authorProceedsVault = new PublicKey(
    String(listing.data.currentAuthorProceedsVault)
  );
  const purchase = pda(
    "purchase",
    buyer.toBuffer(),
    skillListing.toBuffer(),
    u64Le(listing.data.currentRevision)
  );
  const authorProceedsVaultAuthority = pda(
    "author_proceeds_vault_authority",
    listingSettlement.toBuffer()
  );
  const authorRewardVaultAuthority = pda(
    "author_reward_vault_authority",
    authorProfile.toBuffer()
  );
  const authorRewardVault = pda(
    "author_reward_vault",
    authorProfile.toBuffer()
  );
  const buyerUsdcAccount = deriveAta(buyer, usdcMint);

  const purchaseAccount = await fetchMaybePurchase(
    rpc,
    address(purchase.toBase58())
  );
  if (purchaseAccount.exists) {
    throw new Error(
      "This buyer already has a purchase receipt for this revision"
    );
  }

  const buyerTokenState = await fetchTokenAccountState(
    connection,
    buyerUsdcAccount
  );
  if (
    !buyerTokenState.exists ||
    !buyerTokenState.mint?.equals(usdcMint) ||
    !buyerTokenState.owner?.equals(buyer)
  ) {
    throw new Error(
      "Buyer USDC associated token account is missing or invalid"
    );
  }

  const purchaseRentLamports =
    await connection.getMinimumBalanceForRentExemption(PURCHASE_ACCOUNT_SPACE);
  const authorRewardVaultState = await fetchTokenAccountState(
    connection,
    authorRewardVault
  );
  const rewardVaultRentLamports = authorRewardVaultState.exists
    ? 0
    : await connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SPACE);

  return {
    connection,
    config,
    usdcMint,
    buyer,
    skillListing,
    author,
    authorProfile,
    listingSettlement,
    authorProceedsVault,
    purchase,
    authorProceedsVaultAuthority,
    authorRewardVaultAuthority,
    authorRewardVault,
    buyerUsdcAccount,
    sponsor: input.sponsor,
    buyerUsdcBalance: buyerTokenState.amount,
    priceUsdcMicros: listing.data.priceUsdcMicros,
    rentLamports: BigInt(purchaseRentLamports + rewardVaultRentLamports),
  };
}

function getSponsorFeeDestination(setupFeeUsdcMicros: bigint) {
  if (setupFeeUsdcMicros === 0n) return null;
  return requirePubkey(
    process.env.AGENTVOUCH_SPONSOR_USDC_FEE_DESTINATION,
    "AGENTVOUCH_SPONSOR_USDC_FEE_DESTINATION"
  );
}

function getMaxSetupFeeCap() {
  return parseNonNegativeBigInt(
    process.env.AGENTVOUCH_SPONSOR_MAX_FEE_USDC_MICROS,
    "AGENTVOUCH_SPONSOR_MAX_FEE_USDC_MICROS"
  );
}

function buildTransaction(input: {
  context: Awaited<ReturnType<typeof resolvePurchaseContext>>;
  blockhash: string;
  setupFeeUsdcMicros: bigint;
  sponsorFeeDestination: PublicKey | null;
}) {
  const purchaseInstruction = createPurchaseInstruction({
    skillListing: input.context.skillListing,
    purchase: input.context.purchase,
    author: input.context.author,
    authorProfile: input.context.authorProfile,
    config: input.context.config,
    usdcMint: input.context.usdcMint,
    buyerUsdcAccount: input.context.buyerUsdcAccount,
    listingSettlement: input.context.listingSettlement,
    authorProceedsVaultAuthority: input.context.authorProceedsVaultAuthority,
    authorProceedsVault: input.context.authorProceedsVault,
    authorRewardVaultAuthority: input.context.authorRewardVaultAuthority,
    authorRewardVault: input.context.authorRewardVault,
    buyer: input.context.buyer,
    rentPayer: input.context.sponsor,
  });
  const transaction = new Transaction({
    feePayer: input.context.sponsor,
    recentBlockhash: input.blockhash,
  }).add(purchaseInstruction);

  if (input.setupFeeUsdcMicros > 0n) {
    if (!input.sponsorFeeDestination) {
      throw new Error("Sponsor USDC fee destination is required");
    }
    transaction.add(
      createTransferCheckedInstruction({
        source: input.context.buyerUsdcAccount,
        mint: input.context.usdcMint,
        destination: input.sponsorFeeDestination,
        owner: input.context.buyer,
        amount: input.setupFeeUsdcMicros,
        decimals: USDC_DECIMALS,
      })
    );
  }

  return transaction;
}

async function getTransactionFeeLamports(
  connection: Connection,
  transaction: Transaction
) {
  const fee = await connection.getFeeForMessage(
    transaction.compileMessage(),
    "confirmed"
  );
  return BigInt(fee.value ?? transaction.signatures.length * 5_000);
}

export async function prepareSponsoredPurchase(
  input: SponsoredPurchasePrepareInput
): Promise<SponsoredPurchasePrepareResult> {
  requireEnabled();
  const sponsor = loadSponsorKeypair();
  const context = await resolvePurchaseContext({
    ...input,
    sponsor: sponsor.publicKey,
  });
  const latestBlockhash = await context.connection.getLatestBlockhash(
    "confirmed"
  );
  const prelim = buildTransaction({
    context,
    blockhash: latestBlockhash.blockhash,
    setupFeeUsdcMicros: 0n,
    sponsorFeeDestination: null,
  });
  const transactionFeeLamports = await getTransactionFeeLamports(
    context.connection,
    prelim
  );
  const quote = quoteSponsoredCheckoutSetupFee({
    rentLamports: context.rentLamports,
    transactionFeeLamports,
    microUsdcPerSol: parseSponsoredCheckoutMicroUsdcPerSol(
      process.env.AGENTVOUCH_SPONSOR_SOL_USDC_MICRO_PRICE
    ),
    capUsdcMicros: getMaxSetupFeeCap(),
  });
  const buyerMaxSetupFee = parseNonNegativeBigInt(
    input.maxSetupFeeUsdcMicros,
    "maxSetupFeeUsdcMicros"
  );
  if (
    buyerMaxSetupFee !== null &&
    quote.setupFeeUsdcMicros > buyerMaxSetupFee
  ) {
    throw new Error("Quoted setup fee exceeds buyer max setup fee");
  }
  const totalBuyerUsdc = context.priceUsdcMicros + quote.setupFeeUsdcMicros;
  if (context.buyerUsdcBalance < totalBuyerUsdc) {
    throw new Error("Buyer USDC balance is below price plus setup fee");
  }

  const sponsorFeeDestination = getSponsorFeeDestination(
    quote.setupFeeUsdcMicros
  );
  if (sponsorFeeDestination) {
    const destinationState = await fetchTokenAccountState(
      context.connection,
      sponsorFeeDestination
    );
    if (
      !destinationState.exists ||
      !destinationState.mint?.equals(context.usdcMint)
    ) {
      throw new Error("Sponsor USDC fee destination is missing or wrong mint");
    }
  }

  const transaction = buildTransaction({
    context,
    blockhash: latestBlockhash.blockhash,
    setupFeeUsdcMicros: quote.setupFeeUsdcMicros,
    sponsorFeeDestination,
  });
  transaction.partialSign(sponsor);

  return {
    transaction: transaction
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64"),
    encoding: "base64",
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    quote: {
      priceUsdcMicros: context.priceUsdcMicros.toString(),
      setupFeeUsdcMicros: quote.setupFeeUsdcMicros.toString(),
      rentLamports: context.rentLamports.toString(),
      transactionFeeLamports: transactionFeeLamports.toString(),
      capped: quote.capped,
    },
    accounts: {
      buyer: context.buyer.toBase58(),
      sponsor: sponsor.publicKey.toBase58(),
      skillListing: context.skillListing.toBase58(),
      purchase: context.purchase.toBase58(),
      buyerUsdcAccount: context.buyerUsdcAccount.toBase58(),
      sponsorUsdcFeeDestination: sponsorFeeDestination?.toBase58() ?? null,
    },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

function assertKey(actual: PublicKey, expected: PublicKey, label: string) {
  if (!actual.equals(expected)) {
    throw new Error(`${label} mismatch`);
  }
}

async function validateSubmittedTransaction(transaction: Transaction) {
  const sponsor = loadSponsorKeypair();
  if (!transaction.feePayer) {
    throw new Error("Sponsored checkout transaction is missing a fee payer");
  }
  assertKey(transaction.feePayer, sponsor.publicKey, "fee payer");
  if (
    transaction.instructions.length < 1 ||
    transaction.instructions.length > 2
  ) {
    throw new Error(
      "Sponsored checkout transaction has unexpected instruction count"
    );
  }
  if (
    transaction.signatures.some((signature) => signature.signature === null)
  ) {
    throw new Error("Sponsored checkout transaction is missing signatures");
  }
  if (!transaction.verifySignatures()) {
    throw new Error("Sponsored checkout transaction signatures are invalid");
  }

  const purchaseInstruction = transaction.instructions[0];
  if (!purchaseInstruction.programId.equals(PROGRAM_ID)) {
    throw new Error("First instruction must be AgentVouch purchase_skill");
  }
  if (purchaseInstruction.keys.length !== 16) {
    throw new Error("purchase_skill account count mismatch");
  }
  const expectedData = Buffer.from(
    getPurchaseSkillInstructionDataEncoder().encode({})
  );
  if (!instructionDataEquals(purchaseInstruction.data, expectedData)) {
    throw new Error("purchase_skill instruction data mismatch");
  }

  const buyer = purchaseInstruction.keys[12];
  const rentPayer = purchaseInstruction.keys[13];
  if (!buyer.isSigner || !buyer.isWritable) {
    throw new Error("purchase_skill buyer must be a writable signer");
  }
  if (
    !rentPayer.isSigner ||
    !rentPayer.isWritable ||
    !rentPayer.pubkey.equals(sponsor.publicKey)
  ) {
    throw new Error("purchase_skill rent payer must be the sponsor signer");
  }
  // Defense in depth: reject a self-dealt purchase before re-deriving context.
  assertBuyerIsNotSponsor(buyer.pubkey, sponsor.publicKey);

  const context = await resolvePurchaseContext({
    buyerPubkey: buyer.pubkey.toBase58(),
    listingAddress: purchaseInstruction.keys[0].pubkey.toBase58(),
    sponsor: sponsor.publicKey,
  });
  const expectedPurchase = createPurchaseInstruction({
    skillListing: context.skillListing,
    purchase: context.purchase,
    author: context.author,
    authorProfile: context.authorProfile,
    config: context.config,
    usdcMint: context.usdcMint,
    buyerUsdcAccount: context.buyerUsdcAccount,
    listingSettlement: context.listingSettlement,
    authorProceedsVaultAuthority: context.authorProceedsVaultAuthority,
    authorProceedsVault: context.authorProceedsVault,
    authorRewardVaultAuthority: context.authorRewardVaultAuthority,
    authorRewardVault: context.authorRewardVault,
    buyer: context.buyer,
    rentPayer: context.sponsor,
  });
  purchaseInstruction.keys.forEach((key, index) => {
    const expected = expectedPurchase.keys[index];
    assertKey(key.pubkey, expected.pubkey, `purchase account ${index}`);
    if (
      key.isSigner !== expected.isSigner ||
      key.isWritable !== expected.isWritable
    ) {
      throw new Error(`purchase account ${index} meta mismatch`);
    }
  });

  let setupFeeUsdcMicros = 0n;
  if (transaction.instructions.length === 2) {
    const sponsorFeeDestination = getSponsorFeeDestination(1n);
    if (!sponsorFeeDestination) {
      throw new Error("Sponsor reimbursement destination is required");
    }
    const reimbursement = transaction.instructions[1];
    setupFeeUsdcMicros = readTransferCheckedAmount(reimbursement);
    const keys = reimbursement.keys;
    if (keys.length !== 4) {
      throw new Error("Sponsor reimbursement account count mismatch");
    }
    assertKey(keys[0].pubkey, context.buyerUsdcAccount, "reimbursement source");
    assertKey(keys[1].pubkey, context.usdcMint, "reimbursement mint");
    assertKey(
      keys[2].pubkey,
      sponsorFeeDestination,
      "reimbursement destination"
    );
    assertKey(keys[3].pubkey, context.buyer, "reimbursement owner");
    if (!keys[3].isSigner) {
      throw new Error("Sponsor reimbursement owner must sign");
    }
  }
  const maxCap = getMaxSetupFeeCap();
  if (maxCap !== null && setupFeeUsdcMicros > maxCap) {
    throw new Error("Sponsor reimbursement exceeds configured cap");
  }
  if (context.buyerUsdcBalance < context.priceUsdcMicros + setupFeeUsdcMicros) {
    throw new Error("Buyer USDC balance is below submitted transaction amount");
  }

  return {
    connection: context.connection,
    setupFeeUsdcMicros,
    buyerPubkey: context.buyer.toBase58(),
    listingAddress: context.skillListing.toBase58(),
    purchasePda: context.purchase.toBase58(),
  };
}

export async function submitSponsoredPurchase(
  serializedTransaction: string
): Promise<SponsoredPurchaseSubmitResult> {
  requireEnabled();
  if (!serializedTransaction || typeof serializedTransaction !== "string") {
    throw new Error("serializedTransaction is required");
  }
  const transaction = Transaction.from(
    Buffer.from(serializedTransaction, "base64")
  );
  const validation = await validateSubmittedTransaction(transaction);
  const simulation = await validation.connection.simulateTransaction(
    transaction
  );
  if (simulation.value.err) {
    throw new Error(
      `Sponsored checkout simulation failed: ${JSON.stringify(
        simulation.value.err
      )}${
        simulation.value.logs
          ? ` logs=${simulation.value.logs.join(" | ")}`
          : ""
      }`
    );
  }
  const signature = await validation.connection.sendRawTransaction(
    transaction.serialize(),
    { skipPreflight: false }
  );
  await validation.connection.confirmTransaction(signature, "confirmed");

  return {
    signature,
    purchasePda: validation.purchasePda,
    buyerPubkey: validation.buyerPubkey,
    listingAddress: validation.listingAddress,
    setupFeeUsdcMicros: validation.setupFeeUsdcMicros.toString(),
  };
}
