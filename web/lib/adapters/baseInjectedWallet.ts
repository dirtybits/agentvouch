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
import { requireBaseEvmAddress } from "./baseListing";
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
  ClaimPaidPurchaseReportCreditInput,
  ClaimPaidPurchaseReportCreditResult,
  OpenPaidPurchaseReportInput,
  OpenPaidPurchaseReportResult,
  PaidPurchaseReportChainWallet,
  PurchaseSkillInput,
  PurchaseSkillResult,
} from "./types";
import {
  AGENTVOUCH_EVM_A1_PAID_REPORT_ABI,
  BASE_A1_PROTOCOL_VERSION,
  PAID_PURCHASE_REPORT_BOND_USDC_MICROS,
  PAID_PURCHASE_REPORT_STATUS_TERMINAL,
  assertBaseA1ReportPreflight,
  assertPaidPurchaseReportInput,
  findBasePaidReportEvent,
  isKnownUsdcAllowanceFailure,
  normalizeBaseA1Purchase,
  type BaseA1Config,
} from "./basePaidPurchaseReports";

export const BASE_INJECTED_WALLET_NAME = "MetaMask";
export const BASE_INJECTED_WALLET_SOURCE = "metamask-injected";
export const BASE_SEPOLIA_CHAIN_ID_HEX = numberToHex(BASE_SEPOLIA_CHAIN_ID);
const INJECTED_ACTIVE_STORAGE_KEY = "agentvouch:base-sepolia:metamask:active";
const PURCHASE_SKILL_ABI = parseAbi([
  "function purchaseSkill(bytes32 id) returns (bytes32)",
]);
const unsupportedAuthorWrite = (action: string) =>
  Promise.reject(
    new Error(
      `${action} is not enabled for the MetaMask Base buyer wallet yet; use Coinbase Smart Wallet for Base author/trust actions.`
    )
  );

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
        !provider.isRabby &&
        !("coreProvider" in provider) &&
        !("addProvider" in provider)
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

function namedOrIndexed(value: unknown, name: string, index: number): unknown {
  const tuple = value as Record<string | number, unknown>;
  return tuple[name] ?? tuple[index];
}

function normalizeInjectedA1Config(value: unknown): BaseA1Config {
  return {
    usdc: requireBaseEvmAddress(
      String(namedOrIndexed(value, "usdc", 0) ?? ""),
      "Base A1 config USDC"
    ),
    chainContext: String(namedOrIndexed(value, "chainContext", 1) ?? ""),
    disputeBondUsdcMicros: BigInt(
      String(namedOrIndexed(value, "disputeBondUsdcMicros", 3) ?? 0)
    ),
    refundClaimWindowSeconds: BigInt(
      String(namedOrIndexed(value, "refundClaimWindowSeconds", 11) ?? 0)
    ),
  };
}

async function registerBaseAgentWithInjectedWallet(
  session: BaseInjectedWalletSession,
  metadataUri: string
): Promise<PurchaseSkillResult> {
  if (!metadataUri.trim()) throw new Error("Base agent metadata is required.");
  const config = requireBaseContractWriteConfig();
  const publicClient = createBasePublicClient();
  await assertBaseSepoliaChain(publicClient);
  await ensureBaseSepoliaInjectedChain(session.provider);
  const txHash = await sendInjectedTransaction(
    session.provider,
    session.address,
    config.agentVouchAddress,
    encodeFunctionData({
      abi: AGENTVOUCH_EVM_A1_PAID_REPORT_ABI,
      functionName: "registerAgent",
      args: [metadataUri],
    })
  );
  const receipt = await waitForBaseTransactionReceipt(
    publicClient,
    txHash,
    "Base agent registration"
  );
  const event = findBaseWalletEvent(
    receipt.logs,
    config.agentVouchAddress,
    "AgentRegistered"
  );
  if (
    !event ||
    !isAddress(String(event.args.agent)) ||
    getAddress(String(event.args.agent)) !== session.address
  ) {
    throw new Error("Base registerAgent receipt did not match MetaMask.");
  }
  return {
    ref: txHash,
    explorerUrl: `${BASE_SEPOLIA_EXPLORER_URL}/tx/${txHash}`,
    paidGas: true,
  };
}

async function ensureInjectedBuyerRegistered(
  session: BaseInjectedWalletSession,
  contractAddress: Address
): Promise<void> {
  const publicClient = createBasePublicClient();
  const profile = await publicClient.readContract({
    address: contractAddress,
    abi: AGENTVOUCH_EVM_A1_PAID_REPORT_ABI,
    functionName: "getProfile",
    args: [session.address],
  });
  if (Boolean(namedOrIndexed(profile, "registered", 0))) return;
  await registerBaseAgentWithInjectedWallet(
    session,
    `agentvouch://base-paid-report/${session.address.toLowerCase()}`
  );
}

async function openPaidPurchaseReportWithInjectedWallet(
  session: BaseInjectedWalletSession,
  input: OpenPaidPurchaseReportInput
): Promise<OpenPaidPurchaseReportResult> {
  const config = requireBaseContractWriteConfig();
  const bound = assertPaidPurchaseReportInput({
    request: input,
    selectedContract: config.agentVouchAddress,
  });
  const publicClient = createBasePublicClient();
  await assertBaseSepoliaChain(publicClient);
  await ensureBaseSepoliaInjectedChain(session.provider);

  const [code, protocolVersion, paused, rawConfig] = await Promise.all([
    publicClient.getCode({ address: bound.contractAddress }),
    publicClient.readContract({
      address: bound.contractAddress,
      abi: AGENTVOUCH_EVM_A1_PAID_REPORT_ABI,
      functionName: "PROTOCOL_VERSION",
    }),
    publicClient.readContract({
      address: bound.contractAddress,
      abi: AGENTVOUCH_EVM_A1_PAID_REPORT_ABI,
      functionName: "paused",
    }),
    publicClient.readContract({
      address: bound.contractAddress,
      abi: AGENTVOUCH_EVM_A1_PAID_REPORT_ABI,
      functionName: "getConfig",
    }),
  ]);
  if (!code || code === "0x")
    throw new Error("Selected Base A1 contract has no code.");
  if (protocolVersion !== BASE_A1_PROTOCOL_VERSION) {
    throw new Error("Selected Base contract is not protocol base-v1-a1.");
  }
  if (paused) {
    throw new Error(
      "Paid-purchase reports are paused on the selected deployment."
    );
  }
  await ensureInjectedBuyerRegistered(session, bound.contractAddress);

  const [
    buyerProfile,
    authorProfile,
    rawPurchase,
    rawListing,
    block,
    balance,
    allowance,
  ] = await Promise.all([
    publicClient.readContract({
      address: bound.contractAddress,
      abi: AGENTVOUCH_EVM_A1_PAID_REPORT_ABI,
      functionName: "getProfile",
      args: [session.address],
    }),
    publicClient.readContract({
      address: bound.contractAddress,
      abi: AGENTVOUCH_EVM_A1_PAID_REPORT_ABI,
      functionName: "getProfile",
      args: [bound.authorAddress],
    }),
    publicClient.readContract({
      address: bound.contractAddress,
      abi: AGENTVOUCH_EVM_A1_PAID_REPORT_ABI,
      functionName: "getPurchase",
      args: [bound.purchaseId],
    }),
    publicClient.readContract({
      address: bound.contractAddress,
      abi: AGENTVOUCH_EVM_A1_PAID_REPORT_ABI,
      functionName: "getListing",
      args: [bound.listingId],
    }),
    publicClient.getBlock({ blockTag: "latest" }),
    publicClient.readContract({
      address: config.usdcAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [session.address],
    }),
    publicClient.readContract({
      address: config.usdcAddress,
      abi: erc20Abi,
      functionName: "allowance",
      args: [session.address, bound.contractAddress],
    }),
  ]);
  if (!Boolean(namedOrIndexed(buyerProfile, "registered", 0))) {
    throw new Error("The connected Base buyer is not registered.");
  }
  if (!Boolean(namedOrIndexed(authorProfile, "registered", 0))) {
    throw new Error("The paid-purchase author is not registered.");
  }
  assertBaseA1ReportPreflight({
    protocolVersion: String(protocolVersion),
    paused: Boolean(paused),
    code,
    config: normalizeInjectedA1Config(rawConfig),
    buyer: session.address,
    author: bound.authorAddress,
    listingId: bound.listingId,
    purchase: normalizeBaseA1Purchase(rawPurchase),
    listing: {
      author: requireBaseEvmAddress(
        String(namedOrIndexed(rawListing, "author", 0) ?? ""),
        "Base A1 listing author"
      ),
      exists: Boolean(namedOrIndexed(rawListing, "exists", 11)),
    },
    nowSeconds: block.timestamp,
  });
  if (balance < PAID_PURCHASE_REPORT_BOND_USDC_MICROS) {
    throw new Error(
      "Insufficient Base Sepolia USDC for the 5 USDC report bond."
    );
  }

  try {
    await publicClient.simulateContract({
      account: session.address,
      address: bound.contractAddress,
      abi: AGENTVOUCH_EVM_A1_PAID_REPORT_ABI,
      functionName: "openPaidPurchaseReport",
      args: [
        bound.authorAddress,
        bound.listingId,
        bound.purchaseId,
        input.evidenceUri,
      ],
    });
  } catch (error) {
    if (
      allowance >= PAID_PURCHASE_REPORT_BOND_USDC_MICROS ||
      !isKnownUsdcAllowanceFailure(error)
    ) {
      throw error;
    }
  }

  const approvalPlan = planBasePurchaseApprovals({
    allowance,
    expectedPriceUsdcMicros: PAID_PURCHASE_REPORT_BOND_USDC_MICROS,
  });
  if (approvalPlan.resetAllowance) {
    const resetHash = await sendInjectedTransaction(
      session.provider,
      session.address,
      config.usdcAddress,
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [bound.contractAddress, 0n],
      })
    );
    await waitForBaseTransactionReceipt(
      publicClient,
      resetHash,
      "Base report bond allowance reset"
    );
  }
  if (approvalPlan.approvePrice) {
    const approvalHash = await sendInjectedTransaction(
      session.provider,
      session.address,
      config.usdcAddress,
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [bound.contractAddress, PAID_PURCHASE_REPORT_BOND_USDC_MICROS],
      })
    );
    await waitForBaseTransactionReceipt(
      publicClient,
      approvalHash,
      "Base report bond approval"
    );
    // Re-simulate after the non-atomic approval before opening.
    await publicClient.simulateContract({
      account: session.address,
      address: bound.contractAddress,
      abi: AGENTVOUCH_EVM_A1_PAID_REPORT_ABI,
      functionName: "openPaidPurchaseReport",
      args: [
        bound.authorAddress,
        bound.listingId,
        bound.purchaseId,
        input.evidenceUri,
      ],
    });
  }

  const txHash = await sendInjectedTransaction(
    session.provider,
    session.address,
    bound.contractAddress,
    encodeFunctionData({
      abi: AGENTVOUCH_EVM_A1_PAID_REPORT_ABI,
      functionName: "openPaidPurchaseReport",
      args: [
        bound.authorAddress,
        bound.listingId,
        bound.purchaseId,
        input.evidenceUri,
      ],
    })
  );
  const receipt = await waitForBaseTransactionReceipt(
    publicClient,
    txHash,
    "Base paid-purchase report"
  );
  const event = findBasePaidReportEvent(
    receipt.logs,
    bound.contractAddress,
    "PaidPurchaseReportOpened"
  );
  if (
    !event ||
    String(event.args.buyer).toLowerCase() !== session.address.toLowerCase() ||
    String(event.args.author).toLowerCase() !==
      bound.authorAddress.toLowerCase() ||
    event.args.listingId !== bound.listingId ||
    event.args.purchaseId !== bound.purchaseId ||
    event.args.bond !== PAID_PURCHASE_REPORT_BOND_USDC_MICROS ||
    event.args.evidenceUri !== input.evidenceUri
  ) {
    throw new Error(
      "Base paid-purchase report receipt did not match the purchase."
    );
  }
  return {
    ref: txHash,
    txHash,
    reportId: String(event.args.reportId),
    explorerUrl: `${BASE_SEPOLIA_EXPLORER_URL}/tx/${txHash}`,
    paidGas: true,
  };
}

async function claimPaidPurchaseReportWithInjectedWallet(
  session: BaseInjectedWalletSession,
  input: ClaimPaidPurchaseReportCreditInput
): Promise<ClaimPaidPurchaseReportCreditResult> {
  const config = requireBaseContractWriteConfig();
  if (
    input.chainContext !== BASE_SEPOLIA_CHAIN_CONTEXT ||
    input.chainId !== BASE_SEPOLIA_CHAIN_ID ||
    !isAddress(input.contractAddress) ||
    getAddress(input.contractAddress) !== config.agentVouchAddress ||
    !/^\d+$/.test(input.reportId)
  ) {
    throw new Error("Paid-purchase credit deployment identity is invalid.");
  }
  const reportId = BigInt(input.reportId);
  if (reportId <= 0n || reportId > (1n << 64n) - 1n) {
    throw new Error("Paid-purchase report id is outside uint64 range.");
  }
  const publicClient = createBasePublicClient();
  await assertBaseSepoliaChain(publicClient);
  await ensureBaseSepoliaInjectedChain(session.provider);
  const [code, version, core, settlement, block] = await Promise.all([
    publicClient.getCode({ address: config.agentVouchAddress }),
    publicClient.readContract({
      address: config.agentVouchAddress,
      abi: AGENTVOUCH_EVM_A1_PAID_REPORT_ABI,
      functionName: "PROTOCOL_VERSION",
    }),
    publicClient.readContract({
      address: config.agentVouchAddress,
      abi: AGENTVOUCH_EVM_A1_PAID_REPORT_ABI,
      functionName: "getPaidPurchaseReportCore",
      args: [reportId],
    }),
    publicClient.readContract({
      address: config.agentVouchAddress,
      abi: AGENTVOUCH_EVM_A1_PAID_REPORT_ABI,
      functionName: "getPaidPurchaseReportSettlement",
      args: [reportId],
    }),
    publicClient.getBlock({ blockTag: "latest" }),
  ]);
  if (!code || version !== BASE_A1_PROTOCOL_VERSION) {
    throw new Error("Selected Base contract is not protocol base-v1-a1.");
  }
  if (
    String(namedOrIndexed(core, "buyer", 0)).toLowerCase() !==
    session.address.toLowerCase()
  ) {
    throw new Error("Only the initiating buyer can claim this report credit.");
  }
  if (
    Number(namedOrIndexed(core, "status", 8)) !==
    PAID_PURCHASE_REPORT_STATUS_TERMINAL
  ) {
    throw new Error("Paid-purchase report credit is not terminal and funded.");
  }
  const buyerCredit = BigInt(
    String(namedOrIndexed(settlement, "buyerCredit", 6) ?? 0)
  );
  const deadline = BigInt(
    String(namedOrIndexed(settlement, "claimDeadline", 7) ?? 0)
  );
  if (
    buyerCredit <= 0n ||
    Boolean(namedOrIndexed(settlement, "creditHandled", 8)) ||
    block.timestamp >= deadline
  ) {
    throw new Error("Paid-purchase report credit is unavailable or expired.");
  }
  await publicClient.simulateContract({
    account: session.address,
    address: config.agentVouchAddress,
    abi: AGENTVOUCH_EVM_A1_PAID_REPORT_ABI,
    functionName: "claimPaidPurchaseReportCredit",
    args: [reportId],
  });
  const txHash = await sendInjectedTransaction(
    session.provider,
    session.address,
    config.agentVouchAddress,
    encodeFunctionData({
      abi: AGENTVOUCH_EVM_A1_PAID_REPORT_ABI,
      functionName: "claimPaidPurchaseReportCredit",
      args: [reportId],
    })
  );
  const receipt = await waitForBaseTransactionReceipt(
    publicClient,
    txHash,
    "Base paid-purchase report credit claim"
  );
  const event = findBasePaidReportEvent(
    receipt.logs,
    config.agentVouchAddress,
    "PaidPurchaseReportCreditClaimed"
  );
  if (
    !event ||
    String(event.args.reportId) !== input.reportId ||
    String(event.args.buyer).toLowerCase() !== session.address.toLowerCase() ||
    event.args.amount !== buyerCredit
  ) {
    throw new Error(
      "Base paid-purchase credit receipt did not match the report."
    );
  }
  return {
    ref: txHash,
    txHash,
    reportId: input.reportId,
    explorerUrl: `${BASE_SEPOLIA_EXPLORER_URL}/tx/${txHash}`,
    paidGas: true,
  };
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
): PaidPurchaseReportChainWallet {
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
    registerAgent: (metadataUri) =>
      registerBaseAgentWithInjectedWallet(session, metadataUri),
    createSkillListing: () =>
      Promise.reject(
        new Error(
          "MetaMask listing creation is not enabled yet; use Coinbase Smart Wallet for Base author actions."
        )
      ),
    updateSkillListing: () =>
      Promise.reject(
        new Error(
          "MetaMask listing updates are not enabled yet; use Coinbase Smart Wallet for Base author actions."
        )
      ),
    removeSkillListing: () =>
      Promise.reject(
        new Error(
          "MetaMask listing removal is not enabled yet; use Coinbase Smart Wallet for Base author actions."
        )
      ),
    purchaseSkill: (input) =>
      purchaseBaseSkillWithInjectedWallet(session, input),
    depositAuthorBond: () => unsupportedAuthorWrite("Author bond deposit"),
    withdrawAuthorBond: () => unsupportedAuthorWrite("Author bond withdrawal"),
    vouchForAuthor: () => unsupportedAuthorWrite("Base vouching"),
    revokeVouch: () => unsupportedAuthorWrite("Base vouch revocation"),
    openAuthorReport: () => unsupportedAuthorWrite("Base author reports"),
    openPaidPurchaseReport: (input) =>
      openPaidPurchaseReportWithInjectedWallet(session, input),
    claimPaidPurchaseReportCredit: (input) =>
      claimPaidPurchaseReportWithInjectedWallet(session, input),
    claimVoucherRevenue: () => unsupportedAuthorWrite("Voucher revenue claim"),
    withdrawAuthorProceeds: () =>
      unsupportedAuthorWrite("Author proceeds withdrawal"),
    buildX402Payment: () =>
      Promise.reject(
        new Error(
          "buildX402Payment is not implemented for the MetaMask Base buyer wallet."
        )
      ),
  };
}
