"use client";

import {
  encodeFunctionData,
  erc20Abi,
  getAddress,
  isAddress,
  numberToHex,
  parseAbi,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { BASE_SEPOLIA_CHAIN_CONTEXT } from "@/lib/chains";
import {
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_LABEL,
  BASE_SEPOLIA_EXPLORER_URL,
  BASE_SEPOLIA_RPC_URL,
  BASE_WALLET_UNCONFIGURED_MESSAGE,
  getBaseWalletConfig,
} from "./baseWalletConfig";
import { requireBaseBytes32 } from "./baseListing";
import {
  assertBaseSepoliaChain,
  createBasePublicClient,
  fetchLiveListing,
  findExistingBasePurchase,
  findBaseWalletEvent,
  formatBaseUsdc,
  isBaseDuplicatePurchaseError,
  planBasePurchaseApprovals,
  requireBaseContractWriteConfig,
  waitForBaseTransactionReceipt,
} from "./baseWallet";
import type {
  ChainWallet,
  PurchaseSkillInput,
  PurchaseSkillResult,
} from "./types";

export const BASE_INJECTED_WALLET_NAME = "MetaMask";
export const BASE_INJECTED_WALLET_SOURCE = "metamask-injected";
export const BASE_SEPOLIA_CHAIN_ID_HEX = numberToHex(BASE_SEPOLIA_CHAIN_ID);
const INJECTED_ACTIVE_STORAGE_KEY = "agentvouch:base-sepolia:metamask:active";
const PURCHASE_SKILL_ABI = parseAbi([
  "function purchaseSkill(bytes32 id) returns (bytes32)",
]);

type Eip1193RequestArgs = {
  method: string;
  params?: unknown[] | Record<string, unknown>;
};

export type Eip1193Provider = {
  request(args: Eip1193RequestArgs): Promise<unknown>;
  on?(
    event: "accountsChanged" | "chainChanged" | "disconnect",
    listener: (...args: unknown[]) => void
  ): void;
  removeListener?(
    event: "accountsChanged" | "chainChanged" | "disconnect",
    listener: (...args: unknown[]) => void
  ): void;
  isMetaMask?: boolean;
  isPhantom?: boolean;
  isBraveWallet?: boolean;
  isCoinbaseWallet?: boolean;
  isRabby?: boolean;
  providers?: Eip1193Provider[];
};

type Eip6963ProviderDetail = {
  info?: { rdns?: string; name?: string };
  provider?: Eip1193Provider;
};

export type BaseInjectedWalletSession = {
  provider: Eip1193Provider;
  address: Address;
  executionMode: "eoa" | "erc7702-capable-skipped";
};

type WindowWithEthereum = Window & {
  ethereum?: Eip1193Provider;
};

function getWindow(): WindowWithEthereum | null {
  if (typeof window === "undefined") return null;
  return window as WindowWithEthereum;
}

function setInjectedActive(active: boolean): void {
  if (typeof window === "undefined") return;
  if (active) {
    window.localStorage.setItem(INJECTED_ACTIVE_STORAGE_KEY, "1");
    return;
  }
  window.localStorage.removeItem(INJECTED_ACTIVE_STORAGE_KEY);
}

export function isBaseInjectedWalletActive(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(INJECTED_ACTIVE_STORAGE_KEY) === "1";
}

function normalizeAccounts(value: unknown): Address[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is string => typeof entry === "string" && isAddress(entry)
    )
    .map((entry) => getAddress(entry));
}

export function selectMetaMaskProvider(
  candidates: readonly (
    | Eip1193Provider
    | (Eip6963ProviderDetail & { request?: never })
    | null
    | undefined
  )[]
): Eip1193Provider | null {
  const eip6963MetaMask = candidates.find(
    (candidate): candidate is Eip6963ProviderDetail =>
      !!candidate &&
      !("request" in candidate) &&
      candidate.info?.rdns === "io.metamask" &&
      typeof candidate.provider?.request === "function"
  );
  if (eip6963MetaMask?.provider) return eip6963MetaMask.provider;

  const providers = candidates
    .map((candidate) => {
      if (!candidate) return null;
      if ("request" in candidate && typeof candidate.request === "function") {
        return candidate as Eip1193Provider;
      }
      return candidate.provider ?? null;
    })
    .filter((provider): provider is Eip1193Provider => !!provider);

  return (
    providers.find(
      (provider) =>
        provider.isMetaMask &&
        !provider.isPhantom &&
        !provider.isBraveWallet &&
        !provider.isCoinbaseWallet &&
        !provider.isRabby
    ) ?? null
  );
}

export function getInjectedMetaMaskProvider(
  win: WindowWithEthereum | null = getWindow()
): Eip1193Provider | null {
  const ethereum = win?.ethereum;
  if (!ethereum) return null;
  const candidates = ethereum.providers?.length
    ? ethereum.providers
    : [ethereum];
  return selectMetaMaskProvider(candidates);
}

export function subscribeToEip6963MetaMaskProviders(
  onProvider: (provider: Eip1193Provider) => void
): () => void {
  const win = getWindow();
  if (!win) return () => {};

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
    const provider =
      detail?.info?.rdns === "io.metamask" && detail.provider?.isMetaMask
        ? detail.provider
        : null;
    if (provider) onProvider(provider);
  };

  win.addEventListener("eip6963:announceProvider", handler);
  win.dispatchEvent(new Event("eip6963:requestProvider"));
  return () => win.removeEventListener("eip6963:announceProvider", handler);
}

export async function readInjectedAccounts(
  provider: Eip1193Provider
): Promise<Address[]> {
  return normalizeAccounts(await provider.request({ method: "eth_accounts" }));
}

export async function ensureBaseSepoliaInjectedChain(
  provider: Eip1193Provider,
  options: { requestSwitch?: boolean } = {}
): Promise<void> {
  const chainId = await provider.request({ method: "eth_chainId" });
  if (chainId === BASE_SEPOLIA_CHAIN_ID_HEX) return;
  if (chainId === "0x2105") {
    throw new Error(
      "Base mainnet is not enabled for AgentVouch writes. Switch MetaMask to Base Sepolia."
    );
  }
  if (options.requestSwitch === false) {
    throw new Error("MetaMask is not connected to Base Sepolia.");
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_SEPOLIA_CHAIN_ID_HEX }],
    });
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? Number((error as { code: unknown }).code)
        : null;
    if (code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: BASE_SEPOLIA_CHAIN_ID_HEX,
          chainName: BASE_SEPOLIA_CHAIN_LABEL,
          nativeCurrency: {
            name: "Sepolia Ether",
            symbol: "ETH",
            decimals: 18,
          },
          rpcUrls: [BASE_SEPOLIA_RPC_URL],
          blockExplorerUrls: [BASE_SEPOLIA_EXPLORER_URL],
        },
      ],
    });
  }
}

export async function probeBaseInjectedExecutionMode(
  provider: Eip1193Provider,
  address: Address
): Promise<BaseInjectedWalletSession["executionMode"]> {
  try {
    const capabilities = await provider.request({
      method: "wallet_getCapabilities",
      params: [address, [BASE_SEPOLIA_CHAIN_ID_HEX]],
    });
    if (
      capabilities &&
      typeof capabilities === "object" &&
      BASE_SEPOLIA_CHAIN_ID_HEX in capabilities
    ) {
      const chainCapabilities = (capabilities as Record<string, unknown>)[
        BASE_SEPOLIA_CHAIN_ID_HEX
      ];
      if (
        chainCapabilities &&
        typeof chainCapabilities === "object" &&
        "atomicBatch" in chainCapabilities
      ) {
        // Batching is advertised, but the 7702 execution path is unreviewed;
        // record the capability and stay on ordinary EOA transactions.
        return "erc7702-capable-skipped";
      }
      return "eoa";
    }
  } catch {
    // MetaMask stable channels may not expose EIP-5792/7702 probing yet.
  }
  return "eoa";
}

async function requestInjectedAccount(
  provider: Eip1193Provider
): Promise<Address> {
  const accounts = normalizeAccounts(
    await provider.request({ method: "eth_requestAccounts" })
  );
  const account = accounts[0];
  if (!account) throw new Error("MetaMask did not return an EVM account.");
  return account;
}

async function sendInjectedTransaction(
  provider: Eip1193Provider,
  from: Address,
  to: Address,
  data: Hex
): Promise<Hex> {
  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data }],
  });
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    throw new Error("MetaMask did not return a transaction hash.");
  }
  return hash as Hex;
}

export async function createBaseInjectedWalletSession(
  provider: Eip1193Provider
): Promise<BaseInjectedWalletSession> {
  if (!getBaseWalletConfig().configured) {
    throw new Error(BASE_WALLET_UNCONFIGURED_MESSAGE);
  }
  await ensureBaseSepoliaInjectedChain(provider);
  const address = await requestInjectedAccount(provider);
  const executionMode = await probeBaseInjectedExecutionMode(provider, address);
  setInjectedActive(true);
  return { provider, address, executionMode };
}

export async function restoreBaseInjectedWalletSession(
  provider: Eip1193Provider | null
): Promise<BaseInjectedWalletSession | null> {
  if (
    !provider ||
    !getBaseWalletConfig().configured ||
    !isBaseInjectedWalletActive()
  ) {
    return null;
  }
  const accounts = await readInjectedAccounts(provider);
  const address = accounts[0];
  if (!address) {
    setInjectedActive(false);
    return null;
  }
  await ensureBaseSepoliaInjectedChain(provider, { requestSwitch: false });
  const executionMode = await probeBaseInjectedExecutionMode(provider, address);
  return { provider, address, executionMode };
}

export function disconnectBaseInjectedWallet(): void {
  setInjectedActive(false);
}

async function purchaseBaseSkillWithInjectedWallet(
  session: BaseInjectedWalletSession,
  input: PurchaseSkillInput
): Promise<
  PurchaseSkillResult & { txHash?: Hex; listingId: Hex; purchaseId?: Hex }
> {
  const config = requireBaseContractWriteConfig();
  const listingId = requireBaseBytes32(input.listingId, "Base listing id");
  const publicClient = createBasePublicClient();
  await assertBaseSepoliaChain(publicClient);
  await ensureBaseSepoliaInjectedChain(session.provider);

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

  const buyer = session.address;
  const existing = await findExistingBasePurchase({
    publicClient,
    agentVouchAddress: config.agentVouchAddress,
    buyer,
    listingId,
    currentRevision: listing.currentRevision,
  });
  if (existing) {
    return {
      ref: listingId,
      explorerUrl: `${BASE_SEPOLIA_EXPLORER_URL}/address/${config.agentVouchAddress}`,
      paidGas: false,
      alreadyPurchased: true,
      listingId,
      purchaseId: existing.purchaseId,
    };
  }

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
  if (approvals.resetAllowance) {
    const resetHash = await sendInjectedTransaction(
      session.provider,
      buyer,
      config.usdcAddress,
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [config.agentVouchAddress, 0n],
      })
    );
    await waitForBaseTransactionReceipt(
      publicClient,
      resetHash,
      "Base USDC allowance reset"
    );
  }
  if (approvals.approvePrice) {
    const approveHash = await sendInjectedTransaction(
      session.provider,
      buyer,
      config.usdcAddress,
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [config.agentVouchAddress, input.expectedPriceUsdcMicros],
      })
    );
    await waitForBaseTransactionReceipt(
      publicClient,
      approveHash,
      "Base USDC approval"
    );
  }

  let txHash: Hex;
  try {
    txHash = await sendInjectedTransaction(
      session.provider,
      buyer,
      config.agentVouchAddress,
      encodeFunctionData({
        abi: PURCHASE_SKILL_ABI,
        functionName: "purchaseSkill",
        args: [listingId],
      })
    );
  } catch (error) {
    if (isBaseDuplicatePurchaseError(error)) {
      return {
        ref: listingId,
        explorerUrl: `${BASE_SEPOLIA_EXPLORER_URL}/address/${config.agentVouchAddress}`,
        paidGas: true,
        alreadyPurchased: true,
        listingId,
      };
    }
    throw error;
  }

  const receipt = await waitForBaseTransactionReceipt(
    publicClient,
    txHash,
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
    getAddress(String(event.args.buyer)) !== buyer ||
    event.args.price !== input.expectedPriceUsdcMicros ||
    typeof event.args.purchaseId !== "string"
  ) {
    throw new Error(
      "Base purchase receipt did not contain the expected SkillPurchased event."
    );
  }

  return {
    ref: txHash,
    txHash,
    explorerUrl: `${BASE_SEPOLIA_EXPLORER_URL}/tx/${txHash}`,
    paidGas: true,
    listingId,
    purchaseId: event.args.purchaseId as Hex,
  };
}

export function createBaseInjectedChainWallet(
  session: BaseInjectedWalletSession,
  disconnect: () => Promise<void>
): ChainWallet {
  return {
    chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
    address: session.address.toLowerCase(),
    disconnect,
    signMessage: async (message) => {
      const signature = await session.provider.request({
        method: "personal_sign",
        params: [stringToHex(message), session.address],
      });
      if (
        typeof signature !== "string" ||
        !/^0x[0-9a-fA-F]+$/.test(signature)
      ) {
        throw new Error("MetaMask did not return a valid signature.");
      }
      return signature;
    },
    registerAgent: () =>
      Promise.reject(
        new Error(
          "MetaMask author registration is not enabled yet; use Coinbase Smart Wallet for Base author actions."
        )
      ),
    createSkillListing: () =>
      Promise.reject(
        new Error(
          "MetaMask listing creation is not enabled yet; use Coinbase Smart Wallet for Base author actions."
        )
      ),
    purchaseSkill: (input) =>
      purchaseBaseSkillWithInjectedWallet(session, input),
    buildX402Payment: () =>
      Promise.reject(
        new Error(
          "buildX402Payment is not implemented for the MetaMask Base buyer wallet."
        )
      ),
  };
}
