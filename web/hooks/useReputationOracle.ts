import { useMemo, useCallback } from "react";
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
import type { Base64EncodedBytes, Base58EncodedBytes } from "@solana/rpc-types";
import { decodeBase64, encodeBase64 } from "@/lib/base64";

const asBase64 = (bytes: Uint8Array) =>
  encodeBase64(bytes) as Base64EncodedBytes;
const asBase58 = (addr: string) => addr as unknown as Base58EncodedBytes;
import {
  fetchMaybeAuthorBond,
  fetchAllMaybePurchase,
  fetchAllMaybeSkillListing,
  fetchMaybeAgentProfile,
  fetchMaybeAuthorDispute,
  fetchMaybePurchase,
  fetchMaybeReputationConfig,
  fetchMaybeSkillListing,
  fetchMaybeVouch,
  decodeReputationConfig,
  getAuthorDisputeDecoder,
  getOpenAuthorDisputeInstructionAsync,
  getResolveAuthorDisputeInstruction,
  getAgentProfileDecoder,
  getRegisterAgentInstructionAsync,
  getVouchInstructionAsync,
  getRevokeVouchInstructionAsync,
  getCreateSkillListingInstructionAsync,
  getUpdateSkillListingInstructionAsync,
  getPurchaseSkillInstructionAsync,
  getClaimVoucherRevenueInstructionAsync,
  getSkillListingDecoder,
  getVouchDecoder,
  getPurchaseDecoder,
  AGENT_PROFILE_DISCRIMINATOR,
  AUTHOR_DISPUTE_DISCRIMINATOR,
  SKILL_LISTING_DISCRIMINATOR,
  VOUCH_DISCRIMINATOR,
  PURCHASE_DISCRIMINATOR,
  AuthorDisputeLiabilityScope,
  AuthorDisputeReason,
  AuthorDisputeRuling,
  AuthorDisputeStatus,
  VouchStatus,
  type AgentProfile,
  type ReputationConfig,
} from "../generated/agentvouch/src/generated";
import { getDepositAuthorBondInstructionAsync } from "../generated/agentvouch/src/generated/instructions/depositAuthorBond";
import { getWithdrawAuthorBondInstructionAsync } from "../generated/agentvouch/src/generated/instructions/withdrawAuthorBond";
import { getWithdrawAuthorProceedsInstructionAsync } from "../generated/agentvouch/src/generated/instructions/withdrawAuthorProceeds";
import { fetchMaybeListingSettlement } from "../generated/agentvouch/src/generated/accounts/listingSettlement";
import { getRemoveSkillListingInstructionAsync } from "../generated/agentvouch/src/generated/instructions/removeSkillListing";
import { getCloseSkillListingInstructionAsync } from "../generated/agentvouch/src/generated/instructions/closeSkillListing";
import { getInitializeListingSettlementInstructionAsync } from "../generated/agentvouch/src/generated/instructions/initializeListingSettlement";
import { AGENTVOUCH_PROGRAM_ADDRESS } from "../generated/agentvouch/src/generated/programs";
import {
  getConfiguredSolanaChainDisplayLabel,
  getConfiguredSolanaRpcTargetLabel,
} from "@/lib/chains";
import {
  getAuthorDisputeLiabilityScopeLabel,
  listAuthorDisputeLinks,
  listAuthorDisputesByAuthor,
} from "@/lib/authorDisputes";
import { countsTowardAuthorWideReportSnapshot } from "@/lib/disputes";
import {
  assessPurchasePreflight,
  createPurchasePreflightContext,
  type PurchasePreflightAssessment,
} from "@/lib/purchasePreflight";
import { getErrorMessage } from "@/lib/errors";
import { normalizeRegisteredAt } from "@/lib/registeredAt";
import { wrapRpcLookupError } from "@/lib/rpcErrors";
import { getConfiguredUsdcMint } from "@/lib/x402";
import {
  assertUsdcAccountReady,
  fetchAssociatedTokenAccountState,
  formatUsdcMicrosValue,
  getAssociatedTokenAccount,
  getCreateAssociatedTokenAccountIdempotentInstruction,
  logTransactionSummary,
  TOKEN_PROGRAM_ID,
  usdcToMicros,
  type AgentVouchTransactionSummary,
} from "@/lib/agentvouchUsdc";
import { getClientTransactionHelper } from "@/lib/solanaTransactionHelper";
import { useAgentVouchTransactionSigner } from "./useAgentVouchTransactionSigner";
import { useAgentVouchWallet } from "@/components/WalletContextProvider";

const ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const rpc = createSolanaRpc(ENDPOINT);
const SIGNATURE_CONFIRMATION_TIMEOUT_MS = 45_000;
const SIGNATURE_CONFIRMATION_POLL_MS = 1_000;
const MIN_REPUTATION_CONFIG_SIZE = 457;
const AGENT_PROFILE_ACCOUNT_SPACE = 301;
const REGISTRATION_FEE_BUFFER_LAMPORTS = 10_000n;

const textEncoder = getUtf8Encoder();
const addressEncoder = getAddressEncoder();

type SendInstructionAccount = {
  address: Address;
  role: number;
  signer?: TransactionSigner;
};

type SendInstruction = Instruction<string, readonly AccountMeta[]> & {
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

type StakeClusterGuardAssessment =
  | {
      action: "vouch";
      walletAddress: Address;
      voucheeProfileExists: boolean;
      walletUsdcBalanceMicros: bigint | null;
      hasUsdcAccount: boolean | null;
      requiredUsdcMicros: bigint;
      configuredChainLabel?: string;
      configuredRpcTarget?: string;
    }
  | {
      action: "revoke";
      walletAddress: Address;
      voucheeProfileExists: boolean;
      hasLiveVouch: boolean;
      configuredChainLabel?: string;
      configuredRpcTarget?: string;
    };

type ClusterGuardContext = {
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

type OpenAuthorDisputeClusterGuardAssessment = ClusterGuardContext & {
  walletAddress: Address;
  authorProfileExists: boolean;
  disputeId: number | bigint;
  disputeExists: boolean;
  skillListingProvided: boolean;
  skillListingExists: boolean;
  skillListingMatchesAuthor: boolean;
  purchaseProvided: boolean;
  purchaseExists: boolean;
  purchaseMatchesSkillListing: boolean;
  walletBalanceLamports: bigint | null;
  walletUsdcBalanceMicros: bigint | null;
  hasUsdcAccount: boolean | null;
  disputeBondUsdcMicros: bigint | null;
};

type ResolveAuthorDisputeClusterGuardAssessment = ClusterGuardContext & {
  walletAddress: Address;
  authorProfileExists: boolean;
  disputeId: number | bigint;
  disputeExists: boolean;
  disputeOpen: boolean;
  resolverAuthorized: boolean;
};

type BondConfigClusterGuardAssessment = ClusterGuardContext & {
  configExists: boolean;
  configReadable: boolean;
  configDataLength: number | null;
  expectedConfigDataLength: number;
};

function getConfiguredNetworkDescription(context: ClusterGuardContext = {}) {
  const configuredChainLabel =
    context.configuredChainLabel ?? getConfiguredSolanaChainDisplayLabel();
  const configuredRpcTarget =
    context.configuredRpcTarget ?? getConfiguredSolanaRpcTargetLabel();
  return `${configuredChainLabel} (${configuredRpcTarget} RPC)`;
}

export function getStakeClusterGuardError(
  assessment: StakeClusterGuardAssessment
): string | null {
  const configuredNetwork = getConfiguredNetworkDescription(assessment);

  if (!assessment.voucheeProfileExists) {
    return `This author is not registered on the configured ${configuredNetwork}. If you expected to interact with them on another network, switch Phantom and the app to the same cluster and retry.`;
  }

  if (assessment.action === "vouch") {
    if (assessment.hasUsdcAccount === false) {
      return `Connected wallet ${shortAddress(
        assessment.walletAddress
      )} does not have a USDC token account on the configured ${configuredNetwork}. Fund the wallet with USDC on this cluster and retry.`;
    }
    if (
      assessment.walletUsdcBalanceMicros !== null &&
      assessment.walletUsdcBalanceMicros < assessment.requiredUsdcMicros
    ) {
      return `Connected wallet ${shortAddress(
        assessment.walletAddress
      )} has ${formatUsdcMicrosValue(
        assessment.walletUsdcBalanceMicros
      )} USDC on the configured ${configuredNetwork}. This vouch needs ${formatUsdcMicrosValue(
        assessment.requiredUsdcMicros
      )} USDC plus SOL for network fees.`;
    }
    return null;
  }

  if (!assessment.hasLiveVouch) {
    return `No live vouch for this author was found on the configured ${configuredNetwork}. If you created the vouch on another network, switch Phantom and the app to the same cluster and retry.`;
  }

  return null;
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

export function getOpenAuthorDisputeClusterGuardError(
  assessment: OpenAuthorDisputeClusterGuardAssessment
): string | null {
  const configuredNetwork = getConfiguredNetworkDescription(assessment);

  if (!assessment.authorProfileExists) {
    return `This author is not registered on the configured ${configuredNetwork}. If you expected to report them on another network, switch Phantom and the app to the same cluster and retry.`;
  }

  if (assessment.disputeExists) {
    return `Author dispute ${String(
      assessment.disputeId
    )} already exists on the configured ${configuredNetwork}.`;
  }

  if (assessment.skillListingProvided && !assessment.skillListingExists) {
    return `The referenced skill listing was not found on the configured ${configuredNetwork}. If it exists on another network, switch Phantom and the app to the same cluster and retry.`;
  }

  if (
    assessment.skillListingProvided &&
    !assessment.skillListingMatchesAuthor
  ) {
    return `The referenced skill listing does not belong to this author on the configured ${configuredNetwork}.`;
  }

  if (assessment.purchaseProvided && !assessment.purchaseExists) {
    return `The referenced purchase was not found on the configured ${configuredNetwork}. If it exists on another network, switch Phantom and the app to the same cluster and retry.`;
  }

  if (assessment.purchaseProvided && !assessment.purchaseMatchesSkillListing) {
    return `The referenced purchase does not belong to the referenced skill listing on the configured ${configuredNetwork}.`;
  }

  if (
    assessment.hasUsdcAccount === false &&
    assessment.disputeBondUsdcMicros !== null
  ) {
    return `Connected wallet ${shortAddress(
      assessment.walletAddress
    )} does not have a USDC token account on the configured ${configuredNetwork}. Opening this author dispute needs ${formatUsdcMicrosValue(
      assessment.disputeBondUsdcMicros
    )} USDC plus SOL for network fees.`;
  }

  if (
    assessment.walletUsdcBalanceMicros !== null &&
    assessment.disputeBondUsdcMicros !== null &&
    assessment.walletUsdcBalanceMicros < assessment.disputeBondUsdcMicros
  ) {
    return `Connected wallet ${shortAddress(
      assessment.walletAddress
    )} has ${formatUsdcMicrosValue(
      assessment.walletUsdcBalanceMicros
    )} USDC on the configured ${configuredNetwork}. Opening this author dispute needs ${formatUsdcMicrosValue(
      assessment.disputeBondUsdcMicros
    )} USDC plus SOL for network fees.`;
  }

  return null;
}

export function getResolveAuthorDisputeClusterGuardError(
  assessment: ResolveAuthorDisputeClusterGuardAssessment
): string | null {
  const configuredNetwork = getConfiguredNetworkDescription(assessment);

  if (!assessment.authorProfileExists) {
    return `This author is not registered on the configured ${configuredNetwork}. If you expected to resolve the dispute on another network, switch Phantom and the app to the same cluster and retry.`;
  }

  if (!assessment.disputeExists) {
    return `Author dispute ${String(
      assessment.disputeId
    )} was not found on the configured ${configuredNetwork}. If it exists on another network, switch Phantom and the app to the same cluster and retry.`;
  }

  if (!assessment.disputeOpen) {
    return `Author dispute ${String(
      assessment.disputeId
    )} is no longer open on the configured ${configuredNetwork}.`;
  }

  if (!assessment.resolverAuthorized) {
    return `Connected wallet ${shortAddress(
      assessment.walletAddress
    )} is not the configured resolver on the configured ${configuredNetwork}. If you meant to resolve this dispute on another network, switch Phantom and the app to the same cluster and retry.`;
  }

  return null;
}

export function getBondConfigClusterGuardError(
  assessment: BondConfigClusterGuardAssessment
): string | null {
  const configuredNetwork = getConfiguredNetworkDescription(assessment);

  if (!assessment.configExists) {
    return `The protocol config is missing on the configured ${configuredNetwork}. An operator must initialize or migrate the config on this cluster before author bond actions can proceed.`;
  }

  if (!assessment.configReadable) {
    const layoutDetail =
      assessment.configDataLength == null
        ? "its layout could not be read"
        : assessment.configDataLength < assessment.expectedConfigDataLength
        ? `it is ${assessment.configDataLength} bytes instead of at least ${assessment.expectedConfigDataLength}`
        : "its layout could not be decoded";
    return `The protocol config on the configured ${configuredNetwork} is outdated or unreadable because ${layoutDetail}. An operator must run the config migration on this cluster before author bond actions can proceed.`;
  }

  return null;
}

class ClusterGuardError extends Error {}

function encodeU64LE(value: number | bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return bytes;
}

async function deriveAddress(
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

async function getAgentPDA(agentKey: Address): Promise<Address> {
  return deriveAddress(["agent", agentKey]);
}

async function getAuthorBondPDA(authorKey: Address): Promise<Address> {
  return deriveAddress(["author_bond", authorKey]);
}

async function getAuthorBondVaultAuthorityPDA(
  authorKey: Address
): Promise<Address> {
  return deriveAddress(["author_bond_vault_authority", authorKey]);
}

async function getAuthorBondVaultPDA(authorKey: Address): Promise<Address> {
  return deriveAddress(["author_bond_vault", authorKey]);
}

async function getVouchPDA(
  voucherProfile: Address,
  voucheeProfile: Address
): Promise<Address> {
  return deriveAddress(["vouch", voucherProfile, voucheeProfile]);
}

async function getVouchVaultAuthorityPDA(
  voucherProfile: Address,
  voucheeProfile: Address
): Promise<Address> {
  return deriveAddress([
    "vouch_vault_authority",
    voucherProfile,
    voucheeProfile,
  ]);
}

async function getVouchVaultPDA(
  voucherProfile: Address,
  voucheeProfile: Address
): Promise<Address> {
  return deriveAddress(["vouch_vault", voucherProfile, voucheeProfile]);
}

async function getConfigPDA(): Promise<Address> {
  return deriveAddress(["config"]);
}

async function getAuthorDisputePDA(
  author: Address,
  disputeId: number | bigint
): Promise<Address> {
  const [derived] = await getProgramDerivedAddress({
    programAddress: AGENTVOUCH_PROGRAM_ADDRESS,
    seeds: [
      textEncoder.encode("author_dispute"),
      addressEncoder.encode(author),
      encodeU64LE(disputeId),
    ],
  });
  return derived;
}

async function getAuthorDisputeVouchLinkPDA(
  authorDispute: Address,
  vouch: Address
): Promise<Address> {
  const [derived] = await getProgramDerivedAddress({
    programAddress: AGENTVOUCH_PROGRAM_ADDRESS,
    seeds: [
      textEncoder.encode("author_dispute_vouch_link"),
      addressEncoder.encode(authorDispute),
      addressEncoder.encode(vouch),
    ],
  });
  return derived;
}

async function getDisputeBondVaultAuthorityPDA(
  author: Address,
  disputeId: number | bigint
): Promise<Address> {
  const [derived] = await getProgramDerivedAddress({
    programAddress: AGENTVOUCH_PROGRAM_ADDRESS,
    seeds: [
      textEncoder.encode("dispute_bond_vault_authority"),
      addressEncoder.encode(author),
      encodeU64LE(disputeId),
    ],
  });
  return derived;
}

async function getDisputeBondVaultPDA(
  author: Address,
  disputeId: number | bigint
): Promise<Address> {
  const [derived] = await getProgramDerivedAddress({
    programAddress: AGENTVOUCH_PROGRAM_ADDRESS,
    seeds: [
      textEncoder.encode("dispute_bond_vault"),
      addressEncoder.encode(author),
      encodeU64LE(disputeId),
    ],
  });
  return derived;
}

async function getSkillListingPDA(
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

async function getPurchasePDA(
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

async function getAuthorRewardVaultAuthorityPDA(
  authorProfile: Address
): Promise<Address> {
  return deriveAddress(["author_reward_vault_authority", authorProfile]);
}

async function getAuthorRewardVaultPDA(
  authorProfile: Address
): Promise<Address> {
  return deriveAddress(["author_reward_vault", authorProfile]);
}

async function getListingSettlementPDA(
  skillListing: Address,
  revision: number | bigint = 0n
): Promise<Address> {
  return deriveAddress([
    "listing_settlement",
    skillListing,
    encodeU64LE(revision),
  ]);
}

async function getAuthorProceedsVaultAuthorityPDA(
  listingSettlement: Address
): Promise<Address> {
  return deriveAddress(["author_proceeds_vault_authority", listingSettlement]);
}

async function getAuthorProceedsVaultPDA(
  listingSettlement: Address
): Promise<Address> {
  return deriveAddress(["author_proceeds_vault", listingSettlement]);
}

async function getListingVouchPositionPDA(
  skillListing: Address,
  vouch: Address
): Promise<Address> {
  return deriveAddress(["listing_vouch_position", skillListing, vouch]);
}

async function getProtocolTreasuryVaultPDA(): Promise<Address> {
  return deriveAddress(["treasury_vault"]);
}

async function getProtocolConfig() {
  const config = await getConfigPDA();
  const maybeConfig = await fetchMaybeReputationConfig(rpc, config).catch(
    () => null
  );
  return {
    config,
    data: maybeConfig?.exists ? maybeConfig.data : null,
  };
}

async function getProtocolUsdcMint(): Promise<Address> {
  const protocolConfig = await getProtocolConfig();
  return protocolConfig.data?.usdcMint ?? address(getConfiguredUsdcMint());
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shortAddress(value: string) {
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

function formatLamportsAsSol(lamports: bigint) {
  const sol = Number(lamports) / 1_000_000_000;
  const decimals = sol >= 1 ? 4 : 6;
  return sol.toFixed(decimals).replace(/\.?0+$/, "");
}

function coerceLamports(value: unknown): bigint {
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

async function estimatePurchasePreflight(
  buyer: Address,
  skillListing: Address,
  author: Address
): Promise<PurchasePreflightAssessment> {
  const listing = await fetchMaybeSkillListing(rpc, skillListing);
  if (!listing.exists) throw new Error("Skill listing not found on-chain");
  const usdcMint = await getProtocolUsdcMint();
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

function buildPurchaseBalanceError(
  walletAddress: Address,
  estimate: PurchasePreflightAssessment
) {
  const configuredNetwork = `${getConfiguredSolanaChainDisplayLabel()} (${getConfiguredSolanaRpcTargetLabel()} RPC)`;
  return `Connected wallet ${shortAddress(
    walletAddress
  )} has ${formatUsdcMicrosValue(
    estimate.buyerUsdcBalanceMicros ?? 0n
  )} USDC on the configured ${configuredNetwork}. Buying this skill needs ${formatUsdcMicrosValue(
    estimate.creatorPriceUsdcMicros
  )} USDC plus SOL for receipt rent and network fees.`;
}

function buildPurchaseClusterMismatchError(
  walletAddress: Address,
  estimate: PurchasePreflightAssessment
) {
  const configuredNetwork = `${getConfiguredSolanaChainDisplayLabel()} (${getConfiguredSolanaRpcTargetLabel()} RPC)`;
  return `Phantom reported insufficient SOL, but connected wallet ${shortAddress(
    walletAddress
  )} has ${formatLamportsAsSol(
    estimate.buyerBalanceLamports ?? 0n
  )} SOL for fees on the configured ${configuredNetwork}. If Phantom shows a different balance, switch Phantom and the app to the same network and retry.`;
}

function sanitizeAgentProfile(profile: AgentProfile): AgentProfile {
  return {
    ...profile,
    registeredAt: BigInt(normalizeRegisteredAt(profile.registeredAt)),
  };
}

function isLiveVouchStatus(status: VouchStatus): boolean {
  return status === VouchStatus.Active;
}

async function getWalletBalanceLamports(
  walletAddress: Address
): Promise<bigint> {
  const response = await rpc.getBalance(walletAddress).send();
  return coerceLamports(response.value);
}

async function assertStakeActionClusterReady(
  input:
    | {
        action: "vouch";
        walletAddress: Address;
        voucheeProfile: Address;
        requiredUsdcMicros: bigint;
      }
    | {
        action: "revoke";
        walletAddress: Address;
        voucheeProfile: Address;
      }
) {
  try {
    const voucheeProfileAccountPromise = fetchMaybeAgentProfile(
      rpc,
      input.voucheeProfile
    ).catch(() => null);

    if (input.action === "vouch") {
      const usdcMint = await getProtocolUsdcMint();
      const [voucheeProfileAccount, usdcAccountState] = await Promise.all([
        voucheeProfileAccountPromise,
        fetchAssociatedTokenAccountState(
          rpc,
          input.walletAddress,
          usdcMint
        ).catch(() => null),
      ]);

      const guardError = getStakeClusterGuardError({
        action: "vouch",
        walletAddress: input.walletAddress,
        voucheeProfileExists: !!voucheeProfileAccount?.exists,
        walletUsdcBalanceMicros: usdcAccountState?.exists
          ? usdcAccountState.amount
          : null,
        hasUsdcAccount: usdcAccountState ? usdcAccountState.exists : null,
        requiredUsdcMicros: input.requiredUsdcMicros,
      });
      if (guardError) throw new ClusterGuardError(guardError);
      return;
    }

    const voucherProfile = await getAgentPDA(input.walletAddress);
    const vouchAddress = await getVouchPDA(
      voucherProfile,
      input.voucheeProfile
    );
    const [voucheeProfileAccount, maybeVouch] = await Promise.all([
      voucheeProfileAccountPromise,
      fetchMaybeVouch(rpc, vouchAddress).catch(() => null),
    ]);

    const guardError = getStakeClusterGuardError({
      action: "revoke",
      walletAddress: input.walletAddress,
      voucheeProfileExists: !!voucheeProfileAccount?.exists,
      hasLiveVouch:
        !!maybeVouch?.exists && isLiveVouchStatus(maybeVouch.data.status),
    });
    if (guardError) throw new ClusterGuardError(guardError);
  } catch (error) {
    if (error instanceof ClusterGuardError) throw error;
    console.warn("Stake cluster guard skipped:", error);
  }
}

async function assertRegisterAgentClusterReady(walletAddress: Address) {
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

async function assertBondConfigClusterReady() {
  try {
    const configPda = await getConfigPDA();
    const encodedConfig = await fetchEncodedAccount(rpc, configPda);
    const expectedConfigDataLength = MIN_REPUTATION_CONFIG_SIZE;

    let configReadable = false;
    let configDataLength: number | null = null;

    if (encodedConfig.exists) {
      configDataLength = encodedConfig.data.length;
      if (configDataLength >= expectedConfigDataLength) {
        try {
          decodeReputationConfig(encodedConfig);
          configReadable = true;
        } catch {
          configReadable = false;
        }
      }
    }

    const guardError = getBondConfigClusterGuardError({
      configExists: encodedConfig.exists,
      configReadable,
      configDataLength,
      expectedConfigDataLength,
    });
    if (guardError) throw new ClusterGuardError(guardError);
  } catch (error) {
    if (error instanceof ClusterGuardError) throw error;
    console.warn("Bond config cluster guard skipped:", error);
  }
}

async function assertSkillListingClusterReady(input: {
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

async function assertOpenAuthorDisputeClusterReady(input: {
  walletAddress: Address;
  authorKey: Address;
  disputeId: number | bigint;
  skillListing?: Address;
  purchase?: Address;
}) {
  try {
    const authorProfile = await getAgentPDA(input.authorKey);
    const authorDispute = await getAuthorDisputePDA(
      input.authorKey,
      input.disputeId
    );
    const configPda = await getConfigPDA();
    const [
      maybeAuthorProfile,
      maybeAuthorDispute,
      maybeSkillListing,
      maybePurchase,
      maybeConfig,
      walletBalanceLamports,
      usdcAccountState,
    ] = await Promise.all([
      fetchMaybeAgentProfile(rpc, authorProfile).catch(() => null),
      fetchMaybeAuthorDispute(rpc, authorDispute).catch(() => null),
      input.skillListing
        ? fetchMaybeSkillListing(rpc, input.skillListing).catch(() => null)
        : Promise.resolve(null),
      input.purchase
        ? fetchMaybePurchase(rpc, input.purchase).catch(() => null)
        : Promise.resolve(null),
      fetchMaybeReputationConfig(rpc, configPda).catch(() => null),
      getWalletBalanceLamports(input.walletAddress).catch(() => null),
      getProtocolUsdcMint()
        .then((usdcMint) =>
          fetchAssociatedTokenAccountState(rpc, input.walletAddress, usdcMint)
        )
        .catch(() => null),
    ]);

    const guardError = getOpenAuthorDisputeClusterGuardError({
      walletAddress: input.walletAddress,
      authorProfileExists: !!maybeAuthorProfile?.exists,
      disputeId: input.disputeId,
      disputeExists: !!maybeAuthorDispute?.exists,
      skillListingProvided: !!input.skillListing,
      skillListingExists: !!maybeSkillListing?.exists,
      skillListingMatchesAuthor:
        !input.skillListing ||
        (!!maybeSkillListing?.exists &&
          maybeSkillListing.data.author === input.authorKey),
      purchaseProvided: !!input.purchase,
      purchaseExists: !!maybePurchase?.exists,
      purchaseMatchesSkillListing:
        !input.purchase ||
        !input.skillListing ||
        (!!maybePurchase?.exists &&
          maybePurchase.data.skillListing === input.skillListing),
      walletBalanceLamports,
      walletUsdcBalanceMicros: usdcAccountState?.exists
        ? usdcAccountState.amount
        : null,
      hasUsdcAccount: usdcAccountState ? usdcAccountState.exists : null,
      disputeBondUsdcMicros: maybeConfig?.exists
        ? BigInt(maybeConfig.data.disputeBondUsdcMicros)
        : null,
    });
    if (guardError) throw new ClusterGuardError(guardError);
  } catch (error) {
    if (error instanceof ClusterGuardError) throw error;
    console.warn("Open author dispute cluster guard skipped:", error);
  }
}

async function assertResolveAuthorDisputeClusterReady(input: {
  walletAddress: Address;
  authorKey: Address;
  disputeId: number | bigint;
}) {
  try {
    const authorProfile = await getAgentPDA(input.authorKey);
    const authorDispute = await getAuthorDisputePDA(
      input.authorKey,
      input.disputeId
    );
    const configPda = await getConfigPDA();
    const [maybeAuthorProfile, maybeAuthorDispute, maybeConfig] =
      await Promise.all([
        fetchMaybeAgentProfile(rpc, authorProfile).catch(() => null),
        fetchMaybeAuthorDispute(rpc, authorDispute).catch(() => null),
        fetchMaybeReputationConfig(rpc, configPda).catch(() => null),
      ]);

    const guardError = getResolveAuthorDisputeClusterGuardError({
      walletAddress: input.walletAddress,
      authorProfileExists: !!maybeAuthorProfile?.exists,
      disputeId: input.disputeId,
      disputeExists: !!maybeAuthorDispute?.exists,
      disputeOpen:
        !!maybeAuthorDispute?.exists &&
        maybeAuthorDispute.data.status === AuthorDisputeStatus.Open,
      resolverAuthorized:
        !!maybeConfig?.exists &&
        maybeConfig.data.authority === input.walletAddress,
    });
    if (guardError) throw new ClusterGuardError(guardError);
  } catch (error) {
    if (error instanceof ClusterGuardError) throw error;
    console.warn("Resolve author dispute cluster guard skipped:", error);
  }
}

async function waitForConfirmedSignature(
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

export function useReputationOracle() {
  const { status, account } = useAgentVouchWallet();
  const connected = status === "connected" && !!account;
  const { signer: activeSigner } = useAgentVouchTransactionSigner();

  const walletAddress: Address | null = connected ? (account as Address) : null;

  const signer: TransactionSigner | null = activeSigner ?? null;

  const sendIx = useCallback(
    async (
      ix: SendInstruction | readonly SendInstruction[],
      summary?: AgentVouchTransactionSummary
    ) => {
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
              "logs" in
                ((cause as { context: { logs?: unknown } }).context ?? {})
            ? (cause as { context: { logs?: unknown[] } }).context.logs ?? null
            : null;
        if (logs?.length) console.error("Simulation logs:", logs);
        if (cause) {
          console.error("Transaction failed (cause):", cause);
          throw cause;
        }
        throw new Error(getErrorMessage(error));
      }
    },
    [walletAddress, signer]
  );

  const registerAgent = useCallback(
    async (metadataUri: string) => {
      if (!signer || !walletAddress) throw new Error("Wallet not connected");
      const authorAddress = getConnectedAuthorAddress(walletAddress, signer);
      await assertRegisterAgentClusterReady(walletAddress);
      const ix = await getRegisterAgentInstructionAsync({
        authority: signer,
        metadataUri,
      });
      const tx = await sendIx(ix);
      const agentProfile = await getAgentPDA(authorAddress);
      return { tx, agentProfile };
    },
    [signer, walletAddress, sendIx]
  );

  /**
   * Migrate an existing AgentProfile PDA to the current struct layout.
   * Required when the on-chain struct changed and the stored bump is stale,
   * which causes ConstraintSeeds failures in createSkillListing and other
   * instructions that read author_profile.bump.
   */
  const migrateAgent = useCallback(
    async (metadataUri = "") => {
      if (!signer || !walletAddress) throw new Error("Wallet not connected");
      void metadataUri;
      throw new Error("Agent profile migration is not available in v0.2.0");
    },
    [signer, walletAddress]
  );

  const depositAuthorBond = useCallback(
    async (amountUsdc: number) => {
      if (!signer || !walletAddress) throw new Error("Wallet not connected");
      await assertBondConfigClusterReady();
      const authorAddress = getConnectedAuthorAddress(walletAddress, signer);
      const amountUsdcMicros = usdcToMicros(amountUsdc);
      const usdcMint = await getProtocolUsdcMint();
      const [
        authorProfile,
        authorBond,
        config,
        authorUsdcAccount,
        authorBondVaultAuthority,
        authorBondVault,
      ] = await Promise.all([
        getAgentPDA(authorAddress),
        getAuthorBondPDA(authorAddress),
        getConfigPDA(),
        getAssociatedTokenAccount(authorAddress, usdcMint),
        getAuthorBondVaultAuthorityPDA(authorAddress),
        getAuthorBondVaultPDA(authorAddress),
      ]);
      await assertUsdcAccountReady({
        rpc,
        owner: authorAddress,
        mint: usdcMint,
        purpose: "Author bond deposit",
        minimumBalanceUsdcMicros: amountUsdcMicros,
      });
      const ix = await getDepositAuthorBondInstructionAsync({
        authorBond,
        authorProfile,
        config,
        usdcMint,
        authorUsdcAccount,
        authorBondVaultAuthority,
        authorBondVault,
        author: signer,
        amountUsdcMicros,
      });
      const summary = {
        action: "Deposit author bond",
        token: "USDC" as const,
        amountUsdcMicros,
        vault: authorBondVault,
        feePayer: signer.address,
        cluster: getConfiguredNetworkDescription(),
      };
      return { tx: await sendIx(ix, summary), authorBond, summary };
    },
    [signer, walletAddress, sendIx]
  );

  const withdrawAuthorBond = useCallback(
    async (amountUsdc: number) => {
      if (!signer || !walletAddress) throw new Error("Wallet not connected");
      await assertBondConfigClusterReady();
      const authorAddress = getConnectedAuthorAddress(walletAddress, signer);
      const amountUsdcMicros = usdcToMicros(amountUsdc);
      const usdcMint = await getProtocolUsdcMint();
      const [
        authorProfile,
        authorBond,
        config,
        authorUsdcAccount,
        authorBondVaultAuthority,
        authorBondVault,
      ] = await Promise.all([
        getAgentPDA(authorAddress),
        getAuthorBondPDA(authorAddress),
        getConfigPDA(),
        getAssociatedTokenAccount(authorAddress, usdcMint),
        getAuthorBondVaultAuthorityPDA(authorAddress),
        getAuthorBondVaultPDA(authorAddress),
      ]);
      const createAuthorAtaIx =
        getCreateAssociatedTokenAccountIdempotentInstruction({
          payer: signer,
          associatedTokenAccount: authorUsdcAccount,
          owner: authorAddress,
          mint: usdcMint,
        });
      const ix = await getWithdrawAuthorBondInstructionAsync({
        authorBond,
        authorProfile,
        config,
        usdcMint,
        authorBondVaultAuthority,
        authorBondVault,
        authorUsdcAccount,
        author: signer,
        amountUsdcMicros,
      });
      const summary = {
        action: "Withdraw author bond",
        token: "USDC" as const,
        amountUsdcMicros,
        recipient: authorUsdcAccount,
        vault: authorBondVault,
        feePayer: signer.address,
        cluster: getConfiguredNetworkDescription(),
      };
      return {
        tx: await sendIx([createAuthorAtaIx, ix], summary),
        authorBond,
        summary,
      };
    },
    [signer, walletAddress, sendIx]
  );

  const vouch = useCallback(
    async (voucheeKey: Address, amountUsdc: number) => {
      if (!signer || !walletAddress) throw new Error("Wallet not connected");
      const voucherAddress = getConnectedAuthorAddress(walletAddress, signer);
      const amountUsdcMicros = usdcToMicros(amountUsdc);
      const usdcMint = await getProtocolUsdcMint();
      const [voucherProfile, voucheeProfile] = await Promise.all([
        getAgentPDA(voucherAddress),
        getAgentPDA(voucheeKey),
      ]);
      await assertStakeActionClusterReady({
        action: "vouch",
        walletAddress,
        voucheeProfile,
        requiredUsdcMicros: amountUsdcMicros,
      });
      const [
        voucherUsdcAccount,
        vouchVaultAuthority,
        vouchVault,
        authorRewardVaultAuthority,
        authorRewardVault,
      ] = await Promise.all([
        getAssociatedTokenAccount(voucherAddress, usdcMint),
        getVouchVaultAuthorityPDA(voucherProfile, voucheeProfile),
        getVouchVaultPDA(voucherProfile, voucheeProfile),
        getAuthorRewardVaultAuthorityPDA(voucheeProfile),
        getAuthorRewardVaultPDA(voucheeProfile),
      ]);
      await assertUsdcAccountReady({
        rpc,
        owner: voucherAddress,
        mint: usdcMint,
        purpose: "Vouch",
        minimumBalanceUsdcMicros: amountUsdcMicros,
      });
      const ix = await getVouchInstructionAsync({
        voucherProfile,
        voucheeProfile,
        usdcMint,
        voucherUsdcAccount,
        vouchVaultAuthority,
        vouchVault,
        authorRewardVaultAuthority,
        authorRewardVault,
        voucher: signer,
        stakeUsdcMicros: amountUsdcMicros,
      });
      const summary = {
        action: "Vouch",
        token: "USDC" as const,
        amountUsdcMicros,
        vault: vouchVault,
        feePayer: signer.address,
        cluster: getConfiguredNetworkDescription(),
      };
      return { tx: await sendIx(ix, summary), summary };
    },
    [signer, walletAddress, sendIx]
  );

  const revokeVouch = useCallback(
    async (voucheeKey: Address) => {
      if (!signer || !walletAddress) throw new Error("Wallet not connected");
      const voucheeProfile = await getAgentPDA(voucheeKey);
      await assertStakeActionClusterReady({
        action: "revoke",
        walletAddress,
        voucheeProfile,
      });
      const voucherAddress = getConnectedAuthorAddress(walletAddress, signer);
      const usdcMint = await getProtocolUsdcMint();
      const voucherProfile = await getAgentPDA(voucherAddress);
      const [vouch, vouchVaultAuthority, vouchVault, voucherUsdcAccount] =
        await Promise.all([
          getVouchPDA(voucherProfile, voucheeProfile),
          getVouchVaultAuthorityPDA(voucherProfile, voucheeProfile),
          getVouchVaultPDA(voucherProfile, voucheeProfile),
          getAssociatedTokenAccount(voucherAddress, usdcMint),
        ]);
      const createVoucherAtaIx =
        getCreateAssociatedTokenAccountIdempotentInstruction({
          payer: signer,
          associatedTokenAccount: voucherUsdcAccount,
          owner: voucherAddress,
          mint: usdcMint,
        });
      const ix = await getRevokeVouchInstructionAsync({
        vouch,
        voucherProfile,
        voucheeProfile,
        usdcMint,
        vouchVaultAuthority,
        vouchVault,
        voucherUsdcAccount,
        voucher: signer,
      });
      const summary = {
        action: "Revoke vouch",
        token: "USDC" as const,
        recipient: voucherUsdcAccount,
        vault: vouchVault,
        feePayer: signer.address,
        cluster: getConfiguredNetworkDescription(),
      };
      return { tx: await sendIx([createVoucherAtaIx, ix], summary), summary };
    },
    [signer, walletAddress, sendIx]
  );

  const getConfig = useCallback(async (): Promise<ReputationConfig | null> => {
    try {
      const configPda = await getConfigPDA();
      const account = await fetchMaybeReputationConfig(rpc, configPda);
      if (!account.exists) return null;
      return account.data;
    } catch {
      return null;
    }
  }, []);

  const getAuthorDisputeByAddress = useCallback(
    async (disputeAddress: Address) => {
      try {
        const account = await fetchMaybeAuthorDispute(rpc, disputeAddress);
        if (!account.exists) return null;
        return account.data;
      } catch {
        return null;
      }
    },
    []
  );

  const getAuthorDisputesByAuthor = useCallback(async (authorKey: Address) => {
    return listAuthorDisputesByAuthor(String(authorKey));
  }, []);

  const getAuthorDisputeLinks = useCallback(
    async (authorDisputeAddress: Address) => {
      return listAuthorDisputeLinks(String(authorDisputeAddress));
    },
    []
  );

  const getAllAuthorDisputes = useCallback(async () => {
    try {
      const accounts = await rpc
        .getProgramAccounts(AGENTVOUCH_PROGRAM_ADDRESS, {
          encoding: "base64",
          filters: [
            {
              memcmp: {
                offset: 0n,
                bytes: asBase64(AUTHOR_DISPUTE_DISCRIMINATOR),
                encoding: "base64",
              },
            },
          ],
        })
        .send();
      const decoder = getAuthorDisputeDecoder();
      const records = accounts.map((account) => ({
        publicKey: account.pubkey,
        account: decoder.decode(decodeBase64(account.account.data[0])),
      }));
      const linkedVouchesByDispute = new Map<string, string[]>();
      await Promise.all(
        records.map(async (record) => {
          const linkedVouches = await listAuthorDisputeLinks(record.publicKey);
          linkedVouchesByDispute.set(record.publicKey, linkedVouches);
        })
      );
      return records
        .map((record) => {
          const reasonLabel =
            AuthorDisputeReason[record.account.reason] ?? "Unknown";
          const statusLabel = record.account.status === 0 ? "Open" : "Resolved";
          const rulingOption = record.account.ruling as unknown as
            | { __option?: "Some" | "None"; value?: AuthorDisputeRuling }
            | null
            | undefined;
          const rulingValue =
            rulingOption && rulingOption.__option === "Some"
              ? rulingOption.value ?? null
              : null;
          const rulingLabel =
            rulingValue === null || rulingValue === undefined
              ? null
              : AuthorDisputeRuling[rulingValue] ?? "Unknown";
          const liabilityScopeLabel = getAuthorDisputeLiabilityScopeLabel(
            record.account.liabilityScope
          );
          return {
            publicKey: record.publicKey,
            account: record.account,
            linkedVouches: linkedVouchesByDispute.get(record.publicKey) ?? [],
            reasonLabel,
            statusLabel,
            rulingLabel,
            liabilityScopeLabel,
          };
        })
        .sort(
          (a, b) => Number(b.account.createdAt) - Number(a.account.createdAt)
        );
    } catch (error) {
      console.error("Error fetching author disputes:", error);
      return [];
    }
  }, []);

  const resolveAuthorDispute = useCallback(
    async (
      authorKey: Address,
      disputeId: number | bigint,
      ruling: AuthorDisputeRuling,
      challenger: Address
    ) => {
      if (!signer || !walletAddress) throw new Error("Wallet not connected");
      await assertResolveAuthorDisputeClusterReady({
        walletAddress,
        authorKey,
        disputeId,
      });
      const authorBond = await getAuthorBondPDA(authorKey);
      const [
        authorProfile,
        authorBondAccount,
        configInfo,
        challengerUsdcAccount,
        disputeBondVaultAuthority,
        disputeBondVault,
        authorBondVaultAuthority,
        authorBondVault,
      ] = await Promise.all([
        getAgentPDA(authorKey),
        fetchMaybeAuthorBond(rpc, authorBond).catch(() => null),
        getProtocolConfig(),
        getAssociatedTokenAccount(challenger, await getProtocolUsdcMint()),
        getDisputeBondVaultAuthorityPDA(authorKey, disputeId),
        getDisputeBondVaultPDA(authorKey, disputeId),
        getAuthorBondVaultAuthorityPDA(authorKey),
        getAuthorBondVaultPDA(authorKey),
      ]);
      if (!configInfo.data) throw new Error("Protocol config not found");
      const authorDispute = await getAuthorDisputePDA(authorKey, disputeId);
      const maybeAuthorDisputeAccount = await fetchMaybeAuthorDispute(
        rpc,
        authorDispute
      ).catch(() => null);
      if (!maybeAuthorDisputeAccount?.exists) {
        throw new Error("Author dispute not found");
      }
      const disputeListing =
        maybeAuthorDisputeAccount.data.liabilityScope ===
        AuthorDisputeLiabilityScope.AuthorBondThenVouchers
          ? await fetchMaybeSkillListing(
              rpc,
              maybeAuthorDisputeAccount.data.skillListing
            ).catch(() => null)
          : null;
      const listingSettlement = disputeListing?.exists
        ? disputeListing.data.currentSettlement
        : undefined;
      const createChallengerAtaIx =
        getCreateAssociatedTokenAccountIdempotentInstruction({
          payer: signer,
          associatedTokenAccount: challengerUsdcAccount,
          owner: challenger,
          mint: configInfo.data.usdcMint,
        });
      const ix = getResolveAuthorDisputeInstruction({
        authorDispute,
        authorProfile,
        skillListing: maybeAuthorDisputeAccount.data.skillListing,
        config: configInfo.config,
        authority: signer,
        usdcMint: configInfo.data.usdcMint,
        disputeBondVaultAuthority,
        disputeBondVault,
        protocolTreasuryVault:
          configInfo.data.protocolTreasuryVault ??
          (await getProtocolTreasuryVaultPDA()),
        listingSettlement,
        authorBondVaultAuthority,
        challenger,
        challengerUsdcAccount,
        disputeId,
        ruling,
      });
      const remainingAccounts =
        ruling === AuthorDisputeRuling.Upheld && authorBondAccount?.exists
          ? [
              { address: authorBond, role: 1 },
              { address: authorBondVault, role: 1 },
            ]
          : [];
      const summary = {
        action: "Resolve author dispute",
        token: "USDC" as const,
        recipient:
          ruling === AuthorDisputeRuling.Upheld
            ? challengerUsdcAccount
            : configInfo.data.protocolTreasuryVault,
        vault: disputeBondVault,
        feePayer: signer.address,
        cluster: getConfiguredNetworkDescription(),
      };
      if (
        ruling !== AuthorDisputeRuling.Upheld ||
        maybeAuthorDisputeAccount.data.liabilityScope ===
          AuthorDisputeLiabilityScope.AuthorBondOnly
      ) {
        return {
          tx: await sendIx(
            [
              createChallengerAtaIx,
              { ...ix, accounts: [...ix.accounts, ...remainingAccounts] },
            ],
            summary
          ),
          authorDispute,
          summary,
        };
      }

      return {
        tx: await sendIx(
          [
            createChallengerAtaIx,
            { ...ix, accounts: [...ix.accounts, ...remainingAccounts] },
          ],
          summary
        ),
        authorDispute,
        summary,
      };
    },
    [signer, walletAddress, sendIx]
  );

  const getAgentProfileByAddress = useCallback(
    async (profileAddress: Address) => {
      try {
        const account = await fetchMaybeAgentProfile(rpc, profileAddress);
        if (!account.exists) return null;
        return sanitizeAgentProfile(account.data);
      } catch {
        return null;
      }
    },
    []
  );

  const getAgentProfile = useCallback(
    async (agentKey: Address) => {
      const pda = await getAgentPDA(agentKey);
      return getAgentProfileByAddress(pda);
    },
    [getAgentProfileByAddress]
  );

  const getAuthorBondByAddress = useCallback(async (bondAddress: Address) => {
    try {
      const account = await fetchMaybeAuthorBond(rpc, bondAddress);
      if (!account.exists) return null;
      return account.data;
    } catch {
      return null;
    }
  }, []);

  const getAuthorBond = useCallback(
    async (authorKey: Address) => {
      const bondPda = await getAuthorBondPDA(authorKey);
      return getAuthorBondByAddress(bondPda);
    },
    [getAuthorBondByAddress]
  );

  const getAllAgents = useCallback(async () => {
    try {
      const accounts = await rpc
        .getProgramAccounts(AGENTVOUCH_PROGRAM_ADDRESS, {
          encoding: "base64",
          filters: [
            {
              memcmp: {
                offset: 0n,
                bytes: asBase64(AGENT_PROFILE_DISCRIMINATOR),
                encoding: "base64",
              },
            },
          ],
        })
        .send();
      const decoder = getAgentProfileDecoder();
      return accounts.map((a) => ({
        publicKey: a.pubkey,
        account: sanitizeAgentProfile(
          decoder.decode(decodeBase64(a.account.data[0]))
        ),
      }));
    } catch (e) {
      console.error("Error fetching all agents:", e);
      return [];
    }
  }, []);

  const getAllVouchesForAgent = useCallback(async (agentKey: Address) => {
    try {
      const agentProfile = await getAgentPDA(agentKey);
      const accounts = await rpc
        .getProgramAccounts(AGENTVOUCH_PROGRAM_ADDRESS, {
          encoding: "base64",
          filters: [
            {
              memcmp: {
                offset: 0n,
                bytes: asBase64(VOUCH_DISCRIMINATOR),
                encoding: "base64",
              },
            },
            {
              memcmp: {
                offset: 8n,
                bytes: asBase58(agentProfile),
                encoding: "base58",
              },
            },
          ],
        })
        .send();
      const decoder = getVouchDecoder();
      return accounts.map((a) => ({
        publicKey: a.pubkey,
        account: decoder.decode(decodeBase64(a.account.data[0])),
      }));
    } catch {
      return [];
    }
  }, []);

  const getAllVouchesReceivedByAgent = useCallback(
    async (agentKey: Address) => {
      try {
        const agentProfile = await getAgentPDA(agentKey);
        const accounts = await rpc
          .getProgramAccounts(AGENTVOUCH_PROGRAM_ADDRESS, {
            encoding: "base64",
            filters: [
              {
                memcmp: {
                  offset: 0n,
                  bytes: asBase64(VOUCH_DISCRIMINATOR),
                  encoding: "base64",
                },
              },
              {
                memcmp: {
                  offset: 40n,
                  bytes: asBase58(agentProfile),
                  encoding: "base58",
                },
              },
            ],
          })
          .send();
        const decoder = getVouchDecoder();
        return accounts.map((a) => ({
          publicKey: a.pubkey,
          account: decoder.decode(decodeBase64(a.account.data[0])),
        }));
      } catch {
        return [];
      }
    },
    []
  );

  const getAllSkillListings = useCallback(async () => {
    try {
      const accounts = await rpc
        .getProgramAccounts(AGENTVOUCH_PROGRAM_ADDRESS, {
          encoding: "base64",
          filters: [
            {
              memcmp: {
                offset: 0n,
                bytes: asBase64(SKILL_LISTING_DISCRIMINATOR),
                encoding: "base64",
              },
            },
          ],
        })
        .send();
      const decoder = getSkillListingDecoder();
      return accounts.map((a) => ({
        publicKey: a.pubkey,
        lamports: Number(a.account.lamports),
        account: decoder.decode(decodeBase64(a.account.data[0])),
      }));
    } catch (e) {
      console.error("Error fetching skill listings:", e);
      return [];
    }
  }, []);

  const getSkillListingsByAuthor = useCallback(async (author: Address) => {
    try {
      const accounts = await rpc
        .getProgramAccounts(AGENTVOUCH_PROGRAM_ADDRESS, {
          encoding: "base64",
          filters: [
            {
              memcmp: {
                offset: 0n,
                bytes: asBase64(SKILL_LISTING_DISCRIMINATOR),
                encoding: "base64",
              },
            },
            {
              memcmp: {
                offset: 8n,
                bytes: asBase58(author),
                encoding: "base58",
              },
            },
          ],
        })
        .send();
      const decoder = getSkillListingDecoder();
      return accounts.map((a) => ({
        publicKey: a.pubkey,
        lamports: Number(a.account.lamports),
        account: decoder.decode(decodeBase64(a.account.data[0])),
      }));
    } catch {
      return [];
    }
  }, []);

  const getAllPurchases = useCallback(async () => {
    try {
      const accounts = await rpc
        .getProgramAccounts(AGENTVOUCH_PROGRAM_ADDRESS, {
          encoding: "base64",
          filters: [
            {
              memcmp: {
                offset: 0n,
                bytes: asBase64(PURCHASE_DISCRIMINATOR),
                encoding: "base64",
              },
            },
          ],
        })
        .send();
      const decoder = getPurchaseDecoder();
      return accounts.map((a) => ({
        publicKey: a.pubkey,
        account: decoder.decode(decodeBase64(a.account.data[0])),
      }));
    } catch {
      return [];
    }
  }, []);

  const getPurchasesByBuyer = useCallback(async (buyer: Address) => {
    try {
      const accounts = await rpc
        .getProgramAccounts(AGENTVOUCH_PROGRAM_ADDRESS, {
          encoding: "base64",
          filters: [
            {
              memcmp: {
                offset: 0n,
                bytes: asBase64(PURCHASE_DISCRIMINATOR),
                encoding: "base64",
              },
            },
            {
              memcmp: {
                offset: 8n,
                bytes: asBase58(buyer),
                encoding: "base58",
              },
            },
          ],
        })
        .send();
      const decoder = getPurchaseDecoder();
      return accounts.map((a) => ({
        publicKey: a.pubkey,
        account: decoder.decode(decodeBase64(a.account.data[0])),
      }));
    } catch (error) {
      console.error("Error fetching purchases by buyer:", error);
      throw wrapRpcLookupError(error, "Failed to fetch purchases by buyer");
    }
  }, []);

  const getPurchasedSkillListingKeys = useCallback(
    async (buyer: Address, skillListings: Address[]) => {
      if (skillListings.length === 0) return new Set<string>();
      try {
        const listings = await fetchAllMaybeSkillListing(rpc, skillListings);
        const purchaseAddresses = await Promise.all(
          skillListings.map((skillListing, index) =>
            getPurchasePDA(
              buyer,
              skillListing,
              listings[index]?.exists
                ? listings[index].data.currentRevision
                : 0n
            )
          )
        );
        const maybePurchases = await fetchAllMaybePurchase(
          rpc,
          purchaseAddresses
        );

        return new Set(
          skillListings
            .filter((_, index) => maybePurchases[index]?.exists)
            .map((skillListing) => String(skillListing))
        );
      } catch (error) {
        console.error("Error resolving purchased skill flags:", error);
        throw wrapRpcLookupError(
          error,
          "Failed to resolve purchased skill flags"
        );
      }
    },
    []
  );

  const openAuthorDispute = useCallback(
    async (
      authorKey: Address,
      params: {
        reason: AuthorDisputeReason;
        evidenceUri: string;
        skillListing: Address;
        purchase?: Address;
        disputeId?: number | bigint;
      }
    ) => {
      if (!signer || !walletAddress) throw new Error("Wallet not connected");

      const disputeId = params.disputeId ?? BigInt(Date.now());
      await assertOpenAuthorDisputeClusterReady({
        walletAddress,
        authorKey,
        disputeId,
        skillListing: params.skillListing,
        purchase: params.purchase,
      });
      const { config, data: protocolConfig } = await getProtocolConfig();
      if (!protocolConfig) throw new Error("Protocol config not found");
      const usdcMint = protocolConfig.usdcMint;
      const [
        authorProfile,
        authorDispute,
        challengerUsdcAccount,
        disputeBondVaultAuthority,
        disputeBondVault,
      ] = await Promise.all([
        getAgentPDA(authorKey),
        getAuthorDisputePDA(authorKey, disputeId),
        getAssociatedTokenAccount(walletAddress, usdcMint),
        getDisputeBondVaultAuthorityPDA(authorKey, disputeId),
        getDisputeBondVaultPDA(authorKey, disputeId),
      ]);
      await assertUsdcAccountReady({
        rpc,
        owner: walletAddress,
        mint: usdcMint,
        purpose: "Author dispute bond",
        minimumBalanceUsdcMicros: BigInt(protocolConfig.disputeBondUsdcMicros),
      });
      const backingVouches = (
        await getAllVouchesReceivedByAgent(authorKey)
      ).filter((vouch) =>
        countsTowardAuthorWideReportSnapshot(vouch.account.status)
      );
      const uniqueBackingVouches = [
        ...new Set(backingVouches.map((vouch) => vouch.publicKey)),
      ].map((vouch) => address(vouch));
      const listing = await fetchMaybeSkillListing(rpc, params.skillListing);
      if (!listing.exists) throw new Error("Skill listing not found");
      const listingSettlement =
        listing.data.priceUsdcMicros > 0n
          ? listing.data.currentSettlement
          : undefined;
      const openIx = await getOpenAuthorDisputeInstructionAsync({
        authorDispute,
        authorProfile,
        config,
        skillListing: params.skillListing,
        purchase: params.purchase,
        listingSettlement,
        usdcMint,
        challengerUsdcAccount,
        disputeBondVaultAuthority,
        disputeBondVault,
        challenger: signer,
        disputeId,
        reason: params.reason,
        evidenceUri: params.evidenceUri,
      });
      const remainingAccounts = await Promise.all(
        uniqueBackingVouches.map(async (vouch) => {
          const authorDisputeVouchLink = await getAuthorDisputeVouchLinkPDA(
            authorDispute,
            vouch
          );
          return [
            { address: authorDisputeVouchLink, role: 1 },
            { address: vouch, role: 0 },
          ];
        })
      );
      const summary = {
        action: "Open author dispute",
        token: "USDC" as const,
        amountUsdcMicros: BigInt(protocolConfig.disputeBondUsdcMicros),
        vault: disputeBondVault,
        feePayer: signer.address,
        cluster: getConfiguredNetworkDescription(),
      };
      const tx = await sendIx(
        {
          ...openIx,
          accounts: [...openIx.accounts, ...remainingAccounts.flat()],
        },
        summary
      );

      return {
        tx,
        authorDispute,
        disputeId,
        linkedVouches: uniqueBackingVouches,
        summary,
      };
    },
    [getAllVouchesReceivedByAgent, signer, walletAddress, sendIx]
  );

  const createSkillListing = useCallback(
    async (
      skillId: string,
      skillUri: string,
      name: string,
      description: string,
      priceUsdcMicros: number
    ) => {
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
      const [authorProceedsVaultAuthority, authorProceedsVault] =
        await Promise.all([
          getAuthorProceedsVaultAuthorityPDA(listingSettlement),
          getAuthorProceedsVaultPDA(listingSettlement),
        ]);
      const ix = await getCreateSkillListingInstructionAsync({
        skillListing,
        authorProfile,
        config,
        authorBond: priceUsdcMicros === 0 ? authorBond : undefined,
        usdcMint,
        listingSettlement,
        authorProceedsVaultAuthority,
        authorProceedsVault,
        author: signer,
        skillId,
        skillUri,
        name,
        description,
        priceUsdcMicros: BigInt(priceUsdcMicros),
      });
      const summary = {
        action: "Create skill listing",
        token: "USDC" as const,
        amountUsdcMicros: BigInt(priceUsdcMicros),
        vault: authorProceedsVault,
        feePayer: signer.address,
        cluster: getConfiguredNetworkDescription(),
      };
      return { tx: await sendIx(ix, summary), summary };
    },
    [signer, walletAddress, sendIx]
  );

  const updateSkillListing = useCallback(
    async (
      skillId: string,
      skillUri: string,
      name: string,
      description: string,
      priceUsdcMicros: number
    ) => {
      if (!signer || !walletAddress) throw new Error("Wallet not connected");
      const authorAddress = getConnectedAuthorAddress(walletAddress, signer);
      await assertSkillListingClusterReady({
        walletAddress: authorAddress,
        skillId,
        mode: "update",
      });
      const { authorProfile, authorBond, config, skillListing } =
        await resolveSkillListingAccounts(authorAddress, skillId);
      const existingListing = await fetchMaybeSkillListing(
        rpc,
        skillListing
      ).catch(() => null);
      const ix = await getUpdateSkillListingInstructionAsync({
        skillListing,
        authorProfile,
        config,
        authorBond: priceUsdcMicros === 0 ? authorBond : undefined,
        author: signer,
        skillId,
        skillUri,
        name,
        description,
        priceUsdcMicros: BigInt(priceUsdcMicros),
      });
      const summary = {
        action: "Update skill listing",
        token: "USDC" as const,
        amountUsdcMicros: BigInt(priceUsdcMicros),
        feePayer: signer.address,
        cluster: getConfiguredNetworkDescription(),
      };
      const followupIxs: SendInstruction[] = [ix as SendInstruction];
      if (
        existingListing?.exists &&
        (existingListing.data.skillUri !== skillUri ||
          existingListing.data.priceUsdcMicros !== BigInt(priceUsdcMicros))
      ) {
        const nextRevision = existingListing.data.currentRevision + 1n;
        const listingSettlement = await getListingSettlementPDA(
          skillListing,
          nextRevision
        );
        followupIxs.push(
          (await getInitializeListingSettlementInstructionAsync({
            skillListing,
            config,
            usdcMint: await getProtocolUsdcMint(),
            listingSettlement,
            authorProceedsVaultAuthority:
              await getAuthorProceedsVaultAuthorityPDA(listingSettlement),
            authorProceedsVault: await getAuthorProceedsVaultPDA(
              listingSettlement
            ),
            author: signer,
          })) as SendInstruction
        );
      }
      return { tx: await sendIx(followupIxs, summary), summary };
    },
    [signer, walletAddress, sendIx]
  );

  const removeSkillListing = useCallback(
    async (skillId: string) => {
      if (!signer || !walletAddress) throw new Error("Wallet not connected");
      const authorAddress = getConnectedAuthorAddress(walletAddress, signer);
      const { authorProfile, skillListing } = await resolveSkillListingAccounts(
        authorAddress,
        skillId
      );
      const ix = await getRemoveSkillListingInstructionAsync({
        skillListing,
        authorProfile,
        author: signer,
        skillId,
      });
      return { tx: await sendIx(ix) };
    },
    [signer, walletAddress, sendIx]
  );

  const closeSkillListing = useCallback(
    async (skillId: string) => {
      if (!signer || !walletAddress) throw new Error("Wallet not connected");
      const authorAddress = getConnectedAuthorAddress(walletAddress, signer);
      const { authorProfile, skillListing } = await resolveSkillListingAccounts(
        authorAddress,
        skillId
      );
      const ix = await getCloseSkillListingInstructionAsync({
        skillListing,
        authorProfile,
        author: signer,
        skillId,
      });
      return { tx: await sendIx(ix) };
    },
    [signer, walletAddress, sendIx]
  );

  const purchaseSkill = useCallback(
    async (skillListingKey: Address, authorKey: Address) => {
      if (!signer || !walletAddress) throw new Error("Wallet not connected");
      const listing = await fetchMaybeSkillListing(rpc, skillListingKey);
      if (!listing.exists) throw new Error("Skill listing not found");
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
      let purchaseEstimate: PurchasePreflightAssessment | null = null;
      try {
        purchaseEstimate = await estimatePurchasePreflight(
          walletAddress,
          skillListingKey,
          authorKey
        );
        if (
          purchaseEstimate.purchasePreflightStatus ===
          "buyerInsufficientBalance"
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

      const usdcMint = await getProtocolUsdcMint();
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
        return { tx: await sendIx(ix, summary), summary };
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
              authorKey
            ).catch(() => null));
          if (latestEstimate) {
            if (
              latestEstimate.purchasePreflightStatus ===
              "buyerInsufficientBalance"
            ) {
              throw new Error(
                buildPurchaseBalanceError(walletAddress, latestEstimate)
              );
            }
            if (
              latestEstimate.purchasePreflightStatus ===
              "authorPayoutRentBlocked"
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
    },
    [signer, walletAddress, sendIx]
  );

  const getListingSettlement = useCallback(async (skillListingKey: Address) => {
    const listing = await fetchMaybeSkillListing(rpc, skillListingKey);
    if (!listing.exists || !listing.data.currentSettlement) return null;
    const settlement = await fetchMaybeListingSettlement(
      rpc,
      listing.data.currentSettlement
    ).catch(() => null);
    return settlement?.exists
      ? { publicKey: listing.data.currentSettlement, account: settlement.data }
      : null;
  }, []);

  const withdrawAuthorProceeds = useCallback(
    async (skillListingKey: Address, amountUsdcMicros?: bigint | number) => {
      if (!signer || !walletAddress) throw new Error("Wallet not connected");
      const listing = await fetchMaybeSkillListing(rpc, skillListingKey);
      if (!listing.exists) throw new Error("Skill listing not found");
      if (listing.data.author !== signer.address) {
        throw new Error("Only the listing author can withdraw proceeds");
      }
      const settlement = await fetchMaybeListingSettlement(
        rpc,
        listing.data.currentSettlement
      );
      if (!settlement.exists) throw new Error("Listing settlement not found");
      const amount =
        amountUsdcMicros === undefined
          ? settlement.data.withdrawableAuthorProceedsUsdcMicros
          : BigInt(amountUsdcMicros);
      if (amount <= 0n) {
        throw new Error("No withdrawable author proceeds");
      }
      const usdcMint = await getProtocolUsdcMint();
      const authorUsdcAccount = await getAssociatedTokenAccount(
        walletAddress,
        usdcMint
      );
      const createAuthorAtaIx =
        getCreateAssociatedTokenAccountIdempotentInstruction({
          payer: signer,
          associatedTokenAccount: authorUsdcAccount,
          owner: walletAddress,
          mint: usdcMint,
        });
      const ix = await getWithdrawAuthorProceedsInstructionAsync({
        skillListing: skillListingKey,
        listingSettlement: listing.data.currentSettlement,
        usdcMint,
        authorProceedsVaultAuthority: await getAuthorProceedsVaultAuthorityPDA(
          listing.data.currentSettlement
        ),
        authorProceedsVault: listing.data.currentAuthorProceedsVault,
        authorUsdcAccount,
        author: signer,
        amountUsdcMicros: amount,
      });
      const summary = {
        action: "Withdraw author proceeds",
        token: "USDC" as const,
        amountUsdcMicros: amount,
        recipient: authorUsdcAccount,
        vault: listing.data.currentAuthorProceedsVault,
        feePayer: signer.address,
        cluster: getConfiguredNetworkDescription(),
      };
      return {
        tx: await sendIx([createAuthorAtaIx, ix], summary),
        summary,
      };
    },
    [signer, walletAddress, sendIx]
  );

  const claimVoucherRevenue = useCallback(
    async (authorKey: Address) => {
      if (!signer || !walletAddress) throw new Error("Wallet not connected");
      const voucherAddress = getConnectedAuthorAddress(walletAddress, signer);
      const usdcMint = await getProtocolUsdcMint();
      const [authorProfile, voucherProfile] = await Promise.all([
        getAgentPDA(authorKey),
        getAgentPDA(voucherAddress),
      ]);
      const vouch = await getVouchPDA(voucherProfile, authorProfile);
      const [
        authorRewardVaultAuthority,
        authorRewardVault,
        voucherUsdcAccount,
      ] = await Promise.all([
        getAuthorRewardVaultAuthorityPDA(authorProfile),
        getAuthorRewardVaultPDA(authorProfile),
        getAssociatedTokenAccount(voucherAddress, usdcMint),
      ]);
      const createVoucherAtaIx =
        getCreateAssociatedTokenAccountIdempotentInstruction({
          payer: signer,
          associatedTokenAccount: voucherUsdcAccount,
          owner: voucherAddress,
          mint: usdcMint,
        });
      const ix = await getClaimVoucherRevenueInstructionAsync({
        authorProfile,
        vouch,
        voucherProfile,
        usdcMint,
        authorRewardVaultAuthority,
        authorRewardVault,
        voucherUsdcAccount,
        voucher: signer,
      });
      const summary = {
        action: "Claim voucher revenue",
        token: "USDC" as const,
        recipient: voucherUsdcAccount,
        vault: authorRewardVault,
        feePayer: signer.address,
        cluster: getConfiguredNetworkDescription(),
      };
      const tx = await sendIx([createVoucherAtaIx, ix], summary);
      return { tx, vouch, voucherProfile, authorProfile, summary };
    },
    [signer, walletAddress, sendIx]
  );

  return useMemo(
    () => ({
      connected: !!connected,
      walletAddress,
      registerAgent,
      migrateAgent,
      depositAuthorBond,
      withdrawAuthorBond,
      vouch,
      revokeVouch,
      openAuthorDispute,
      resolveAuthorDispute,
      getConfig,
      getAgentProfile,
      getAgentProfileByAddress,
      getAuthorBond,
      getAuthorBondByAddress,
      getAuthorDisputeByAddress,
      getAuthorDisputesByAuthor,
      getAuthorDisputeLinks,
      getAllAuthorDisputes,
      getAllVouchesForAgent,
      getAllVouchesReceivedByAgent,
      getAllAgents,
      getAllSkillListings,
      getSkillListingsByAuthor,
      getAllPurchases,
      getPurchasesByBuyer,
      getPurchasedSkillListingKeys,
      createSkillListing,
      updateSkillListing,
      removeSkillListing,
      closeSkillListing,
      purchaseSkill,
      getListingSettlement,
      withdrawAuthorProceeds,
      claimVoucherRevenue,
      getAgentPDA,
      getAuthorBondPDA,
      getVouchPDA,
      getConfigPDA,
      getAuthorDisputePDA,
      getAuthorDisputeVouchLinkPDA,
      getSkillListingPDA,
      getPurchasePDA,
    }),
    [
      connected,
      walletAddress,
      registerAgent,
      migrateAgent,
      depositAuthorBond,
      withdrawAuthorBond,
      vouch,
      revokeVouch,
      openAuthorDispute,
      resolveAuthorDispute,
      getConfig,
      getAgentProfile,
      getAgentProfileByAddress,
      getAuthorBond,
      getAuthorBondByAddress,
      getAuthorDisputeByAddress,
      getAuthorDisputesByAuthor,
      getAuthorDisputeLinks,
      getAllAuthorDisputes,
      getAllVouchesForAgent,
      getAllVouchesReceivedByAgent,
      getAllAgents,
      getAllSkillListings,
      getSkillListingsByAuthor,
      getAllPurchases,
      getPurchasesByBuyer,
      getPurchasedSkillListingKeys,
      createSkillListing,
      updateSkillListing,
      removeSkillListing,
      closeSkillListing,
      purchaseSkill,
      getListingSettlement,
      withdrawAuthorProceeds,
      claimVoucherRevenue,
    ]
  );
}
