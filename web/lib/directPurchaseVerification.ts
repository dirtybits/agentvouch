import {
  createSolanaRpc,
  getAddressEncoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
  isAddress,
  type Address,
} from "@solana/kit";
import {
  fetchMaybePurchase,
  fetchMaybeSkillListing,
} from "../generated/agentvouch/src/generated";
import {
  AGENTVOUCH_PROTOCOL_VERSION,
  getAgentVouchChainContext,
  getAgentVouchProgramId,
} from "@/lib/protocolMetadata";
import { DEFAULT_SOLANA_RPC_URL } from "@/lib/solanaRpc";
import {
  DIRECT_PURCHASE_PAYMENT_FLOW,
  recordUsdcPurchaseReceipt,
} from "@/lib/usdcPurchases";

type RpcAccountKey = string | { pubkey?: string; signer?: boolean };
type RpcInstruction = {
  programId?: string;
  accounts?: string[];
};

type RpcParsedTransaction = {
  meta?: {
    err?: unknown;
  };
  transaction?: {
    message?: {
      accountKeys?: RpcAccountKey[];
      instructions?: RpcInstruction[];
    };
  };
};

export type DirectPurchaseSkillRow = {
  id: string;
  on_chain_address: string | null;
  author_pubkey: string;
  price_usdc_micros: string | null;
  currency_mint: string | null;
  chain_context: string | null;
  on_chain_protocol_version: string | null;
  on_chain_program_id: string | null;
};

export type DirectPurchaseVerificationResult = {
  buyerPubkey: string;
  listingAddress: string;
  purchasePda: string;
  signature: string;
  amountMicros: string;
  currencyMint: string;
  paymentFlow: typeof DIRECT_PURCHASE_PAYMENT_FLOW;
  protocolVersion: typeof AGENTVOUCH_PROTOCOL_VERSION;
  onChainProgramId: string;
  chainContext: string;
  listingRevision: string;
  settlementPda: string;
  authorProceedsVault: string;
};

type VerifyDirectPurchaseInput = {
  skill: DirectPurchaseSkillRow;
  signature: string;
  buyerPubkey?: string | null;
  listingAddress?: string | null;
};

function getAccountKeyValue(key: RpcAccountKey): string {
  return typeof key === "string" ? key : key.pubkey ?? "";
}

function extractAccountKeys(transaction: RpcParsedTransaction): string[] {
  return (
    transaction.transaction?.message?.accountKeys
      ?.map(getAccountKeyValue)
      .filter(Boolean) ?? []
  );
}

function extractSignerKeys(transaction: RpcParsedTransaction): string[] {
  return (
    transaction.transaction?.message?.accountKeys
      ?.filter((key) => typeof key !== "string" && key.signer)
      .map(getAccountKeyValue)
      .filter(Boolean) ?? []
  );
}

function instructionReferencesProgram(
  transaction: RpcParsedTransaction,
  programId: string
): boolean {
  return (
    transaction.transaction?.message?.instructions?.some(
      (instruction) => instruction.programId === programId
    ) ?? false
  );
}

async function getConfirmedParsedTransaction(
  signature: string
): Promise<RpcParsedTransaction | null> {
  const response = await fetch(DEFAULT_SOLANA_RPC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `agentvouch-direct-${signature}`,
      method: "getTransaction",
      params: [
        signature,
        {
          commitment: "confirmed",
          encoding: "jsonParsed",
          maxSupportedTransactionVersion: 0,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC getTransaction failed with status ${response.status}`);
  }

  const json = (await response.json()) as {
    result?: RpcParsedTransaction | null;
    error?: { message?: string };
  };

  if (json.error) {
    throw new Error(json.error.message || "RPC getTransaction failed");
  }

  return json.result ?? null;
}

function requireAddress(value: string, label: string): Address {
  if (!isAddress(value)) {
    throw new Error(`${label} is not a valid Solana address`);
  }
  return value as Address;
}

async function derivePurchasePda(
  buyer: Address,
  skillListing: Address,
  revision: bigint
): Promise<Address> {
  const addressEncoder = getAddressEncoder();
  const utf8Encoder = getUtf8Encoder();
  const revisionBytes = new Uint8Array(8);
  new DataView(revisionBytes.buffer).setBigUint64(0, revision, true);
  const [purchasePda] = await getProgramDerivedAddress({
    programAddress: getAgentVouchProgramId() as Address,
    seeds: [
      utf8Encoder.encode("purchase"),
      addressEncoder.encode(buyer),
      addressEncoder.encode(skillListing),
      revisionBytes,
    ],
  });
  return purchasePda;
}

export async function verifyDirectPurchase(
  input: VerifyDirectPurchaseInput
): Promise<DirectPurchaseVerificationResult> {
  const signature = input.signature.trim();
  if (!signature) {
    throw new Error("Missing transaction signature");
  }

  const listingAddress = input.listingAddress ?? input.skill.on_chain_address;
  if (!listingAddress || listingAddress !== input.skill.on_chain_address) {
    throw new Error("Transaction listing does not match this skill");
  }
  const listingKey = requireAddress(listingAddress, "Skill listing");

  const expectedProgramId =
    input.skill.on_chain_program_id ?? getAgentVouchProgramId();
  if (expectedProgramId !== getAgentVouchProgramId()) {
    throw new Error("Skill is linked to an unsupported on-chain program");
  }

  const expectedChainContext =
    input.skill.chain_context ?? getAgentVouchChainContext();
  if (expectedChainContext !== getAgentVouchChainContext()) {
    throw new Error("Skill is linked to a different chain context");
  }

  if (
    input.skill.on_chain_protocol_version &&
    input.skill.on_chain_protocol_version !== AGENTVOUCH_PROTOCOL_VERSION
  ) {
    throw new Error("Skill is linked to an unsupported protocol version");
  }

  if (!input.skill.price_usdc_micros || !input.skill.currency_mint) {
    throw new Error("Skill is missing USDC protocol price metadata");
  }
  const expectedPrice = BigInt(input.skill.price_usdc_micros);
  if (expectedPrice <= 0n) {
    throw new Error("Skill is not a paid USDC protocol listing");
  }

  const transaction = await getConfirmedParsedTransaction(signature);
  if (!transaction?.meta || !transaction.transaction?.message) {
    throw new Error("Transaction was not found on the configured RPC");
  }
  if (transaction.meta.err) {
    throw new Error("Transaction failed on-chain");
  }

  const accountKeys = extractAccountKeys(transaction);
  if (!accountKeys.includes(expectedProgramId)) {
    throw new Error("Transaction does not reference the AgentVouch program");
  }
  if (!instructionReferencesProgram(transaction, expectedProgramId)) {
    throw new Error("Transaction did not execute the AgentVouch program");
  }
  if (!accountKeys.includes(listingAddress)) {
    throw new Error("Transaction does not reference this skill listing");
  }

  const inferredBuyer = input.buyerPubkey ?? extractSignerKeys(transaction)[0];
  if (!inferredBuyer) {
    throw new Error("Buyer wallet was not provided and could not be inferred");
  }
  const buyerKey = requireAddress(inferredBuyer, "Buyer");

  if (!accountKeys.includes(inferredBuyer)) {
    throw new Error("Transaction does not reference the buyer wallet");
  }

  const rpc = createSolanaRpc(DEFAULT_SOLANA_RPC_URL);
  const listingAccount = await fetchMaybeSkillListing(rpc, listingKey);
  if (!listingAccount.exists) {
    throw new Error("Skill listing account was not found on-chain");
  }
  const purchasePda = await derivePurchasePda(
    buyerKey,
    listingKey,
    listingAccount.data.currentRevision
  );
  const purchasePdaString = purchasePda.toString();

  if (!accountKeys.includes(purchasePdaString)) {
    throw new Error("Transaction does not reference the expected purchase PDA");
  }

  const purchaseAccount = await fetchMaybePurchase(rpc, purchasePda);

  if (!purchaseAccount.exists) {
    throw new Error("Purchase account was not found on-chain");
  }

  if (listingAccount.data.author !== (input.skill.author_pubkey as Address)) {
    throw new Error("On-chain listing author does not match this skill");
  }
  if (listingAccount.data.priceUsdcMicros !== expectedPrice) {
    throw new Error("On-chain listing price does not match this skill");
  }
  if (purchaseAccount.data.buyer !== buyerKey) {
    throw new Error("Purchase buyer does not match the submitted wallet");
  }
  if (purchaseAccount.data.skillListing !== listingKey) {
    throw new Error("Purchase listing does not match this skill");
  }
  if (
    purchaseAccount.data.listingRevision !== listingAccount.data.currentRevision
  ) {
    throw new Error("Purchase listing revision does not match this skill");
  }
  if (purchaseAccount.data.pricePaidUsdcMicros !== expectedPrice) {
    throw new Error("Purchase price does not match this skill");
  }
  if (
    purchaseAccount.data.usdcMint !== (input.skill.currency_mint as Address)
  ) {
    throw new Error("Purchase USDC mint does not match this skill");
  }

  return {
    buyerPubkey: inferredBuyer,
    listingAddress,
    purchasePda: purchasePdaString,
    signature,
    amountMicros: purchaseAccount.data.pricePaidUsdcMicros.toString(),
    currencyMint: input.skill.currency_mint,
    paymentFlow: DIRECT_PURCHASE_PAYMENT_FLOW,
    protocolVersion: AGENTVOUCH_PROTOCOL_VERSION,
    onChainProgramId: expectedProgramId,
    chainContext: expectedChainContext,
    listingRevision: purchaseAccount.data.listingRevision.toString(),
    settlementPda: purchaseAccount.data.listingSettlement.toString(),
    authorProceedsVault:
      listingAccount.data.currentAuthorProceedsVault.toString(),
  };
}

export async function verifyAndRecordDirectPurchase(
  input: VerifyDirectPurchaseInput
): Promise<DirectPurchaseVerificationResult> {
  const verification = await verifyDirectPurchase(input);

  await recordUsdcPurchaseReceipt({
    skillDbId: input.skill.id,
    buyerPubkey: verification.buyerPubkey,
    paymentTxSignature: verification.signature,
    recipientAta: verification.authorProceedsVault,
    currencyMint: verification.currencyMint,
    amountMicros: verification.amountMicros,
    paymentFlow: DIRECT_PURCHASE_PAYMENT_FLOW,
    protocolVersion: AGENTVOUCH_PROTOCOL_VERSION,
    onChainProgramId: verification.onChainProgramId,
    chainContext: verification.chainContext,
    onChainAddress: verification.listingAddress,
    purchasePda: verification.purchasePda,
    listingRevision: verification.listingRevision,
    settlementPda: verification.settlementPda,
    authorProceedsVault: verification.authorProceedsVault,
    refundStatus: "none",
    legacyRefundEligible: false,
  });

  console.info(
    `[purchase-verify] recorded direct purchase entitlement: skill=${input.skill.id} listing=${verification.listingAddress} buyer=${verification.buyerPubkey} tx=${verification.signature}`
  );

  return verification;
}
