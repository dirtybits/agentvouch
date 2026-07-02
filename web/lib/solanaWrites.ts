// Shared Solana write helpers (Phase 2 circle-back).
//
// This module is the single implementation of the Solana register/list/purchase write paths.
// It was lifted verbatim from useReputationOracle/useMarketplaceOracle (which previously held
// near-identical duplicated copies) so the legacy hooks and the Solana ChainWallet facade
// (web/lib/adapters/solanaWallet.ts) cannot drift. Client-oriented: it signs and sends with a
// connected wallet's TransactionSigner — do not import from server routes.
//
// The one deliberate behavioral parameter is USDC mint resolution: useReputationOracle
// historically resolved the mint from the on-chain protocol config (getProtocolUsdcMint),
// while useMarketplaceOracle used the configured env mint. `resolveUsdcMint` preserves each
// caller's behavior; the default is the protocol-config path.

import {
  address,
  createSolanaRpc,
  fetchEncodedAccount,
  getAddressEncoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
  isAddress,
  signature,
  type Address,
  type AccountMeta,
  type Instruction,
  type ReadonlyUint8Array,
  type TransactionSigner,
} from "@solana/kit";
import { type TransactionPrepareAndSendRequest } from "@solana/client";
import {
  fetchMaybeAgentProfile,
  fetchMaybePurchase,
  fetchMaybeReputationConfig,
  fetchMaybeSkillListing,
  getRegisterAgentInstructionAsync,
  getCreateSkillListingInstructionAsync,
  getPurchaseSkillInstructionAsync,
} from "@/generated/agentvouch/src/generated";
import { AGENTVOUCH_PROGRAM_ADDRESS } from "@/generated/agentvouch/src/generated/programs";
import {
  getConfiguredSolanaChainDisplayLabel,
  getConfiguredSolanaRpcTargetLabel,
} from "@/lib/chains";
import {
  assessPurchasePreflight,
  createPurchasePreflightContext,
  type PurchasePreflightAssessment,
} from "@/lib/purchasePreflight";
import { getErrorMessage } from "@/lib/errors";
import { getConfiguredUsdcMint } from "@/lib/x402";
import {
  confirmDirectPurchaseAfterSponsoredUnavailable,
  runSponsoredCheckout,
  runSponsoredRegisterAgent,
  sponsoredCheckoutPubliclyEnabled,
  type ConnectorTransactionSigner,
} from "@/lib/sponsoredPurchaseClient";
import {
  assertUsdcAccountReady,
  formatUsdcMicrosValue,
  getAssociatedTokenAccount,
  logTransactionSummary,
  type AgentVouchTransactionSummary,
} from "@/lib/agentvouchUsdc";
import { getClientTransactionHelper } from "@/lib/solanaTransactionHelper";

const ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
export const rpc = createSolanaRpc(ENDPOINT);
const SIGNATURE_CONFIRMATION_TIMEOUT_MS = 45_000;
const SIGNATURE_CONFIRMATION_POLL_MS = 1_000;
const AGENT_PROFILE_ACCOUNT_SPACE = 390;
const REGISTRATION_FEE_BUFFER_LAMPORTS = 10_000n;

const textEncoder = getUtf8Encoder();
const addressEncoder = getAddressEncoder();

// The connected wallet's signing session, as exposed by useAgentVouchTransactionSigner.
// `connectorSigner`/`canSignSponsored` gate the gasless sponsored-checkout path.
export type SolanaWriteSession = {
  signer: TransactionSigner;
  walletAddress: Address;
  connectorSigner: ConnectorTransactionSigner | null;
  canSignSponsored: boolean;
};

type SendInstructionAccount = {
  address: Address;
  role: number;
  signer?: TransactionSigner;
};

export type SendInstruction = Instruction<string, readonly AccountMeta[]> & {
  data?: ReadonlyUint8Array;
  accounts: readonly SendInstructionAccount[];
};

export function normalizeInstructionForSend(
  ix: SendInstruction
): SendInstruction {
  return {
    programAddress: ix.programAddress,
    data: ix.data,
    accounts: ix.accounts.map((acc) => ({
      address: acc.address,
      role: acc.role,
      ...("signer" in acc && acc.signer ? { signer: acc.signer } : {}),
    })),
  } as SendInstruction;
}

export function buildTransactionSendRequest(
  ix: SendInstruction | readonly SendInstruction[],
  authority: TransactionSigner
): TransactionPrepareAndSendRequest {
  const instructions = Array.isArray(ix) ? ix : [ix];
  return {
    instructions: instructions.map(normalizeInstructionForSend),
    authority,
  };
}

export type ClusterGuardContext = {
  configuredChainLabel?: string;
  configuredRpcTarget?: string;
};

type RegisterAgentClusterGuardAssessment = ClusterGuardContext & {
  walletAddress: Address;
  programExists: boolean;
  profileExists: boolean;
  walletBalanceLamports: bigint | null;
  requiredLamports: bigint | null;
};

type SkillListingClusterGuardAssessment = ClusterGuardContext & {
  mode: "create" | "update";
  authorProfileExists: boolean;
  listingExists: boolean;
  skillId: string;
};

export function getConfiguredNetworkDescription(
  context: ClusterGuardContext = {}
) {
  const configuredChainLabel =
    context.configuredChainLabel ?? getConfiguredSolanaChainDisplayLabel();
  const configuredRpcTarget =
    context.configuredRpcTarget ?? getConfiguredSolanaRpcTargetLabel();
  return `${configuredChainLabel} (${configuredRpcTarget} RPC)`;
}

export function getRegisterAgentClusterGuardError(
  assessment: RegisterAgentClusterGuardAssessment
): string | null {
  const configuredNetwork = getConfiguredNetworkDescription(assessment);
  if (!assessment.programExists) {
    return `AgentVouch program ${shortAddress(
      AGENTVOUCH_PROGRAM_ADDRESS
    )} is not deployed on the configured ${configuredNetwork}. Deploy the v0.2.0 program on this cluster before registering.`;
  }
  if (assessment.profileExists) {
    return `Author profile already exists on the configured ${configuredNetwork}. If you meant to work on another network, switch Phantom and the app to the same cluster and retry.`;
  }
  if (
    assessment.walletBalanceLamports !== null &&
    assessment.requiredLamports !== null &&
    assessment.walletBalanceLamports < assessment.requiredLamports
  ) {
    return `Connected wallet ${shortAddress(
      assessment.walletAddress
    )} has ${formatLamportsAsSol(
      assessment.walletBalanceLamports
    )} SOL on the configured ${configuredNetwork}. Registering needs about ${formatLamportsAsSol(
      assessment.requiredLamports
    )} SOL for account rent and network fees. Fund the wallet on this cluster and retry.`;
  }
  return null;
}

export function getSkillListingClusterGuardError(
  assessment: SkillListingClusterGuardAssessment
): string | null {
  const configuredNetwork = getConfiguredNetworkDescription(assessment);

  if (!assessment.authorProfileExists) {
    return `You are not registered on the configured ${configuredNetwork}. Register on this network first, or switch Phantom and the app to the same cluster and retry.`;
  }

  if (assessment.mode === "create" && assessment.listingExists) {
    return `Skill listing "${assessment.skillId}" already exists on the configured ${configuredNetwork}. If you meant to edit an existing listing on another network, switch Phantom and the app to the same cluster and retry.`;
  }

  if (assessment.mode === "update" && !assessment.listingExists) {
    return `Skill listing "${assessment.skillId}" was not found on the configured ${configuredNetwork}. If you created it on another network, switch Phantom and the app to the same cluster and retry.`;
  }

  return null;
}

export class ClusterGuardError extends Error {}

export function encodeU64LE(value: number | bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return bytes;
}

export async function deriveAddress(
  seeds: (string | Address | Uint8Array)[],
  programId: Address = AGENTVOUCH_PROGRAM_ADDRESS
): Promise<Address> {
  const encodedSeeds = seeds.map((s) =>
    s instanceof Uint8Array
      ? s
      : isAddress(s)
      ? addressEncoder.encode(s)
      : textEncoder.encode(s)
  );
  const [derived] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: encodedSeeds,
  });
  return derived;
}

export async function getAgentPDA(agentKey: Address): Promise<Address> {
  return deriveAddress(["agent", agentKey]);
}

export async function getAuthorBondPDA(authorKey: Address): Promise<Address> {
  return deriveAddress(["author_bond", authorKey]);
}

export async function getConfigPDA(): Promise<Address> {
  return deriveAddress(["config"]);
}

export async function getSkillListingPDA(
  author: Address,
  skillId: string
): Promise<Address> {
  const encodedSeeds = [
    textEncoder.encode("skill"),
    addressEncoder.encode(author),
    textEncoder.encode(skillId),
  ];
  const [derived] = await getProgramDerivedAddress({
    programAddress: AGENTVOUCH_PROGRAM_ADDRESS,
    seeds: encodedSeeds,
  });
  return derived;
}

export async function getPurchasePDA(
  buyer: Address,
  skillListing: Address,
  revision: number | bigint = 0n
): Promise<Address> {
  return deriveAddress([
    "purchase",
    buyer,
    skillListing,
    encodeU64LE(revision),
  ]);
}

export async function getAuthorRewardVaultAuthorityPDA(
  authorProfile: Address
): Promise<Address> {
  return deriveAddress(["author_reward_vault_authority", authorProfile]);
}

export async function getAuthorRewardVaultPDA(
  authorProfile: Address
): Promise<Address> {
  return deriveAddress(["author_reward_vault", authorProfile]);
}

export async function getListingSettlementPDA(
  skillListing: Address,
  revision: number | bigint = 0n
): Promise<Address> {
  return deriveAddress([
    "listing_settlement",
    skillListing,
    encodeU64LE(revision),
  ]);
}

export async function getAuthorProceedsVaultAuthorityPDA(
  listingSettlement: Address
): Promise<Address> {
  return deriveAddress(["author_proceeds_vault_authority", listingSettlement]);
}

export async function getAuthorProceedsVaultPDA(
  listingSettlement: Address
): Promise<Address> {
  return deriveAddress(["author_proceeds_vault", listingSettlement]);
}

export async function getProtocolConfig() {
  const config = await getConfigPDA();
  const maybeConfig = await fetchMaybeReputationConfig(rpc, config).catch(
    () => null
  );
  return {
    config,
    data: maybeConfig?.exists ? maybeConfig.data : null,
  };
}

export async function getProtocolUsdcMint(): Promise<Address> {
  const protocolConfig = await getProtocolConfig();
  return protocolConfig.data?.usdcMint ?? address(getConfiguredUsdcMint());
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function shortAddress(value: string) {
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function getConnectedAuthorAddress(
  walletAddress: Address | null,
  signer: Pick<TransactionSigner, "address"> | null
): Address {
  if (!signer || !walletAddress) throw new Error("Wallet not connected");
  if (signer.address !== walletAddress) {
    throw new Error(
      `Connected wallet ${shortAddress(
        walletAddress
      )} does not match transaction signer ${shortAddress(
        signer.address
      )}. Reconnect your wallet and retry.`
    );
  }
  return signer.address;
}

export async function resolveSkillListingAccounts(
  authorAddress: Address,
  skillId: string
) {
  const [authorProfile, authorBond, config, skillListing] = await Promise.all([
    getAgentPDA(authorAddress),
    getAuthorBondPDA(authorAddress),
    getConfigPDA(),
    getSkillListingPDA(authorAddress, skillId),
  ]);
  return { authorProfile, authorBond, config, skillListing };
}

export function formatLamportsAsSol(lamports: bigint) {
  const sol = Number(lamports) / 1_000_000_000;
  const decimals = sol >= 1 ? 4 : 6;
  return sol.toFixed(decimals).replace(/\.?0+$/, "");
}

export function coerceLamports(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (
    value &&
    typeof value === "object" &&
    "value" in value &&
    (value as { value?: unknown }).value !== undefined
  ) {
    return coerceLamports((value as { value: unknown }).value);
  }
  throw new Error("Unexpected lamports response from RPC");
}

export async function getWalletBalanceLamports(
  walletAddress: Address
): Promise<bigint> {
  const response = await rpc.getBalance(walletAddress).send();
  return coerceLamports(response.value);
}

export async function estimatePurchasePreflight(
  buyer: Address,
  skillListing: Address,
  author: Address,
  resolveUsdcMint: () => Promise<Address> = getProtocolUsdcMint
): Promise<PurchasePreflightAssessment> {
  const listing = await fetchMaybeSkillListing(rpc, skillListing);
  if (!listing.exists) throw new Error("Skill listing not found on-chain");
  const usdcMint = await resolveUsdcMint();
  const authorProfile = await getAgentPDA(author);
  const maybeAuthorProfile = await fetchMaybeAgentProfile(
    rpc,
    authorProfile
  ).catch(() => null);
  const context = await createPurchasePreflightContext({
    rpc,
    buyer,
    usdcMint,
    authors: [author],
  });
  return assessPurchasePreflight({
    context,
    priceUsdcMicros: BigInt(listing.data.priceUsdcMicros),
    author,
    authorBackingUsdcMicros: maybeAuthorProfile?.exists
      ? BigInt(maybeAuthorProfile.data.totalVouchStakeUsdcMicros) +
        BigInt(maybeAuthorProfile.data.authorBondUsdcMicros)
      : 0n,
  });
}

export function buildPurchaseBalanceError(
  walletAddress: Address,
  estimate: PurchasePreflightAssessment
) {
  const configuredNetwork = getConfiguredNetworkDescription();
  return `Connected wallet ${shortAddress(
    walletAddress
  )} has ${formatUsdcMicrosValue(
    estimate.buyerUsdcBalanceMicros ?? 0n
  )} USDC on the configured ${configuredNetwork}. Buying this skill needs ${formatUsdcMicrosValue(
    estimate.creatorPriceUsdcMicros
  )} USDC plus SOL for receipt rent and network fees.`;
}

export function buildPurchaseClusterMismatchError(
  walletAddress: Address,
  estimate: PurchasePreflightAssessment
) {
  const configuredNetwork = getConfiguredNetworkDescription();
  return `Phantom reported insufficient SOL, but connected wallet ${shortAddress(
    walletAddress
  )} has ${formatLamportsAsSol(
    estimate.buyerBalanceLamports ?? 0n
  )} SOL for fees on the configured ${configuredNetwork}. If Phantom shows a different balance, switch Phantom and the app to the same network and retry.`;
}

export async function assertRegisterAgentClusterReady(walletAddress: Address) {
  try {
    const agentProfilePda = await getAgentPDA(walletAddress);
    const [
      programAccount,
      agentProfile,
      walletBalanceLamports,
      profileRentLamports,
    ] = await Promise.all([
      fetchEncodedAccount(rpc, AGENTVOUCH_PROGRAM_ADDRESS).catch(() => null),
      fetchMaybeAgentProfile(rpc, agentProfilePda).catch(() => null),
      getWalletBalanceLamports(walletAddress).catch(() => null),
      rpc
        .getMinimumBalanceForRentExemption(BigInt(AGENT_PROFILE_ACCOUNT_SPACE))
        .send()
        .then(coerceLamports)
        .catch(() => null),
    ]);
    const guardError = getRegisterAgentClusterGuardError({
      walletAddress,
      programExists: !!programAccount?.exists,
      profileExists: !!agentProfile?.exists,
      walletBalanceLamports,
      requiredLamports:
        profileRentLamports === null
          ? null
          : profileRentLamports + REGISTRATION_FEE_BUFFER_LAMPORTS,
    });
    if (guardError) throw new ClusterGuardError(guardError);
  } catch (error) {
    if (error instanceof ClusterGuardError) throw error;
    console.warn("Register cluster guard skipped:", error);
  }
}

export async function assertSkillListingClusterReady(input: {
  walletAddress: Address;
  skillId: string;
  mode: "create" | "update";
}) {
  try {
    const authorProfile = await getAgentPDA(input.walletAddress);
    const skillListing = await getSkillListingPDA(
      input.walletAddress,
      input.skillId
    );
    const [authorProfileAccount, skillListingAccount] = await Promise.all([
      fetchMaybeAgentProfile(rpc, authorProfile).catch(() => null),
      fetchMaybeSkillListing(rpc, skillListing).catch(() => null),
    ]);

    const guardError = getSkillListingClusterGuardError({
      mode: input.mode,
      authorProfileExists: !!authorProfileAccount?.exists,
      listingExists: !!skillListingAccount?.exists,
      skillId: input.skillId,
    });
    if (guardError) throw new ClusterGuardError(guardError);
  } catch (error) {
    if (error instanceof ClusterGuardError) throw error;
    console.warn("Skill listing cluster guard skipped:", error);
  }
}

export async function waitForConfirmedSignature(
  txSignature: ReturnType<typeof signature>
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < SIGNATURE_CONFIRMATION_TIMEOUT_MS) {
    const response = await rpc
      .getSignatureStatuses([txSignature], { searchTransactionHistory: true })
      .send();
    const status = response.value[0];

    if (status?.err) {
      throw new Error(
        `Transaction ${txSignature} failed on-chain: ${JSON.stringify(
          status.err
        )}`
      );
    }

    if (
      status &&
      (status.confirmationStatus === "confirmed" ||
        status.confirmationStatus === "finalized")
    ) {
      return;
    }

    await sleep(SIGNATURE_CONFIRMATION_POLL_MS);
  }

  throw new Error(
    `Transaction ${txSignature} was sent but not confirmed within ${
      SIGNATURE_CONFIRMATION_TIMEOUT_MS / 1000
    } seconds.`
  );
}

export async function sendSolanaInstructions(
  session: Pick<SolanaWriteSession, "signer" | "walletAddress">,
  ix: SendInstruction | readonly SendInstruction[],
  summary?: AgentVouchTransactionSummary
) {
  const { signer, walletAddress } = session;
  if (!walletAddress || !signer) throw new Error("Wallet not connected");
  const request = buildTransactionSendRequest(ix, signer);
  try {
    if (summary) logTransactionSummary(summary);
    const sig = await getClientTransactionHelper().prepareAndSend(request);
    const txSignature = signature(String(sig));
    await waitForConfirmedSignature(txSignature);
    return txSignature;
  } catch (error: unknown) {
    const cause =
      error && typeof error === "object" && "cause" in error
        ? (error as { cause?: unknown }).cause ?? error
        : error;
    const logs =
      cause &&
      typeof cause === "object" &&
      "logs" in cause &&
      Array.isArray((cause as { logs?: unknown }).logs)
        ? (cause as { logs: unknown[] }).logs
        : cause &&
          typeof cause === "object" &&
          "context" in cause &&
          (cause as { context?: unknown }).context &&
          typeof (cause as { context?: unknown }).context === "object" &&
          "logs" in ((cause as { context: { logs?: unknown } }).context ?? {})
        ? (cause as { context: { logs?: unknown[] } }).context.logs ?? null
        : null;
    if (logs?.length) console.error("Simulation logs:", logs);
    if (cause) {
      console.error("Transaction failed (cause):", cause);
      throw cause;
    }
    throw new Error(getErrorMessage(error));
  }
}

export type RegisterSolanaAgentResult = {
  tx: ReturnType<typeof signature> | string;
  agentProfile: Address;
  sponsored: boolean;
};

export async function registerSolanaAgent(
  session: SolanaWriteSession,
  metadataUri: string
): Promise<RegisterSolanaAgentResult> {
  const { signer, walletAddress, connectorSigner, canSignSponsored } = session;
  if (!signer || !walletAddress) throw new Error("Wallet not connected");
  const authorAddress = getConnectedAuthorAddress(walletAddress, signer);
  // Gasless onboarding: route through the sponsor so a USDC-only wallet (no
  // SOL) can register. The sponsor pays gas + the AgentProfile rent; the user
  // reimburses in USDC. Falls back to direct self-pay when unavailable.
  const sponsoredCheckoutEnabled = sponsoredCheckoutPubliclyEnabled();
  if (sponsoredCheckoutEnabled && connectorSigner && canSignSponsored) {
    const sponsored = await runSponsoredRegisterAgent({
      connectorSigner,
      metadataUri,
    });
    if (sponsored) {
      const agentProfile = await getAgentPDA(authorAddress);
      return { tx: sponsored.signature, agentProfile, sponsored: true };
    }
  } else if (sponsoredCheckoutEnabled) {
    confirmDirectPurchaseAfterSponsoredUnavailable(
      "This wallet connection cannot sign the prepared sponsored transaction."
    );
  }

  // Direct (self-pay) path: the connected wallet pays its own gas + rent in SOL.
  await assertRegisterAgentClusterReady(walletAddress);
  const ix = await getRegisterAgentInstructionAsync({
    authority: signer,
    rentPayer: signer,
    metadataUri,
  });
  const tx = await sendSolanaInstructions(session, ix);
  const agentProfile = await getAgentPDA(authorAddress);
  return { tx, agentProfile, sponsored: false };
}

export type CreateSolanaSkillListingInput = {
  skillId: string;
  skillUri: string;
  name: string;
  description: string;
  priceUsdcMicros: bigint;
};

export async function createSolanaSkillListing(
  session: SolanaWriteSession,
  input: CreateSolanaSkillListingInput
) {
  const { signer, walletAddress } = session;
  const { skillId, skillUri, name, description, priceUsdcMicros } = input;
  if (!signer || !walletAddress) throw new Error("Wallet not connected");
  const authorAddress = getConnectedAuthorAddress(walletAddress, signer);
  await assertSkillListingClusterReady({
    walletAddress: authorAddress,
    skillId,
    mode: "create",
  });
  const usdcMint = await getProtocolUsdcMint();
  const { authorProfile, authorBond, config, skillListing } =
    await resolveSkillListingAccounts(authorAddress, skillId);
  const listingSettlement = await getListingSettlementPDA(skillListing);
  const [authorProceedsVaultAuthority, authorProceedsVault] = await Promise.all(
    [
      getAuthorProceedsVaultAuthorityPDA(listingSettlement),
      getAuthorProceedsVaultPDA(listingSettlement),
    ]
  );
  const ix = await getCreateSkillListingInstructionAsync({
    skillListing,
    authorProfile,
    config,
    // Free listings stake the author bond; the legacy number-typed path checked
    // `priceUsdcMicros === 0` — this is its bigint equivalent, deliberately.
    authorBond: priceUsdcMicros === 0n ? authorBond : undefined,
    usdcMint,
    listingSettlement,
    authorProceedsVaultAuthority,
    authorProceedsVault,
    author: signer,
    skillId,
    skillUri,
    name,
    description,
    priceUsdcMicros,
  });
  const summary = {
    action: "Create skill listing",
    token: "USDC" as const,
    amountUsdcMicros: priceUsdcMicros,
    vault: authorProceedsVault,
    feePayer: signer.address,
    cluster: getConfiguredNetworkDescription(),
  };
  return { tx: await sendSolanaInstructions(session, ix, summary), summary };
}

export type PurchaseSolanaSkillInput = {
  skillListingKey: Address;
  // Defaults to the live listing's author; legacy hook callers pass it explicitly.
  authorKey?: Address;
  resolveUsdcMint?: () => Promise<Address>;
};

export type PurchaseSolanaSkillResult =
  | { tx: null; alreadyPurchased: true; purchase: Address }
  | {
      tx: ReturnType<typeof signature> | string;
      summary: AgentVouchTransactionSummary;
      alreadyPurchased?: undefined;
      purchase?: undefined;
    };

export async function purchaseSolanaSkill(
  session: SolanaWriteSession,
  input: PurchaseSolanaSkillInput
): Promise<PurchaseSolanaSkillResult> {
  const { signer, walletAddress, connectorSigner, canSignSponsored } = session;
  const { skillListingKey } = input;
  const resolveUsdcMint = input.resolveUsdcMint ?? getProtocolUsdcMint;
  if (!signer || !walletAddress) throw new Error("Wallet not connected");
  const listing = await fetchMaybeSkillListing(rpc, skillListingKey);
  if (!listing.exists) throw new Error("Skill listing not found");
  const authorKey = input.authorKey ?? listing.data.author;
  const purchasePda = await getPurchasePDA(
    walletAddress,
    skillListingKey,
    listing.data.currentRevision
  );
  const existingPurchase = await fetchMaybePurchase(rpc, purchasePda).catch(
    () => null
  );
  if (existingPurchase?.exists) {
    return {
      tx: null,
      alreadyPurchased: true,
      purchase: purchasePda,
    };
  }
  const usdcMint = await resolveUsdcMint();
  const sponsoredCheckoutEnabled = sponsoredCheckoutPubliclyEnabled();
  if (sponsoredCheckoutEnabled && connectorSigner && canSignSponsored) {
    const sponsored = await runSponsoredCheckout({
      connectorSigner,
      skillListing: String(skillListingKey),
      priceUsdcMicros: listing.data.priceUsdcMicros,
      expectedUsdcMint: String(usdcMint),
    });
    if (sponsored) {
      const summary = {
        action: "Purchase skill",
        token: "USDC" as const,
        amountUsdcMicros:
          BigInt(listing.data.priceUsdcMicros) + sponsored.setupFeeUsdcMicros,
        recipient: listing.data.currentAuthorProceedsVault,
        feePayer: sponsored.sponsor,
        cluster: getConfiguredNetworkDescription(),
      };
      logTransactionSummary(summary);
      return { tx: sponsored.signature, summary };
    }
  } else if (sponsoredCheckoutEnabled) {
    confirmDirectPurchaseAfterSponsoredUnavailable(
      "This wallet connection cannot sign the prepared sponsored transaction."
    );
  }
  let purchaseEstimate: PurchasePreflightAssessment | null = null;
  try {
    purchaseEstimate = await estimatePurchasePreflight(
      walletAddress,
      skillListingKey,
      authorKey,
      resolveUsdcMint
    );
    if (
      purchaseEstimate.purchasePreflightStatus === "buyerInsufficientBalance"
    ) {
      throw new Error(
        buildPurchaseBalanceError(walletAddress, purchaseEstimate)
      );
    }
    if (
      purchaseEstimate.purchasePreflightStatus === "authorPayoutRentBlocked"
    ) {
      throw new Error(
        purchaseEstimate.purchasePreflightMessage ??
          "This listing is temporarily not purchasable."
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("Buying this skill needs about") ||
        error.message.includes("cannot currently be purchased"))
    ) {
      throw error;
    }
    console.warn("Purchase preflight skipped:", error);
  }

  const authorProfile = await getAgentPDA(authorKey);
  const [buyerUsdcAccount, authorRewardVaultAuthority, authorRewardVault] =
    await Promise.all([
      getAssociatedTokenAccount(walletAddress, usdcMint),
      getAuthorRewardVaultAuthorityPDA(authorProfile),
      getAuthorRewardVaultPDA(authorProfile),
    ]);
  await assertUsdcAccountReady({
    rpc,
    owner: walletAddress,
    mint: usdcMint,
    purpose: "Skill purchase",
    minimumBalanceUsdcMicros: BigInt(listing.data.priceUsdcMicros),
  });
  const ix = await getPurchaseSkillInstructionAsync({
    skillListing: skillListingKey,
    purchase: purchasePda,
    author: authorKey,
    authorProfile,
    usdcMint,
    buyerUsdcAccount,
    listingSettlement: listing.data.currentSettlement,
    authorProceedsVault: listing.data.currentAuthorProceedsVault,
    authorRewardVaultAuthority,
    authorRewardVault,
    buyer: signer,
    rentPayer: signer,
  });
  const summary = {
    action: "Purchase skill",
    token: "USDC" as const,
    amountUsdcMicros: BigInt(listing.data.priceUsdcMicros),
    recipient: listing.data.currentAuthorProceedsVault,
    vault: authorRewardVault,
    feePayer: signer.address,
    cluster: getConfiguredNetworkDescription(),
  };
  try {
    return { tx: await sendSolanaInstructions(session, ix, summary), summary };
  } catch (error: unknown) {
    const existingPurchaseAfterFailure = await fetchMaybePurchase(
      rpc,
      purchasePda
    ).catch(() => null);
    if (existingPurchaseAfterFailure?.exists) {
      return {
        tx: null,
        alreadyPurchased: true,
        purchase: purchasePda,
      };
    }
    const message = getErrorMessage(error, "");
    if (/insufficient|not enough sol/i.test(message)) {
      const latestEstimate =
        purchaseEstimate ??
        (await estimatePurchasePreflight(
          walletAddress,
          skillListingKey,
          authorKey,
          resolveUsdcMint
        ).catch(() => null));
      if (latestEstimate) {
        if (
          latestEstimate.purchasePreflightStatus === "buyerInsufficientBalance"
        ) {
          throw new Error(
            buildPurchaseBalanceError(walletAddress, latestEstimate)
          );
        }
        if (
          latestEstimate.purchasePreflightStatus === "authorPayoutRentBlocked"
        ) {
          throw new Error(
            latestEstimate.purchasePreflightMessage ??
              "This listing is temporarily not purchasable."
          );
        }
        throw new Error(
          buildPurchaseClusterMismatchError(walletAddress, latestEstimate)
        );
      }
    }
    throw error;
  }
}
