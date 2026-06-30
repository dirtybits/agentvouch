import { createSolanaRpc, address } from "@solana/kit";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  fetchMaybeAgentProfile,
  fetchMaybeReputationConfig,
} from "@/generated/agentvouch/src/generated";
import {
  getRegisterAgentInstructionDataDecoder,
  getRegisterAgentInstructionDataEncoder,
} from "@/generated/agentvouch/src/generated/instructions/registerAgent";
import { getAgentVouchChainContext } from "@/lib/protocolMetadata";
import { DEFAULT_SOLANA_RPC_URL } from "@/lib/solanaRpc";
import {
  parseSponsoredCheckoutMicroUsdcPerSol,
  quoteSponsoredCheckoutSetupFee,
} from "@/lib/sponsoredCheckout";
import {
  estimateKoraSetupFeeUsdcMicros,
  getKoraFeeToken,
  signTransactionWithKora,
} from "@/lib/koraSponsor";
// Reuse the security-critical sponsor primitives from the purchase flow so there
// is a single source of truth for sponsor-key loading, the reimbursement transfer,
// and the fee cap. This file only adds the register_agent-specific shape.
import {
  PROGRAM_ID,
  USDC_DECIMALS,
  assertBuyerIsNotSponsor,
  assertKey,
  assertSponsorFeeDestinationReady,
  assertSponsoredTransactionSignatures,
  createTransferCheckedInstruction,
  deriveAta,
  fetchTokenAccountState,
  formatUsdcMicros,
  getMaxSetupFeeCap,
  getSponsoredTransactionDebug,
  getSponsoredCoreInstructions,
  getSponsorFeeDestination,
  getTransactionFeeLamports,
  parseNonNegativeBigInt,
  pda,
  readTransferCheckedAmount,
  requireEnabled,
  requirePubkey,
  resolveSponsorSigningContext,
} from "@/lib/sponsoredPurchase";

const SYSTEM_PROGRAM_ID = SystemProgram.programId;
// Must stay in sync with `AgentProfile::LEN` in
// programs/agentvouch/src/state/agent.rs (8 disc + 32 authority + (4+200) uri +
// 8+4+4+8+8+4+4+4+4 + 32+32+16+8+8 + 1 + 1 = 390). Used only to quote the
// sponsor's rent reimbursement — the program allocates the real size, so a drift
// here silently under/over-charges the setup fee.
const AGENT_PROFILE_SPACE = 390;
// Mirror of AgentProfile::MAX_URI_LENGTH; reject oversize URIs before the chain does.
const MAX_URI_LENGTH = 200;

type SponsoredRegisterAgentPrepareInput = {
  authorityPubkey: string;
  metadataUri?: string | null;
  maxSetupFeeUsdcMicros?: string | number | bigint | null;
};

export type SponsoredRegisterAgentPrepareResult = {
  transaction: string;
  encoding: "base64";
  blockhash: string;
  lastValidBlockHeight: number;
  quote: {
    setupFeeUsdcMicros: string;
    rentLamports: string;
    transactionFeeLamports: string;
    capped: boolean;
  };
  accounts: {
    authority: string;
    sponsor: string;
    agentProfile: string;
    authorityUsdcAccount: string;
    sponsorUsdcFeeDestination: string | null;
  };
  debug: ReturnType<typeof getSponsoredTransactionDebug>;
  expiresAt: string;
};

export type SponsoredRegisterAgentSubmitResult = {
  signature: string;
  agentProfile: string;
  authorityPubkey: string;
  setupFeeUsdcMicros: string;
};

export function normalizeSponsoredRegisterAgentMetadataUri(
  value: string | null | undefined
) {
  const uri = typeof value === "string" ? value : "";
  if (Buffer.byteLength(uri, "utf8") > MAX_URI_LENGTH) {
    throw new Error(`metadataUri must be at most ${MAX_URI_LENGTH} bytes`);
  }
  return uri;
}

function instructionDataEquals(a: Buffer, b: Buffer) {
  return a.length === b.length && a.equals(b);
}

function encodeRegisterAgentData(metadataUri: string) {
  return Buffer.from(
    getRegisterAgentInstructionDataEncoder().encode({ metadataUri })
  );
}

function createRegisterAgentInstruction(input: {
  agentProfile: PublicKey;
  authority: PublicKey;
  rentPayer: PublicKey;
  metadataUri: string;
}) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: input.agentProfile, isSigner: false, isWritable: true },
      // authority signs as identity but is NOT the rent payer (so it stays read-only).
      { pubkey: input.authority, isSigner: true, isWritable: false },
      // rent_payer = sponsor: funds the AgentProfile PDA so the user needs no SOL.
      { pubkey: input.rentPayer, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: encodeRegisterAgentData(input.metadataUri),
  });
}

async function resolveRegisterAgentContext(input: {
  authorityPubkey: string;
  metadataUri: string;
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

  const authority = requirePubkey(input.authorityPubkey, "authorityPubkey");
  assertBuyerIsNotSponsor(authority, input.sponsor);

  const agentProfile = pda("agent", authority.toBuffer());
  const agentProfileAccount = await fetchMaybeAgentProfile(
    rpc,
    address(agentProfile.toBase58())
  );
  if (agentProfileAccount.exists) {
    // init_if_needed means re-registration pays no rent, so there is nothing for
    // the sponsor to fund; the direct (self-pay) path handles metadata updates.
    throw new Error("This authority already has a registered agent profile");
  }

  const usdcMint = new PublicKey(String(configAccount.data.usdcMint));
  const authorityUsdcAccount = deriveAta(authority, usdcMint);
  const authorityTokenState = await fetchTokenAccountState(
    connection,
    authorityUsdcAccount
  );
  if (
    !authorityTokenState.exists ||
    !authorityTokenState.mint?.equals(usdcMint) ||
    !authorityTokenState.owner?.equals(authority)
  ) {
    throw new Error(
      "Authority USDC associated token account is missing or invalid"
    );
  }

  const rentLamports = await connection.getMinimumBalanceForRentExemption(
    AGENT_PROFILE_SPACE
  );

  return {
    connection,
    authority,
    agentProfile,
    usdcMint,
    authorityUsdcAccount,
    authorityUsdcBalance: authorityTokenState.amount,
    sponsor: input.sponsor,
    metadataUri: input.metadataUri,
    rentLamports: BigInt(rentLamports),
  };
}

function buildTransaction(input: {
  context: Awaited<ReturnType<typeof resolveRegisterAgentContext>>;
  blockhash: string;
  setupFeeUsdcMicros: bigint;
  sponsorFeeDestination: PublicKey | null;
}) {
  const registerInstruction = createRegisterAgentInstruction({
    agentProfile: input.context.agentProfile,
    authority: input.context.authority,
    rentPayer: input.context.sponsor,
    metadataUri: input.context.metadataUri,
  });
  const transaction = new Transaction({
    feePayer: input.context.sponsor,
    recentBlockhash: input.blockhash,
  }).add(registerInstruction);

  if (input.setupFeeUsdcMicros > 0n) {
    if (!input.sponsorFeeDestination) {
      throw new Error("Sponsor USDC fee destination is required");
    }
    transaction.add(
      createTransferCheckedInstruction({
        source: input.context.authorityUsdcAccount,
        mint: input.context.usdcMint,
        destination: input.sponsorFeeDestination,
        owner: input.context.authority,
        amount: input.setupFeeUsdcMicros,
        decimals: USDC_DECIMALS,
      })
    );
  }

  return transaction;
}

export async function prepareSponsoredRegisterAgent(
  input: SponsoredRegisterAgentPrepareInput
): Promise<SponsoredRegisterAgentPrepareResult> {
  requireEnabled();
  const sponsor = resolveSponsorSigningContext();
  const metadataUri = normalizeSponsoredRegisterAgentMetadataUri(
    input.metadataUri
  );
  const context = await resolveRegisterAgentContext({
    authorityPubkey: input.authorityPubkey,
    metadataUri,
    sponsor: sponsor.publicKey,
  });
  const latestBlockhash = await context.connection.getLatestBlockhash(
    "confirmed"
  );
  let sponsorFeeDestination: PublicKey | null = null;
  let transactionFeeLamports: bigint;
  let quote: { setupFeeUsdcMicros: bigint; capped: boolean };
  if (sponsor.mode === "kora") {
    sponsorFeeDestination = getSponsorFeeDestination(1n);
    await assertSponsorFeeDestinationReady(
      context.connection,
      sponsorFeeDestination,
      context.usdcMint
    );
    const prelim = buildTransaction({
      context,
      blockhash: latestBlockhash.blockhash,
      setupFeeUsdcMicros: 1n,
      sponsorFeeDestination,
    });
    const koraQuote = await estimateKoraSetupFeeUsdcMicros({
      transaction: prelim,
      feeToken: getKoraFeeToken(context.usdcMint),
      capUsdcMicros: getMaxSetupFeeCap(),
    });
    transactionFeeLamports =
      koraQuote.feeInLamports > context.rentLamports
        ? koraQuote.feeInLamports - context.rentLamports
        : koraQuote.feeInLamports;
    quote = {
      setupFeeUsdcMicros: koraQuote.setupFeeUsdcMicros,
      capped: koraQuote.capped,
    };
  } else {
    const prelim = buildTransaction({
      context,
      blockhash: latestBlockhash.blockhash,
      setupFeeUsdcMicros: 0n,
      sponsorFeeDestination: null,
    });
    transactionFeeLamports = await getTransactionFeeLamports(
      context.connection,
      prelim
    );
    quote = quoteSponsoredCheckoutSetupFee({
      rentLamports: context.rentLamports,
      transactionFeeLamports,
      microUsdcPerSol: parseSponsoredCheckoutMicroUsdcPerSol(
        process.env.AGENTVOUCH_SPONSOR_SOL_USDC_MICRO_PRICE
      ),
      capUsdcMicros: getMaxSetupFeeCap(),
    });
    sponsorFeeDestination = getSponsorFeeDestination(quote.setupFeeUsdcMicros);
    await assertSponsorFeeDestinationReady(
      context.connection,
      sponsorFeeDestination,
      context.usdcMint
    );
  }
  const callerMaxSetupFee = parseNonNegativeBigInt(
    input.maxSetupFeeUsdcMicros,
    "maxSetupFeeUsdcMicros"
  );
  if (
    callerMaxSetupFee !== null &&
    quote.setupFeeUsdcMicros > callerMaxSetupFee
  ) {
    throw new Error("Quoted setup fee exceeds caller max setup fee");
  }
  if (context.authorityUsdcBalance < quote.setupFeeUsdcMicros) {
    const hint =
      sponsor.mode === "kora"
        ? " Kora devnet Mock pricing can make setup fees much higher than direct Solana fees."
        : "";
    throw new Error(
      `Authority USDC balance is below the setup fee (balance ${formatUsdcMicros(
        context.authorityUsdcBalance
      )}, setup fee ${formatUsdcMicros(quote.setupFeeUsdcMicros)}).${hint}`
    );
  }

  let transaction = buildTransaction({
    context,
    blockhash: latestBlockhash.blockhash,
    setupFeeUsdcMicros: quote.setupFeeUsdcMicros,
    sponsorFeeDestination,
  });
  if (sponsor.mode === "bespoke") {
    transaction.partialSign(sponsor.keypair);
  } else {
    transaction = await signTransactionWithKora(transaction);
    if (!transaction.verifySignatures(false)) {
      throw new Error(
        "Kora-prepared sponsored registration signature is invalid"
      );
    }
  }

  return {
    transaction: transaction
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64"),
    encoding: "base64",
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    quote: {
      setupFeeUsdcMicros: quote.setupFeeUsdcMicros.toString(),
      rentLamports: context.rentLamports.toString(),
      transactionFeeLamports: transactionFeeLamports.toString(),
      capped: quote.capped,
    },
    accounts: {
      authority: context.authority.toBase58(),
      sponsor: sponsor.publicKey.toBase58(),
      agentProfile: context.agentProfile.toBase58(),
      authorityUsdcAccount: context.authorityUsdcAccount.toBase58(),
      sponsorUsdcFeeDestination: sponsorFeeDestination?.toBase58() ?? null,
    },
    debug: getSponsoredTransactionDebug(transaction, sponsor.publicKey),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

async function validateSubmittedTransaction(transaction: Transaction) {
  const sponsor = resolveSponsorSigningContext();
  if (!transaction.feePayer) {
    throw new Error(
      "Sponsored registration transaction is missing a fee payer"
    );
  }
  assertKey(transaction.feePayer, sponsor.publicKey, "fee payer");
  const instructions = getSponsoredCoreInstructions({
    transaction,
    sponsorMode: sponsor.mode,
    label: "Sponsored registration transaction",
  });
  if (instructions.length < 1 || instructions.length > 2) {
    throw new Error(
      `Sponsored registration transaction has unexpected instruction count (${instructions.length} core, ${transaction.instructions.length} total)`
    );
  }
  assertSponsoredTransactionSignatures({
    transaction,
    sponsor: sponsor.publicKey,
    sponsorMode: sponsor.mode,
    label: "Sponsored registration transaction",
  });

  const registerInstruction = instructions[0];
  if (!registerInstruction.programId.equals(PROGRAM_ID)) {
    throw new Error("First instruction must be AgentVouch register_agent");
  }
  if (registerInstruction.keys.length !== 4) {
    throw new Error("register_agent account count mismatch");
  }

  // Decode the user-chosen metadata URI, then re-encode to assert the data is a
  // well-formed register_agent payload (correct discriminator, no trailing bytes).
  let metadataUri: string;
  try {
    metadataUri = getRegisterAgentInstructionDataDecoder().decode(
      registerInstruction.data
    ).metadataUri;
  } catch {
    throw new Error("register_agent instruction data is malformed");
  }
  metadataUri = normalizeSponsoredRegisterAgentMetadataUri(metadataUri);
  if (
    !instructionDataEquals(
      registerInstruction.data,
      encodeRegisterAgentData(metadataUri)
    )
  ) {
    throw new Error("register_agent instruction data mismatch");
  }

  const authority = registerInstruction.keys[1];
  const rentPayer = registerInstruction.keys[2];
  if (!authority.isSigner || authority.isWritable) {
    throw new Error("register_agent authority must be a read-only signer");
  }
  if (
    !rentPayer.isSigner ||
    !rentPayer.isWritable ||
    !rentPayer.pubkey.equals(sponsor.publicKey)
  ) {
    throw new Error("register_agent rent payer must be the sponsor signer");
  }
  // Defense in depth: reject a self-dealt registration before re-deriving context.
  assertBuyerIsNotSponsor(authority.pubkey, sponsor.publicKey);

  const context = await resolveRegisterAgentContext({
    authorityPubkey: authority.pubkey.toBase58(),
    metadataUri,
    sponsor: sponsor.publicKey,
  });
  const expectedRegister = createRegisterAgentInstruction({
    agentProfile: context.agentProfile,
    authority: context.authority,
    rentPayer: context.sponsor,
    metadataUri: context.metadataUri,
  });
  registerInstruction.keys.forEach((key, index) => {
    const expected = expectedRegister.keys[index];
    assertKey(key.pubkey, expected.pubkey, `register account ${index}`);
    if (
      key.isSigner !== expected.isSigner ||
      key.isWritable !== expected.isWritable
    ) {
      throw new Error(`register account ${index} meta mismatch`);
    }
  });

  let setupFeeUsdcMicros = 0n;
  if (instructions.length === 2) {
    const sponsorFeeDestination = getSponsorFeeDestination(1n);
    if (!sponsorFeeDestination) {
      throw new Error("Sponsor reimbursement destination is required");
    }
    const reimbursement = instructions[1];
    setupFeeUsdcMicros = readTransferCheckedAmount(reimbursement);
    const keys = reimbursement.keys;
    if (keys.length !== 4) {
      throw new Error("Sponsor reimbursement account count mismatch");
    }
    assertKey(
      keys[0].pubkey,
      context.authorityUsdcAccount,
      "reimbursement source"
    );
    assertKey(keys[1].pubkey, context.usdcMint, "reimbursement mint");
    assertKey(
      keys[2].pubkey,
      sponsorFeeDestination,
      "reimbursement destination"
    );
    assertKey(keys[3].pubkey, context.authority, "reimbursement owner");
    if (!keys[3].isSigner) {
      throw new Error("Sponsor reimbursement owner must sign");
    }
  }
  const maxCap = getMaxSetupFeeCap();
  if (maxCap !== null && setupFeeUsdcMicros > maxCap) {
    throw new Error("Sponsor reimbursement exceeds configured cap");
  }
  if (sponsor.mode === "kora") {
    const koraQuote = await estimateKoraSetupFeeUsdcMicros({
      transaction,
      feeToken: getKoraFeeToken(context.usdcMint),
      capUsdcMicros: maxCap,
    });
    if (setupFeeUsdcMicros < koraQuote.setupFeeUsdcMicros) {
      throw new Error(
        `Sponsor reimbursement is below Kora fee quote (submitted ${formatUsdcMicros(
          setupFeeUsdcMicros
        )}, required ${formatUsdcMicros(koraQuote.setupFeeUsdcMicros)})`
      );
    }
  }
  if (context.authorityUsdcBalance < setupFeeUsdcMicros) {
    throw new Error(
      "Authority USDC balance is below submitted transaction amount"
    );
  }

  return {
    connection: context.connection,
    sponsorMode: sponsor.mode,
    setupFeeUsdcMicros,
    authorityPubkey: context.authority.toBase58(),
    agentProfile: context.agentProfile.toBase58(),
  };
}

export async function submitSponsoredRegisterAgent(
  serializedTransaction: string
): Promise<SponsoredRegisterAgentSubmitResult> {
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
      `Sponsored registration simulation failed: ${JSON.stringify(
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
    agentProfile: validation.agentProfile,
    authorityPubkey: validation.authorityPubkey,
    setupFeeUsdcMicros: validation.setupFeeUsdcMicros.toString(),
  };
}
