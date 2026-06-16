import { createHash, randomBytes } from "crypto";
import { address, createSolanaRpc, type Address } from "@solana/kit";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { fetchMaybeReputationConfig } from "@/generated/agentvouch/src/generated/accounts/reputationConfig";
import { fetchMaybeX402SettlementReceipt } from "@/generated/agentvouch/src/generated/accounts/x402SettlementReceipt";
import { getSettleX402PurchaseInstructionDataEncoder } from "@/generated/agentvouch/src/generated/instructions/settleX402Purchase";
import { AGENTVOUCH_PROGRAM_ADDRESS } from "@/generated/agentvouch/src/generated/programs";
import { fetchOnChainSkillListing } from "@/lib/onchain";
import {
  AGENTVOUCH_PROTOCOL_VERSION,
  getAgentVouchChainContext,
  getAgentVouchProgramId,
} from "@/lib/protocolMetadata";
import { DEFAULT_SOLANA_RPC_URL } from "@/lib/solanaRpc";
import {
  generateX402UsdcRequirement,
  type X402PaymentPayload,
  type X402PaymentRequirements,
} from "@/lib/x402";

export const X402_BRIDGE_PURCHASE_PAYMENT_FLOW = "x402-bridge-purchase-skill";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
const PROGRAM_ID = new PublicKey(AGENTVOUCH_PROGRAM_ADDRESS);
const MAX_MEMO_BYTES = 256;

export type ProtocolX402BridgeRequirement = {
  requirement: X402PaymentRequirements;
  memo: string;
  nonce: string;
  paymentRefHashBytes: Uint8Array;
  paymentRefHashHex: string;
  x402SettlementVaultAuthority: string;
};

export type ProtocolX402SettlementResult = {
  programSettlementSignature: string | null;
  purchasePda: string;
  listingRevision: string;
  listingSettlementPda: string;
  authorProceedsVault: string;
  x402SettlementReceiptPda: string;
  x402SettlementVault: string;
  x402SettlementSignatureHashHex: string;
};

export function createProtocolX402BridgeNonce(): string {
  return randomBytes(8).toString("hex");
}

function hashBytes(value: string): Uint8Array {
  return createHash("sha256").update(value).digest();
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function u64Le(value: bigint | number | string): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function pda(...seeds: Array<string | Buffer | Uint8Array>): PublicKey {
  return PublicKey.findProgramAddressSync(
    seeds.map((seed) => (typeof seed === "string" ? Buffer.from(seed) : seed)),
    PROGRAM_ID
  )[0];
}

function deriveAta(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

function buildPaymentRef(input: {
  network: string;
  programId: string;
  skillDbId: string;
  skillListingAddress: string;
  buyerPubkey: string;
  amountUsdcMicros: bigint;
  usdcMint: string;
  nonce: string;
}) {
  return [
    "agentvouch-x402-bridge-v1",
    input.network,
    input.programId,
    input.skillListingAddress,
    input.skillDbId,
    input.buyerPubkey,
    input.amountUsdcMicros.toString(),
    input.usdcMint,
    input.nonce,
  ].join("|");
}

function buildBridgeMemo(input: { paymentRefHashHex: string }) {
  const memo = input.paymentRefHashHex.slice(0, 32);

  if (new TextEncoder().encode(memo).byteLength > MAX_MEMO_BYTES) {
    throw new Error("x402 bridge memo exceeds the SVM memo byte limit");
  }

  return memo;
}

export function extractProtocolX402BridgeNonce(
  payload: X402PaymentPayload
): string | null {
  const nonce = payload.accepted?.extra?.agentvouch_nonce;
  return typeof nonce === "string" && nonce.length > 0 ? nonce : null;
}

export async function buildProtocolX402BridgeRequirement(input: {
  skillDbId: string;
  skillListingAddress: string;
  buyerPubkey: string;
  priceUsdcMicros: bigint;
  usdcMint: string;
  nonce: string;
}): Promise<ProtocolX402BridgeRequirement> {
  const programId = getAgentVouchProgramId();
  const chainContext = getAgentVouchChainContext();
  const x402SettlementVaultAuthority = pda(
    "x402_settlement_vault_authority"
  ).toBase58();
  const paymentRef = buildPaymentRef({
    network: chainContext,
    programId,
    skillDbId: input.skillDbId,
    skillListingAddress: input.skillListingAddress,
    buyerPubkey: input.buyerPubkey,
    amountUsdcMicros: input.priceUsdcMicros,
    usdcMint: input.usdcMint,
    nonce: input.nonce,
  });
  const paymentRefHashBytes = hashBytes(paymentRef);
  const paymentRefHashHex = hex(paymentRefHashBytes);
  const memo = buildBridgeMemo({ paymentRefHashHex });
  const requirement = await generateX402UsdcRequirement({
    priceUsdcMicros: input.priceUsdcMicros,
    payTo: x402SettlementVaultAuthority,
    usdcMint: input.usdcMint,
    extra: {
      memo,
      agentvouch_payment_flow: X402_BRIDGE_PURCHASE_PAYMENT_FLOW,
      agentvouch_protocol_version: AGENTVOUCH_PROTOCOL_VERSION,
      agentvouch_chain_context: chainContext,
      agentvouch_program_id: programId,
      agentvouch_skill_db_id: input.skillDbId,
      agentvouch_listing: input.skillListingAddress,
      agentvouch_buyer: input.buyerPubkey,
      agentvouch_nonce: input.nonce,
      agentvouch_payment_ref_hash: paymentRefHashHex,
    },
  });

  return {
    requirement,
    memo,
    nonce: input.nonce,
    paymentRefHashBytes,
    paymentRefHashHex,
    x402SettlementVaultAuthority,
  };
}

export function validateProtocolX402PaymentPayload(
  payload: X402PaymentPayload,
  bridge: ProtocolX402BridgeRequirement
): string | null {
  const accepted = payload.accepted;
  const expected = bridge.requirement;
  if (payload.x402Version !== 2) return "Unsupported x402 version";
  if (accepted.scheme !== expected.scheme) return "x402 scheme mismatch";
  if (accepted.network !== expected.network) return "x402 network mismatch";
  if (accepted.amount !== expected.amount) return "x402 amount mismatch";
  if (accepted.asset !== expected.asset) return "x402 asset mismatch";
  if (accepted.payTo !== expected.payTo) return "x402 payTo mismatch";

  const keys = [
    "feePayer",
    "memo",
    "agentvouch_payment_flow",
    "agentvouch_protocol_version",
    "agentvouch_chain_context",
    "agentvouch_program_id",
    "agentvouch_skill_db_id",
    "agentvouch_listing",
    "agentvouch_buyer",
    "agentvouch_nonce",
    "agentvouch_payment_ref_hash",
  ];
  for (const key of keys) {
    if (accepted.extra?.[key] !== expected.extra?.[key]) {
      return `x402 extra.${key} mismatch`;
    }
  }

  return null;
}

function loadSettlementAuthority(): Keypair {
  const raw = process.env.AGENTVOUCH_X402_SETTLEMENT_AUTHORITY_SECRET_KEY;
  if (!raw) {
    throw new Error(
      "AGENTVOUCH_X402_SETTLEMENT_AUTHORITY_SECRET_KEY is not set"
    );
  }

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
      "AGENTVOUCH_X402_SETTLEMENT_AUTHORITY_SECRET_KEY must be a JSON byte array, comma-delimited byte list, base64:<raw-secret>, or base64:<json-secret>"
    );
  }

  if (
    bytes.length !== 64 ||
    bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
  ) {
    throw new Error("Settlement authority secret key must contain 64 bytes");
  }

  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

async function existingSettlementResult(input: {
  paymentRefHashBytes: Uint8Array;
  settlementTxSignatureHashBytes: Uint8Array;
  buyerPubkey: string;
  skillListingAddress: string;
  amountUsdcMicros: bigint;
  x402SettlementReceiptPda: PublicKey;
  x402SettlementVault: string;
}): Promise<ProtocolX402SettlementResult | null> {
  const rpc = createSolanaRpc(DEFAULT_SOLANA_RPC_URL);
  const receipt = await fetchMaybeX402SettlementReceipt(
    rpc,
    address(input.x402SettlementReceiptPda.toBase58())
  );
  if (!receipt.exists) return null;

  if (
    hex(new Uint8Array(receipt.data.paymentRefHash)) !==
      hex(input.paymentRefHashBytes) ||
    hex(new Uint8Array(receipt.data.settlementTxSignatureHash)) !==
      hex(input.settlementTxSignatureHashBytes) ||
    receipt.data.buyer !== (input.buyerPubkey as Address) ||
    receipt.data.skillListing !== (input.skillListingAddress as Address) ||
    receipt.data.amountUsdcMicros !== input.amountUsdcMicros
  ) {
    throw new Error("Existing x402 settlement receipt does not match request");
  }

  return {
    programSettlementSignature: null,
    purchasePda: receipt.data.purchase.toString(),
    listingRevision: receipt.data.listingRevision.toString(),
    listingSettlementPda: receipt.data.listingSettlement.toString(),
    authorProceedsVault: "",
    x402SettlementReceiptPda: input.x402SettlementReceiptPda.toBase58(),
    x402SettlementVault: input.x402SettlementVault,
    x402SettlementSignatureHashHex: hex(input.settlementTxSignatureHashBytes),
  };
}

export async function settleProtocolX402Purchase(input: {
  skillDbId: string;
  skillListingAddress: string;
  authorPubkey: string;
  buyerPubkey: string;
  amountUsdcMicros: bigint;
  usdcMint: string;
  paymentRefHashBytes: Uint8Array;
  settlementTxSignature: string;
}): Promise<ProtocolX402SettlementResult> {
  const settlementAuthority = loadSettlementAuthority();
  const connection = new Connection(DEFAULT_SOLANA_RPC_URL, "confirmed");
  const rpc = createSolanaRpc(DEFAULT_SOLANA_RPC_URL);
  const configPda = pda("config");
  const configAccount = await fetchMaybeReputationConfig(
    rpc,
    address(configPda.toBase58())
  );
  if (!configAccount.exists) {
    throw new Error("AgentVouch config account was not found");
  }
  if (
    configAccount.data.settlementAuthority !==
    (settlementAuthority.publicKey.toBase58() as Address)
  ) {
    throw new Error(
      "Configured settlement authority does not match backend key"
    );
  }

  const listing = await fetchOnChainSkillListing(input.skillListingAddress, {
    useCache: false,
  });
  if (!listing) {
    throw new Error("Skill listing account was not found on-chain");
  }
  if (listing.data.author !== (input.authorPubkey as Address)) {
    throw new Error("On-chain listing author does not match repo skill");
  }
  if (listing.data.priceUsdcMicros !== input.amountUsdcMicros) {
    throw new Error("On-chain listing price does not match x402 amount");
  }
  if (configAccount.data.usdcMint !== (input.usdcMint as Address)) {
    throw new Error("Configured USDC mint does not match x402 asset");
  }
  if (configAccount.data.paused) {
    throw new Error("AgentVouch protocol is paused");
  }

  const skillListing = new PublicKey(input.skillListingAddress);
  const buyer = new PublicKey(input.buyerPubkey);
  const author = new PublicKey(input.authorPubkey);
  const usdcMint = new PublicKey(input.usdcMint);
  const currentRevision = listing.data.currentRevision;
  const listingSettlement = new PublicKey(
    listing.data.currentSettlement.toString()
  );
  const authorProceedsVault = new PublicKey(
    listing.data.currentAuthorProceedsVault.toString()
  );
  const authorProfile = pda("agent", author.toBuffer());
  const purchase = pda(
    "purchase",
    buyer.toBuffer(),
    skillListing.toBuffer(),
    u64Le(currentRevision)
  );
  const x402SettlementVaultAuthority = pda("x402_settlement_vault_authority");
  const x402SettlementVault = deriveAta(x402SettlementVaultAuthority, usdcMint);
  if (
    x402SettlementVault.toBase58() !==
    configAccount.data.x402SettlementVault.toString()
  ) {
    throw new Error(
      "Configured x402 settlement vault does not match authority ATA"
    );
  }
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
  const x402SettlementReceipt = pda(
    "x402_settlement_receipt",
    input.paymentRefHashBytes
  );
  const settlementTxSignatureHashBytes = hashBytes(input.settlementTxSignature);
  const x402SettlementSignatureGuard = pda(
    "x402_settlement_signature",
    settlementTxSignatureHashBytes
  );

  const existing = await existingSettlementResult({
    paymentRefHashBytes: input.paymentRefHashBytes,
    settlementTxSignatureHashBytes,
    buyerPubkey: input.buyerPubkey,
    skillListingAddress: input.skillListingAddress,
    amountUsdcMicros: input.amountUsdcMicros,
    x402SettlementReceiptPda: x402SettlementReceipt,
    x402SettlementVault: x402SettlementVault.toBase58(),
  });
  if (existing) {
    return {
      ...existing,
      authorProceedsVault: authorProceedsVault.toBase58(),
    };
  }

  const instructionData = getSettleX402PurchaseInstructionDataEncoder().encode({
    paymentRefHash: input.paymentRefHashBytes,
    settlementTxSignatureHash: settlementTxSignatureHashBytes,
    buyer: input.buyerPubkey as Address,
    amountUsdcMicros: input.amountUsdcMicros,
  });
  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: skillListing, isSigner: false, isWritable: true },
      { pubkey: purchase, isSigner: false, isWritable: true },
      { pubkey: author, isSigner: false, isWritable: false },
      { pubkey: authorProfile, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      {
        pubkey: x402SettlementVaultAuthority,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: x402SettlementVault, isSigner: false, isWritable: true },
      { pubkey: listingSettlement, isSigner: false, isWritable: true },
      {
        pubkey: authorProceedsVaultAuthority,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: authorProceedsVault, isSigner: false, isWritable: true },
      {
        pubkey: authorRewardVaultAuthority,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: authorRewardVault, isSigner: false, isWritable: true },
      { pubkey: x402SettlementReceipt, isSigner: false, isWritable: true },
      {
        pubkey: x402SettlementSignatureGuard,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: settlementAuthority.publicKey,
        isSigner: true,
        isWritable: true,
      },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(instructionData),
  });

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction().add(instruction);
  transaction.feePayer = settlementAuthority.publicKey;
  transaction.recentBlockhash = latestBlockhash.blockhash;
  transaction.sign(settlementAuthority);

  const simulation = await connection.simulateTransaction(transaction);
  if (simulation.value.err) {
    throw new Error(
      `settle_x402_purchase simulation failed: ${JSON.stringify(
        simulation.value.err
      )}${
        simulation.value.logs
          ? ` logs=${simulation.value.logs.join(" | ")}`
          : ""
      }`
    );
  }

  const programSettlementSignature = await connection.sendRawTransaction(
    transaction.serialize(),
    { skipPreflight: false }
  );
  const confirmation = await connection.confirmTransaction(
    {
      signature: programSettlementSignature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    },
    "confirmed"
  );
  if (confirmation.value.err) {
    throw new Error(
      `settle_x402_purchase failed: ${JSON.stringify(confirmation.value.err)}`
    );
  }

  return {
    programSettlementSignature,
    purchasePda: purchase.toBase58(),
    listingRevision: currentRevision.toString(),
    listingSettlementPda: listingSettlement.toBase58(),
    authorProceedsVault: authorProceedsVault.toBase58(),
    x402SettlementReceiptPda: x402SettlementReceipt.toBase58(),
    x402SettlementVault: x402SettlementVault.toBase58(),
    x402SettlementSignatureHashHex: hex(settlementTxSignatureHashBytes),
  };
}
