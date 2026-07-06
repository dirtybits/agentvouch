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
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseUnits,
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
  CreateSkillListingInput,
  PurchaseSkillResult,
  PurchaseSkillInput,
  TxResult,
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

const AGENTVOUCH_EVM_WRITE_ABI = parseAbi([
  ...AGENTVOUCH_EVM_READ_ABI,
  "function registerAgent(string metadataUri)",
  "function createSkillListing(bytes32 skillIdHash, string uri, string name, string description, uint256 priceUsdcMicros) returns (bytes32)",
  "function purchaseSkill(bytes32 id) returns (bytes32)",
  "event AgentRegistered(address indexed agent, string metadataUri, uint64 registeredAt)",
  "event SkillPurchased(bytes32 indexed purchaseId, bytes32 indexed listingId, address indexed buyer, uint64 revision, uint256 price, uint256 authorShare, uint256 voucherPool)",
]);

type StoredCredential = { id: string; publicKey: Hex };

export type BasePasskeySmartAccount = SmartAccount;

type BaseWriteConfig = {
  agentVouchAddress: Address;
  usdcAddress: Address;
  paymasterRpcUrl: string;
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

function requireBaseWriteConfig(): BaseWriteConfig {
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
  if (!BASE_CDP_PAYMASTER_RPC_URL) {
    throw new Error(
      "Base writes require NEXT_PUBLIC_BASE_CDP_PAYMASTER_RPC_URL or NEXT_PUBLIC_CDP_RPC_URL."
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

  return {
    agentVouchAddress,
    usdcAddress,
    paymasterRpcUrl: BASE_CDP_PAYMASTER_RPC_URL,
  };
}

function createBasePublicClient() {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(BASE_SEPOLIA_RPC_URL),
  });
}

async function assertBaseSepoliaChain(
  publicClient: ReturnType<typeof createBasePublicClient>
): Promise<void> {
  const chainId = await publicClient.getChainId();
  if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(
      `Base writes require chain id ${BASE_SEPOLIA_CHAIN_ID}; RPC returned ${chainId}.`
    );
  }
}

async function fetchLiveListing(
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

function findEvent(
  logs: readonly { address: Address; topics: readonly Hex[]; data: Hex }[],
  contract: Address,
  eventName: "AgentRegistered" | "SkillListingCreated" | "SkillPurchased"
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
  const config = requireBaseWriteConfig();
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

async function waitForBaseTransactionReceipt(
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
  const config = requireBaseWriteConfig();
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
  const event = findEvent(
    receipt.logs,
    config.agentVouchAddress,
    "AgentRegistered"
  );
  if (!sameEvmAddress(event?.args.agent, account.address)) {
    throw new Error("Base registerAgent receipt did not match the wallet.");
  }

  return result;
}

export async function createBaseSkillListing(
  account: BasePasskeySmartAccount,
  input: CreateSkillListingInput
): Promise<TxResult> {
  const config = requireBaseWriteConfig();
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
  const event = findEvent(
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
  const config = requireBaseWriteConfig();
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

  const calls: unknown[] = [];
  if (allowance !== input.expectedPriceUsdcMicros) {
    if (allowance > 0n) {
      calls.push({
        to: config.usdcAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [config.agentVouchAddress, 0n],
      });
    }
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
  const event = findEvent(
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
    buildX402Payment: () =>
      Promise.reject(
        new Error(
          `buildX402Payment is part of AgentVouch Base Phase 5 but is not implemented for the ${BASE_PASSKEY_WALLET_NAME} human passkey wallet.`
        )
      ),
  };
}
