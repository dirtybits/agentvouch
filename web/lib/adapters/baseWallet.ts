"use client";

import {
  createWebAuthnCredential,
  createBundlerClient,
  toCoinbaseSmartAccount,
  toWebAuthnAccount,
  type SmartAccount,
} from "viem/account-abstraction";
import {
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseUnits,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import { BASE_SEPOLIA_CHAIN_CONTEXT } from "@/lib/chains";
import {
  AGENTVOUCH_EVM_READ_ABI,
  LISTING_STATUS_ACTIVE,
} from "./agentVouchEvmAbi";
import {
  BASE_AGENTVOUCH_CONTRACT_ADDRESS,
  BASE_CDP_PAYMASTER_RPC_URL,
  BASE_NATIVE_USDC_ADDRESS,
  BASE_PASSKEY_WALLET_NAME,
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_EXPLORER_URL,
  BASE_SEPOLIA_RPC_URL,
  BASE_USDC_ADDRESS,
  BASE_USDC_DECIMALS,
  BASE_WALLET_UNCONFIGURED_MESSAGE,
  getBaseWalletConfig,
} from "./baseWalletConfig";
import type {
  ChainWallet,
  ClaimVoucherRevenueInput,
  CreateSkillListingInput,
  DepositAuthorBondInput,
  OpenAuthorReportInput,
  OpenAuthorReportResult,
  PurchaseSkillResult,
  PurchaseSkillInput,
  RevokeVouchInput,
  TxResult,
  VouchForAuthorInput,
  WithdrawAuthorBondInput,
  WithdrawAuthorProceedsInput,
} from "./types";
import {
  computeListingId,
  requireBaseBytes32,
  requireBaseEvmAddress,
  skillIdHashFrom,
} from "./baseListing";

export { computeListingId, skillIdHashFrom } from "./baseListing";

const PASSKEY_STORAGE_KEY = "agentvouch:base-sepolia:passkey";
const PASSKEY_ACTIVE_STORAGE_KEY = "agentvouch:base-sepolia:passkey:active";
const OPEN_REPORT_SELECTOR = "92e928f4";
const BASE_AUTHOR_REPORTS_UNAVAILABLE_MESSAGE =
  "Base author reports are not deployed on the configured Base contract yet. Deploy the Phase 9 Base v1 contract or update NEXT_PUBLIC_BASE_AGENTVOUCH_ADDRESS before opening reports.";

export const AGENTVOUCH_EVM_WRITE_ABI = parseAbi([
  ...AGENTVOUCH_EVM_READ_ABI,
  "function registerAgent(string metadataUri)",
  "function depositAuthorBond(uint256 amount)",
  "function withdrawAuthorBond(uint256 amount)",
  "function vouch(address vouchee, uint256 stake)",
  "function revokeVouch(address vouchee)",
  "function createSkillListing(bytes32 skillIdHash, string uri, string name, string description, uint256 priceUsdcMicros) returns (bytes32)",
  "function purchaseSkill(bytes32 id) returns (bytes32)",
  "function openReport(address author, string evidenceUri) returns (uint64)",
  "function claimVoucherRevenue(address author)",
  "function withdrawAuthorProceeds(bytes32 id, uint64 revision, uint256 amount)",
  "function purchaseId(address buyer, bytes32 id, uint64 revision) pure returns (bytes32)",
  "function getPurchase(bytes32 pId) view returns (bool exists, address buyer, bytes32 listingId, uint64 revision, uint256 priceUsdcMicros, uint256 authorShareUsdcMicros, uint256 voucherPoolUsdcMicros, uint64 timestamp)",
  "event AgentRegistered(address indexed agent, string metadataUri, uint64 registeredAt)",
  "event AuthorBondDeposited(address indexed author, uint256 amount, uint256 newBalance)",
  "event AuthorBondWithdrawn(address indexed author, uint256 amount, uint256 newBalance)",
  "event Vouched(address indexed voucher, address indexed vouchee, uint256 stake)",
  "event VouchRevoked(address indexed voucher, address indexed vouchee, uint256 returned)",
  "event SkillPurchased(bytes32 indexed purchaseId, bytes32 indexed listingId, address indexed buyer, uint64 revision, uint256 price, uint256 authorShare, uint256 voucherPool)",
  "event VoucherRevenueClaimed(address indexed voucher, address indexed author, uint256 amount)",
  "event AuthorProceedsWithdrawn(bytes32 indexed listingId, uint64 revision, address indexed author, uint256 amount)",
]);

type StoredCredential = { id: string; publicKey: Hex };

export type BasePasskeySmartAccount = SmartAccount;

export type BaseContractWriteConfig = {
  agentVouchAddress: Address;
  usdcAddress: Address;
};

type BasePaymasterWriteConfig = BaseContractWriteConfig & {
  paymasterRpcUrl: string;
};

export type BasePurchaseApprovalPlan = {
  resetAllowance: boolean;
  approvePrice: boolean;
};

type RawListing = {
  author: Address;
  skillIdHash: Hex;
  uri: string;
  name: string;
  description: string;
  priceUsdcMicros: bigint;
  currentRevision: bigint;
  totalDownloads: bigint;
  totalRevenueUsdcMicros: bigint;
  status: number;
  lockedByDispute: boolean;
  exists: boolean;
};

type RawPurchase = {
  exists: boolean;
  buyer: Address;
  listingId: Hex;
  revision: bigint;
  priceUsdcMicros: bigint;
};

type RawPurchaseTuple = Partial<RawPurchase> & {
  [index: number]: unknown;
};

type BaseUserOperationResult = TxResult & {
  userOpHash: Hex;
  txHash: Hex;
};

type BasePurchaseResult = PurchaseSkillResult & {
  userOpHash?: Hex;
  txHash?: Hex;
  listingId: Hex;
  purchaseId?: Hex;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isBaseReceiptPendingError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return (
    /transaction receipt .*could not be found/i.test(message) ||
    /not be processed on a block yet/i.test(message) ||
    /waitfortransactionreceipttimeouterror/i.test(message) ||
    /timed out while waiting for transaction/i.test(message)
  );
}

export function isBaseDuplicatePurchaseError(error: unknown): boolean {
  return /DuplicatePurchase/i.test(getErrorMessage(error));
}

function explorerTxUrl(txHash: string): string {
  return `${BASE_SEPOLIA_EXPLORER_URL}/tx/${txHash}`;
}

function sameEvmAddress(
  left: unknown,
  right: string | null | undefined
): boolean {
  if (typeof left !== "string" || typeof right !== "string") return false;
  return (
    isAddress(left) &&
    isAddress(right) &&
    getAddress(left) === getAddress(right)
  );
}

export function requireBaseContractWriteConfig(): BaseContractWriteConfig {
  const config = getBaseWalletConfig();
  if (!config.configured) {
    throw new Error(BASE_WALLET_UNCONFIGURED_MESSAGE);
  }
  if (config.chainContext !== BASE_SEPOLIA_CHAIN_CONTEXT) {
    throw new Error(
      `Base writes require ${BASE_SEPOLIA_CHAIN_CONTEXT}; received ${config.chainContext}.`
    );
  }
  if (config.chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(
      `Base writes require chain id ${BASE_SEPOLIA_CHAIN_ID}; received ${config.chainId}.`
    );
  }

  const agentVouchAddress = requireBaseEvmAddress(
    BASE_AGENTVOUCH_CONTRACT_ADDRESS,
    "Base AgentVouch contract address"
  );
  const usdcAddress = requireBaseEvmAddress(
    BASE_USDC_ADDRESS,
    "Base USDC address"
  );
  const nativeUsdcAddress = getAddress(BASE_NATIVE_USDC_ADDRESS);
  if (usdcAddress !== nativeUsdcAddress) {
    throw new Error(
      `Base writes require native Circle Base Sepolia USDC ${nativeUsdcAddress}; received ${usdcAddress}.`
    );
  }

  return { agentVouchAddress, usdcAddress };
}

function requireBasePaymasterWriteConfig(): BasePaymasterWriteConfig {
  const config = requireBaseContractWriteConfig();
  if (!BASE_CDP_PAYMASTER_RPC_URL) {
    throw new Error(
      "Coinbase Smart Wallet Base writes require NEXT_PUBLIC_BASE_CDP_PAYMASTER_RPC_URL or NEXT_PUBLIC_CDP_RPC_URL."
    );
  }
  return { ...config, paymasterRpcUrl: BASE_CDP_PAYMASTER_RPC_URL };
}

export function createBasePublicClient() {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(BASE_SEPOLIA_RPC_URL),
  });
}

export async function assertBaseSepoliaChain(
  publicClient: ReturnType<typeof createBasePublicClient>
): Promise<void> {
  const chainId = await publicClient.getChainId();
  if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(
      `Base writes require chain id ${BASE_SEPOLIA_CHAIN_ID}; RPC returned ${chainId}.`
    );
  }
}

export async function fetchLiveListing(
  publicClient: ReturnType<typeof createBasePublicClient>,
  agentVouchAddress: Address,
  listingId: Hex
): Promise<RawListing> {
  const listing = (await publicClient.readContract({
    address: agentVouchAddress,
    abi: AGENTVOUCH_EVM_WRITE_ABI,
    functionName: "getListing",
    args: [listingId],
  })) as unknown as RawListing;

  if (!listing.exists) {
    throw new Error(`Base listing ${listingId} does not exist.`);
  }
  if (listing.status !== LISTING_STATUS_ACTIVE || listing.lockedByDispute) {
    throw new Error(`Base listing ${listingId} is not purchasable.`);
  }
  return listing;
}

export function findBaseWalletEvent(
  logs: readonly { address: Address; topics: readonly Hex[]; data: Hex }[],
  contract: Address,
  eventName:
    | "AgentRegistered"
    | "AuthorBondDeposited"
    | "AuthorBondWithdrawn"
    | "Vouched"
    | "VouchRevoked"
    | "SkillListingCreated"
    | "SkillPurchased"
    | "AuthorReportOpened"
    | "VoucherRevenueClaimed"
    | "AuthorProceedsWithdrawn"
): {
  eventName: string;
  args: Record<string, unknown>;
} | null {
  for (const log of logs) {
    if (getAddress(log.address) !== contract) continue;
    try {
      const decoded = decodeEventLog({
        abi: AGENTVOUCH_EVM_WRITE_ABI,
        data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]],
      }) as unknown as {
        eventName: string;
        args: Record<string, unknown>;
      };
      if (decoded.eventName === eventName) {
        return decoded;
      }
    } catch {
      // Ignore unrelated logs from the same transaction.
    }
  }
  return null;
}

async function sendBaseUserOperation(
  account: BasePasskeySmartAccount,
  calls: unknown[]
): Promise<BaseUserOperationResult> {
  const config = requireBasePaymasterWriteConfig();
  const publicClient = createBasePublicClient();
  await assertBaseSepoliaChain(publicClient);

  const bundler = createBundlerClient({
    account,
    client: publicClient,
    transport: http(config.paymasterRpcUrl),
    paymaster: true,
  });
  const userOpHash = await bundler.sendUserOperation({ calls: calls as never });
  const receipt = await bundler.waitForUserOperationReceipt({
    hash: userOpHash,
  });
  if (!receipt.success) {
    throw new Error(`Base UserOp ${userOpHash} reverted on-chain.`);
  }

  const txHash = receipt.receipt.transactionHash;
  return {
    ref: txHash,
    txHash,
    userOpHash,
    explorerUrl: explorerTxUrl(txHash),
    paidGas: false,
  };
}

export async function waitForBaseTransactionReceipt(
  publicClient: ReturnType<typeof createBasePublicClient>,
  txHash: Hex,
  label: string
) {
  try {
    return await publicClient.waitForTransactionReceipt({
      hash: txHash,
      pollingInterval: 1_000,
      timeout: 60_000,
    });
  } catch (error) {
    if (isBaseReceiptPendingError(error)) {
      throw new Error(
        `${label} was submitted, but Base Sepolia has not returned the transaction receipt yet. Wait a few seconds and refresh before signing again. Transaction: ${txHash}`
      );
    }
    throw error;
  }
}

export function baseUsdcMicros(amountUsdc: string): bigint {
  return parseUnits(amountUsdc, BASE_USDC_DECIMALS);
}

export function formatBaseUsdc(micros: bigint): string {
  return formatUnits(micros, BASE_USDC_DECIMALS);
}

export function planBasePurchaseApprovals(input: {
  allowance: bigint;
  expectedPriceUsdcMicros: bigint;
}): BasePurchaseApprovalPlan {
  const { allowance, expectedPriceUsdcMicros } = input;
  return {
    resetAllowance: allowance > 0n && allowance !== expectedPriceUsdcMicros,
    approvePrice: allowance !== expectedPriceUsdcMicros,
  };
}

function buildExactUsdcApprovalCalls(input: {
  allowance: bigint;
  spender: Address;
  amountUsdcMicros: bigint;
  usdcAddress: Address;
}): unknown[] {
  const { allowance, spender, amountUsdcMicros, usdcAddress } = input;
  if (amountUsdcMicros <= 0n) {
    throw new Error("Base USDC write amount must be greater than zero.");
  }

  const calls: unknown[] = [];
  if (allowance > 0n && allowance !== amountUsdcMicros) {
    calls.push({
      to: usdcAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, 0n],
    });
  }
  if (allowance !== amountUsdcMicros) {
    calls.push({
      to: usdcAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, amountUsdcMicros],
    });
  }
  return calls;
}

function tupleField<T extends keyof RawPurchase>(
  tuple: RawPurchaseTuple,
  key: T,
  index: number
): RawPurchase[T] | unknown {
  return tuple[key] ?? tuple[index];
}

function normalizeBasePurchaseTuple(value: unknown): RawPurchase {
  const tuple = value as RawPurchaseTuple;
  return {
    exists: Boolean(tupleField(tuple, "exists", 0)),
    buyer: requireBaseEvmAddress(
      String(tupleField(tuple, "buyer", 1) ?? ""),
      "Base purchase buyer"
    ),
    listingId: requireBaseBytes32(
      String(tupleField(tuple, "listingId", 2) ?? ""),
      "Base purchase listing id"
    ),
    revision: BigInt(String(tupleField(tuple, "revision", 3) ?? 0)),
    priceUsdcMicros: BigInt(
      String(tupleField(tuple, "priceUsdcMicros", 4) ?? 0)
    ),
  };
}

export async function findExistingBasePurchase(input: {
  publicClient: ReturnType<typeof createBasePublicClient>;
  agentVouchAddress: Address;
  buyer: Address;
  listingId: Hex;
  currentRevision: bigint;
}): Promise<{ purchaseId: Hex; purchase: RawPurchase } | null> {
  const MAX_REVISION_SCAN = 20n;
  for (
    let revision = input.currentRevision;
    revision >= 1n && input.currentRevision - revision < MAX_REVISION_SCAN;
    revision -= 1n
  ) {
    const purchaseId = (await input.publicClient.readContract({
      address: input.agentVouchAddress,
      abi: AGENTVOUCH_EVM_WRITE_ABI,
      functionName: "purchaseId",
      args: [input.buyer, input.listingId, revision],
    })) as Hex;
    const purchase = normalizeBasePurchaseTuple(
      await input.publicClient.readContract({
        address: input.agentVouchAddress,
        abi: AGENTVOUCH_EVM_WRITE_ABI,
        functionName: "getPurchase",
        args: [purchaseId],
      })
    );
    if (
      purchase.exists &&
      getAddress(purchase.buyer) === input.buyer &&
      purchase.listingId === input.listingId
    ) {
      return { purchaseId, purchase };
    }
  }
  return null;
}

export async function fetchBaseUsdcBalance(address: string): Promise<bigint> {
  const walletAddress = requireBaseEvmAddress(address, "Base wallet address");
  const usdcAddress = requireBaseEvmAddress(
    BASE_USDC_ADDRESS,
    "Base USDC address"
  );
  return createBasePublicClient().readContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [walletAddress],
  });
}

function readStoredCredential(): StoredCredential | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PASSKEY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredCredential>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.publicKey !== "string" ||
      !/^0x[0-9a-fA-F]+$/.test(parsed.publicKey)
    ) {
      return null;
    }
    return { id: parsed.id, publicKey: parsed.publicKey as Hex };
  } catch {
    return null;
  }
}

function saveCredential(credential: StoredCredential): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PASSKEY_STORAGE_KEY, JSON.stringify(credential));
}

function setPasskeyActive(active: boolean): void {
  if (typeof window === "undefined") return;
  if (active) {
    window.localStorage.setItem(PASSKEY_ACTIVE_STORAGE_KEY, "1");
    return;
  }
  window.localStorage.removeItem(PASSKEY_ACTIVE_STORAGE_KEY);
}

function isPasskeyActive(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(PASSKEY_ACTIVE_STORAGE_KEY) === "1";
}

async function accountForCredential(
  credential: StoredCredential
): Promise<BasePasskeySmartAccount> {
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(BASE_SEPOLIA_RPC_URL),
  });
  const owner = toWebAuthnAccount({ credential });
  return toCoinbaseSmartAccount({
    client: publicClient,
    owners: [owner],
    version: "1.1",
  });
}

export async function restoreBasePasskeyAccount(): Promise<BasePasskeySmartAccount | null> {
  if (!getBaseWalletConfig().configured) return null;
  if (!isPasskeyActive()) return null;
  const credential = readStoredCredential();
  if (!credential) {
    // Active flag set but no usable credential (cleared/corrupt storage). Clear
    // the flag so we stop silently re-attempting an impossible restore.
    setPasskeyActive(false);
    return null;
  }
  try {
    return await accountForCredential(credential);
  } catch (error) {
    // Couldn't reconstruct the smart account (e.g. RPC error or bad credential).
    // Clear the active flag so the failure doesn't repeat silently on every
    // reload; the stored credential is kept, so reconnect re-derives the same
    // account without a fresh passkey prompt.
    setPasskeyActive(false);
    throw error;
  }
}

export async function createBasePasskeyAccount(): Promise<BasePasskeySmartAccount> {
  if (!getBaseWalletConfig().configured) {
    throw new Error(BASE_WALLET_UNCONFIGURED_MESSAGE);
  }

  const stored = readStoredCredential();
  if (stored) {
    setPasskeyActive(true);
    return accountForCredential(stored);
  }

  // Shows the OS passkey prompt, so callers must invoke this from a user gesture.
  const credential = await createWebAuthnCredential({
    name: "AgentVouch Base Sepolia",
  });
  const next: StoredCredential = {
    id: credential.id,
    publicKey: credential.publicKey,
  };
  saveCredential(next);
  setPasskeyActive(true);
  return accountForCredential(next);
}

export function disconnectBasePasskeyAccount(): void {
  setPasskeyActive(false);
}

export async function registerBaseAgent(
  account: BasePasskeySmartAccount,
  metadataUri: string
): Promise<TxResult> {
  const config = requireBasePaymasterWriteConfig();
  const publicClient = createBasePublicClient();
  const result = await sendBaseUserOperation(account, [
    {
      to: config.agentVouchAddress,
      abi: AGENTVOUCH_EVM_WRITE_ABI,
      functionName: "registerAgent",
      args: [metadataUri],
    },
  ]);

  const receipt = await waitForBaseTransactionReceipt(
    publicClient,
    result.txHash,
    "Base agent registration"
  );
  const event = findBaseWalletEvent(
    receipt.logs,
    config.agentVouchAddress,
    "AgentRegistered"
  );
  if (!sameEvmAddress(event?.args.agent, account.address)) {
    throw new Error("Base registerAgent receipt did not match the wallet.");
  }

  return result;
}

async function ensureBaseAgentRegistered(
  account: BasePasskeySmartAccount,
  publicClient = createBasePublicClient()
): Promise<void> {
  const config = requireBasePaymasterWriteConfig();
  const profile = await publicClient.readContract({
    address: config.agentVouchAddress,
    abi: AGENTVOUCH_EVM_WRITE_ABI,
    functionName: "getProfile",
    args: [account.address],
  });
  if (Boolean((profile as { registered?: boolean }).registered)) return;

  await registerBaseAgent(
    account,
    `agentvouch://base-passkey/${account.address.toLowerCase()}`
  );
}

export async function createBaseSkillListing(
  account: BasePasskeySmartAccount,
  input: CreateSkillListingInput
): Promise<TxResult> {
  const config = requireBasePaymasterWriteConfig();
  const publicClient = createBasePublicClient();
  const skillIdHash = skillIdHashFrom(input.skillId);
  const listingId = computeListingId(account.address, skillIdHash);
  const result = await sendBaseUserOperation(account, [
    {
      to: config.agentVouchAddress,
      abi: AGENTVOUCH_EVM_WRITE_ABI,
      functionName: "createSkillListing",
      args: [
        skillIdHash,
        input.uri,
        input.name,
        input.description,
        input.priceUsdcMicros,
      ],
    },
  ]);

  const receipt = await waitForBaseTransactionReceipt(
    publicClient,
    result.txHash,
    "Base marketplace listing"
  );
  const event = findBaseWalletEvent(
    receipt.logs,
    config.agentVouchAddress,
    "SkillListingCreated"
  );
  if (
    event?.args.listingId !== listingId ||
    !sameEvmAddress(event.args.author, account.address) ||
    event.args.price !== input.priceUsdcMicros
  ) {
    throw new Error(
      "Base createSkillListing receipt did not match the submitted listing."
    );
  }

  return result;
}

export async function purchaseBaseSkill(
  account: BasePasskeySmartAccount,
  input: PurchaseSkillInput
): Promise<BasePurchaseResult> {
  const config = requireBasePaymasterWriteConfig();
  const listingId = requireBaseBytes32(input.listingId, "Base listing id");
  const publicClient = createBasePublicClient();
  await assertBaseSepoliaChain(publicClient);

  if (input.expectedPriceUsdcMicros <= 0n) {
    throw new Error("Base purchase requires a paid listing price.");
  }

  const listing = await fetchLiveListing(
    publicClient,
    config.agentVouchAddress,
    listingId
  );
  if (listing.priceUsdcMicros !== input.expectedPriceUsdcMicros) {
    throw new Error(
      `Base listing price changed from ${formatBaseUsdc(
        input.expectedPriceUsdcMicros
      )} USDC to ${formatBaseUsdc(
        listing.priceUsdcMicros
      )} USDC. Refresh before purchasing.`
    );
  }

  const buyer = account.address;
  const [balance, allowance] = await Promise.all([
    publicClient.readContract({
      address: config.usdcAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [buyer],
    }),
    publicClient.readContract({
      address: config.usdcAddress,
      abi: erc20Abi,
      functionName: "allowance",
      args: [buyer, config.agentVouchAddress],
    }),
  ]);
  if (balance < input.expectedPriceUsdcMicros) {
    throw new Error(
      `Insufficient Base Sepolia USDC. Have ${formatBaseUsdc(
        balance
      )} USDC, need ${formatBaseUsdc(input.expectedPriceUsdcMicros)} USDC.`
    );
  }

  const approvals = planBasePurchaseApprovals({
    allowance,
    expectedPriceUsdcMicros: input.expectedPriceUsdcMicros,
  });
  const calls: unknown[] = [];
  if (approvals.resetAllowance) {
    calls.push({
      to: config.usdcAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [config.agentVouchAddress, 0n],
    });
  }
  if (approvals.approvePrice) {
    calls.push({
      to: config.usdcAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [config.agentVouchAddress, input.expectedPriceUsdcMicros],
    });
  }
  calls.push({
    to: config.agentVouchAddress,
    abi: AGENTVOUCH_EVM_WRITE_ABI,
    functionName: "purchaseSkill",
    args: [listingId],
  });

  let result: BaseUserOperationResult;
  try {
    result = await sendBaseUserOperation(account, calls);
  } catch (error) {
    if (isBaseDuplicatePurchaseError(error)) {
      return {
        ref: listingId,
        explorerUrl: `${BASE_SEPOLIA_EXPLORER_URL}/address/${config.agentVouchAddress}`,
        paidGas: false,
        alreadyPurchased: true,
        listingId,
      };
    }
    throw error;
  }
  const receipt = await waitForBaseTransactionReceipt(
    publicClient,
    result.txHash,
    "Base USDC purchase"
  );
  const event = findBaseWalletEvent(
    receipt.logs,
    config.agentVouchAddress,
    "SkillPurchased"
  );
  if (
    !event ||
    event.args.listingId !== listingId ||
    !sameEvmAddress(event.args.buyer, buyer) ||
    event.args.price !== input.expectedPriceUsdcMicros ||
    typeof event.args.purchaseId !== "string"
  ) {
    throw new Error(
      "Base purchase receipt did not contain the expected SkillPurchased event."
    );
  }

  return {
    ...result,
    listingId,
    purchaseId: event.args.purchaseId as Hex,
  };
}

async function readBaseUsdcBalanceAndAllowance(input: {
  publicClient: ReturnType<typeof createBasePublicClient>;
  owner: Address;
  spender: Address;
  usdcAddress: Address;
}): Promise<{ balance: bigint; allowance: bigint }> {
  const [balance, allowance] = await Promise.all([
    input.publicClient.readContract({
      address: input.usdcAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [input.owner],
    }),
    input.publicClient.readContract({
      address: input.usdcAddress,
      abi: erc20Abi,
      functionName: "allowance",
      args: [input.owner, input.spender],
    }),
  ]);
  return { balance, allowance };
}

function assertSufficientBaseUsdc(input: {
  balance: bigint;
  amountUsdcMicros: bigint;
  purpose: string;
}) {
  if (input.balance < input.amountUsdcMicros) {
    throw new Error(
      `Insufficient Base Sepolia USDC for ${
        input.purpose
      }. Have ${formatBaseUsdc(input.balance)} USDC, need ${formatBaseUsdc(
        input.amountUsdcMicros
      )} USDC.`
    );
  }
}

async function sendBaseUsdcPullWrite(input: {
  account: BasePasskeySmartAccount;
  amountUsdcMicros: bigint;
  purpose: string;
  contractCall: unknown;
  sequentialApproval?: boolean;
}): Promise<BaseUserOperationResult> {
  const config = requireBasePaymasterWriteConfig();
  const publicClient = createBasePublicClient();
  await assertBaseSepoliaChain(publicClient);
  const { balance, allowance } = await readBaseUsdcBalanceAndAllowance({
    publicClient,
    owner: input.account.address,
    spender: config.agentVouchAddress,
    usdcAddress: config.usdcAddress,
  });
  assertSufficientBaseUsdc({
    balance,
    amountUsdcMicros: input.amountUsdcMicros,
    purpose: input.purpose,
  });

  const approvalCalls = buildExactUsdcApprovalCalls({
    allowance,
    spender: config.agentVouchAddress,
    amountUsdcMicros: input.amountUsdcMicros,
    usdcAddress: config.usdcAddress,
  });
  if (input.sequentialApproval) {
    for (const approvalCall of approvalCalls) {
      const approvalResult = await sendBaseUserOperation(input.account, [
        approvalCall,
      ]);
      await waitForBaseTransactionReceipt(
        publicClient,
        approvalResult.txHash,
        `Base ${input.purpose} approval`
      );
    }
    return sendBaseUserOperation(input.account, [input.contractCall]);
  }

  return sendBaseUserOperation(input.account, [
    ...approvalCalls,
    input.contractCall,
  ]);
}

export async function depositBaseAuthorBond(
  account: BasePasskeySmartAccount,
  input: DepositAuthorBondInput
): Promise<TxResult> {
  const config = requireBasePaymasterWriteConfig();
  const publicClient = createBasePublicClient();
  await ensureBaseAgentRegistered(account, publicClient);
  const result = await sendBaseUsdcPullWrite({
    account,
    amountUsdcMicros: input.amountUsdcMicros,
    purpose: "author bond deposit",
    contractCall: {
      to: config.agentVouchAddress,
      abi: AGENTVOUCH_EVM_WRITE_ABI,
      functionName: "depositAuthorBond",
      args: [input.amountUsdcMicros],
    },
  });
  const receipt = await waitForBaseTransactionReceipt(
    publicClient,
    result.txHash,
    "Base author bond deposit"
  );
  const event = findBaseWalletEvent(
    receipt.logs,
    config.agentVouchAddress,
    "AuthorBondDeposited"
  );
  if (
    !sameEvmAddress(event?.args.author, account.address) ||
    event?.args.amount !== input.amountUsdcMicros
  ) {
    throw new Error(
      "Base author bond deposit receipt did not match the submitted amount."
    );
  }
  return result;
}

export async function withdrawBaseAuthorBond(
  account: BasePasskeySmartAccount,
  input: WithdrawAuthorBondInput
): Promise<TxResult> {
  if (input.amountUsdcMicros <= 0n) {
    throw new Error(
      "Base author bond withdrawal amount must be greater than zero."
    );
  }
  const config = requireBasePaymasterWriteConfig();
  const publicClient = createBasePublicClient();
  const result = await sendBaseUserOperation(account, [
    {
      to: config.agentVouchAddress,
      abi: AGENTVOUCH_EVM_WRITE_ABI,
      functionName: "withdrawAuthorBond",
      args: [input.amountUsdcMicros],
    },
  ]);
  const receipt = await waitForBaseTransactionReceipt(
    publicClient,
    result.txHash,
    "Base author bond withdrawal"
  );
  const event = findBaseWalletEvent(
    receipt.logs,
    config.agentVouchAddress,
    "AuthorBondWithdrawn"
  );
  if (
    !sameEvmAddress(event?.args.author, account.address) ||
    event?.args.amount !== input.amountUsdcMicros
  ) {
    throw new Error(
      "Base author bond withdrawal receipt did not match the submitted amount."
    );
  }
  return result;
}

export async function vouchForBaseAuthor(
  account: BasePasskeySmartAccount,
  input: VouchForAuthorInput
): Promise<TxResult> {
  const vouchee = requireBaseEvmAddress(input.authorAddress, "Base vouchee");
  const config = requireBasePaymasterWriteConfig();
  const publicClient = createBasePublicClient();
  await ensureBaseAgentRegistered(account, publicClient);
  const result = await sendBaseUsdcPullWrite({
    account,
    amountUsdcMicros: input.stakeUsdcMicros,
    purpose: "author vouch",
    contractCall: {
      to: config.agentVouchAddress,
      abi: AGENTVOUCH_EVM_WRITE_ABI,
      functionName: "vouch",
      args: [vouchee, input.stakeUsdcMicros],
    },
  });
  const receipt = await waitForBaseTransactionReceipt(
    publicClient,
    result.txHash,
    "Base author vouch"
  );
  const event = findBaseWalletEvent(
    receipt.logs,
    config.agentVouchAddress,
    "Vouched"
  );
  if (
    !sameEvmAddress(event?.args.voucher, account.address) ||
    !sameEvmAddress(event?.args.vouchee, vouchee) ||
    event?.args.stake !== input.stakeUsdcMicros
  ) {
    throw new Error("Base vouch receipt did not match the submitted author.");
  }
  return result;
}

export async function revokeBaseVouch(
  account: BasePasskeySmartAccount,
  input: RevokeVouchInput
): Promise<TxResult> {
  const vouchee = requireBaseEvmAddress(input.authorAddress, "Base vouchee");
  const config = requireBasePaymasterWriteConfig();
  const publicClient = createBasePublicClient();
  const result = await sendBaseUserOperation(account, [
    {
      to: config.agentVouchAddress,
      abi: AGENTVOUCH_EVM_WRITE_ABI,
      functionName: "revokeVouch",
      args: [vouchee],
    },
  ]);
  const receipt = await waitForBaseTransactionReceipt(
    publicClient,
    result.txHash,
    "Base vouch revocation"
  );
  const event = findBaseWalletEvent(
    receipt.logs,
    config.agentVouchAddress,
    "VouchRevoked"
  );
  if (
    !sameEvmAddress(event?.args.voucher, account.address) ||
    !sameEvmAddress(event?.args.vouchee, vouchee)
  ) {
    throw new Error(
      "Base vouch revocation receipt did not match the submitted author."
    );
  }
  return result;
}

export async function openBaseAuthorReport(
  account: BasePasskeySmartAccount,
  input: OpenAuthorReportInput
): Promise<OpenAuthorReportResult> {
  const author = requireBaseEvmAddress(
    input.authorAddress,
    "Base report author"
  );
  const evidenceUri = input.evidenceUri.trim();
  if (!evidenceUri) throw new Error("Base author report requires evidence.");

  const config = requireBasePaymasterWriteConfig();
  const publicClient = createBasePublicClient();
  await assertBaseSepoliaChain(publicClient);
  const deployedBytecode = await publicClient.getCode({
    address: config.agentVouchAddress,
  });
  if (!deployedBytecode?.toLowerCase().includes(OPEN_REPORT_SELECTOR)) {
    throw new Error(BASE_AUTHOR_REPORTS_UNAVAILABLE_MESSAGE);
  }
  const disputeBondUsdcMicros = await publicClient
    .readContract({
      address: config.agentVouchAddress,
      abi: AGENTVOUCH_EVM_WRITE_ABI,
      functionName: "getConfig",
    })
    .then((configTuple) => {
      const record = configTuple as { disputeBondUsdcMicros?: bigint } & {
        [index: number]: unknown;
      };
      return BigInt(String(record.disputeBondUsdcMicros ?? record[3] ?? 0));
    });
  await ensureBaseAgentRegistered(account, publicClient);

  const result = await sendBaseUsdcPullWrite({
    account,
    amountUsdcMicros: disputeBondUsdcMicros,
    purpose: "author report bond",
    sequentialApproval: true,
    contractCall: {
      to: config.agentVouchAddress,
      data: encodeFunctionData({
        abi: AGENTVOUCH_EVM_WRITE_ABI as Abi,
        functionName: "openReport",
        args: [author, evidenceUri],
      }),
    },
  });
  const receipt = await waitForBaseTransactionReceipt(
    publicClient,
    result.txHash,
    "Base author report"
  );
  const event = findBaseWalletEvent(
    receipt.logs,
    config.agentVouchAddress,
    "AuthorReportOpened"
  );
  if (
    !sameEvmAddress(event?.args.reporter, account.address) ||
    !sameEvmAddress(event?.args.author, author)
  ) {
    throw new Error("Base report receipt did not match the submitted author.");
  }
  return {
    ...result,
    reportId:
      event?.args.reportId === undefined
        ? undefined
        : String(event.args.reportId),
  };
}

export async function claimBaseVoucherRevenue(
  account: BasePasskeySmartAccount,
  input: ClaimVoucherRevenueInput
): Promise<TxResult> {
  const author = requireBaseEvmAddress(input.authorAddress, "Base author");
  const config = requireBasePaymasterWriteConfig();
  const publicClient = createBasePublicClient();
  const result = await sendBaseUserOperation(account, [
    {
      to: config.agentVouchAddress,
      abi: AGENTVOUCH_EVM_WRITE_ABI,
      functionName: "claimVoucherRevenue",
      args: [author],
    },
  ]);
  const receipt = await waitForBaseTransactionReceipt(
    publicClient,
    result.txHash,
    "Base voucher revenue claim"
  );
  const event = findBaseWalletEvent(
    receipt.logs,
    config.agentVouchAddress,
    "VoucherRevenueClaimed"
  );
  if (
    !sameEvmAddress(event?.args.voucher, account.address) ||
    !sameEvmAddress(event?.args.author, author)
  ) {
    throw new Error(
      "Base voucher revenue receipt did not match the submitted author."
    );
  }
  return result;
}

export async function withdrawBaseAuthorProceeds(
  account: BasePasskeySmartAccount,
  input: WithdrawAuthorProceedsInput
): Promise<TxResult> {
  if (input.amountUsdcMicros <= 0n) {
    throw new Error(
      "Base author proceeds withdrawal amount must be greater than zero."
    );
  }
  const listingId = requireBaseBytes32(input.listingId, "Base listing id");
  const config = requireBasePaymasterWriteConfig();
  const publicClient = createBasePublicClient();
  const result = await sendBaseUserOperation(account, [
    {
      to: config.agentVouchAddress,
      abi: AGENTVOUCH_EVM_WRITE_ABI,
      functionName: "withdrawAuthorProceeds",
      args: [listingId, BigInt(input.listingRevision), input.amountUsdcMicros],
    },
  ]);
  const receipt = await waitForBaseTransactionReceipt(
    publicClient,
    result.txHash,
    "Base author proceeds withdrawal"
  );
  const event = findBaseWalletEvent(
    receipt.logs,
    config.agentVouchAddress,
    "AuthorProceedsWithdrawn"
  );
  if (
    event?.args.listingId !== listingId ||
    !sameEvmAddress(event?.args.author, account.address) ||
    event?.args.amount !== input.amountUsdcMicros
  ) {
    throw new Error(
      "Base author proceeds receipt did not match the submitted listing."
    );
  }
  return result;
}

export function createBasePasskeyChainWallet(
  account: BasePasskeySmartAccount,
  disconnect: () => Promise<void>
): ChainWallet {
  return {
    chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
    address: account.address,
    disconnect,
    // ERC-1271/6492-verifiable smart-account signature, checked server-side
    // via publicClient.verifyMessage (web/lib/evmAuth.ts).
    signMessage: (message) => account.signMessage({ message }),
    registerAgent: (metadataUri) => registerBaseAgent(account, metadataUri),
    createSkillListing: (input) => createBaseSkillListing(account, input),
    purchaseSkill: (input) => purchaseBaseSkill(account, input),
    depositAuthorBond: (input) => depositBaseAuthorBond(account, input),
    withdrawAuthorBond: (input) => withdrawBaseAuthorBond(account, input),
    vouchForAuthor: (input) => vouchForBaseAuthor(account, input),
    revokeVouch: (input) => revokeBaseVouch(account, input),
    openAuthorReport: (input) => openBaseAuthorReport(account, input),
    claimVoucherRevenue: (input) => claimBaseVoucherRevenue(account, input),
    withdrawAuthorProceeds: (input) =>
      withdrawBaseAuthorProceeds(account, input),
    buildX402Payment: () =>
      Promise.reject(
        new Error(
          `buildX402Payment is part of AgentVouch Base Phase 5 but is not implemented for the ${BASE_PASSKEY_WALLET_NAME} human passkey wallet.`
        )
      ),
  };
}
