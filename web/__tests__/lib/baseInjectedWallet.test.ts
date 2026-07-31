import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionResult,
  erc20Abi,
  getAddress,
} from "viem";

const baseWalletMocks = vi.hoisted(() => {
  const eventArgs = new Map<string, Record<string, unknown>>();
  const publicClient = {
    getChainId: vi.fn(async () => 84_532),
    readContract: vi.fn(),
    simulateContract: vi.fn(async () => ({})),
  };
  return {
    eventArgs,
    publicClient,
    waitForBaseTransactionReceipt: vi.fn(async () => ({ logs: [] })),
  };
});

vi.mock("@/lib/adapters/baseWallet", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/adapters/baseWallet")
  >();
  return {
    ...actual,
    assertBaseSepoliaChain: vi.fn(async () => {}),
    createBasePublicClient: vi.fn(() => baseWalletMocks.publicClient),
    findBaseWalletEvent: vi.fn(
      (
        _logs: unknown,
        _contract: unknown,
        eventName: string
      ): { eventName: string; args: Record<string, unknown> } | null => {
        const args = baseWalletMocks.eventArgs.get(eventName);
        return args ? { eventName, args } : null;
      }
    ),
    requireBaseContractWriteConfig: vi.fn(() => ({
      agentVouchAddress: getAddress(
        "0x1111111111111111111111111111111111111111"
      ),
      usdcAddress: getAddress("0x2222222222222222222222222222222222222222"),
    })),
    waitForBaseTransactionReceipt:
      baseWalletMocks.waitForBaseTransactionReceipt,
  };
});

import {
  AGENTVOUCH_EVM_WRITE_ABI,
  computeListingId,
  skillIdHashFrom,
} from "@/lib/adapters/baseWallet";
import {
  BASE_SEPOLIA_CHAIN_ID_HEX,
  createBaseInjectedChainWallet,
  ensureBaseSepoliaInjectedChain,
  getInjectedMetaMaskProvider,
  probeBaseInjectedExecutionMode,
  reconcileDetectedMetaMaskProvider,
  selectMetaMaskProvider,
  type BaseInjectedWalletSession,
  type Eip1193Provider,
} from "@/lib/adapters/baseInjectedWallet";

type MockProvider = Eip1193Provider & {
  requests: { method: string; params?: unknown[] | Record<string, unknown> }[];
  coreProvider?: unknown;
  addProvider?: unknown;
};

function provider(
  input: {
    isMetaMask?: boolean;
    isPhantom?: boolean;
    isBraveWallet?: boolean;
    isCoinbaseWallet?: boolean;
    isRabby?: boolean;
    chainId?: string;
    signature?: string;
    capabilities?: unknown;
    transactionHashes?: string[];
    transactionErrorAt?: number;
  } = {}
): MockProvider {
  const requests: MockProvider["requests"] = [];
  const transactionHashes = [...(input.transactionHashes ?? [])];
  let transactionCount = 0;
  return {
    isMetaMask: input.isMetaMask,
    isPhantom: input.isPhantom,
    isBraveWallet: input.isBraveWallet,
    isCoinbaseWallet: input.isCoinbaseWallet,
    isRabby: input.isRabby,
    requests,
    request: vi.fn(async (args) => {
      requests.push(args);
      if (args.method === "eth_chainId")
        return input.chainId ?? BASE_SEPOLIA_CHAIN_ID_HEX;
      if (args.method === "wallet_switchEthereumChain") return null;
      if (args.method === "personal_sign") return input.signature ?? "0xabc123";
      if (args.method === "wallet_getCapabilities")
        return input.capabilities ?? {};
      if (args.method === "eth_sendTransaction") {
        transactionCount += 1;
        if (transactionCount === input.transactionErrorAt) {
          throw new Error("MetaMask rejected the action transaction");
        }
        return (
          transactionHashes.shift() ??
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        );
      }
      return [];
    }),
  };
}

const CONTRACT = getAddress("0x1111111111111111111111111111111111111111");

function sentTransactionData(mockProvider: MockProvider): `0x${string}`[] {
  return mockProvider.requests
    .filter((request) => request.method === "eth_sendTransaction")
    .map((request) => {
      const params = request.params as [{ data: `0x${string}` }];
      return params[0].data;
    });
}

describe("Base injected ChainWallet writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    baseWalletMocks.eventArgs.clear();
    baseWalletMocks.publicClient.readContract.mockImplementation(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === "getProfile") return { registered: true };
        if (functionName === "balanceOf") return 10_000_000n;
        if (functionName === "allowance") return 0n;
        throw new Error(`Unexpected readContract call: ${functionName}`);
      }
    );
    baseWalletMocks.publicClient.simulateContract.mockResolvedValue({});
    baseWalletMocks.waitForBaseTransactionReceipt.mockResolvedValue({
      logs: [],
    });
  });

  function walletWithProvider(mockProvider: MockProvider) {
    const address = getAddress("0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854");
    return {
      address,
      wallet: createBaseInjectedChainWallet(
        { provider: mockProvider, address, executionMode: "eoa" },
        async () => {}
      ),
    };
  }

  it("uses the legacy-compatible profile ABI for pre-A1 trust writes", () => {
    const encoded = encodeFunctionResult({
      abi: AGENTVOUCH_EVM_WRITE_ABI,
      functionName: "getProfile",
      result: {
        registered: true,
        metadataUri: "agentvouch://test",
        reputationScore: 0n,
        totalVouchesReceived: 0n,
        totalVouchesGiven: 0n,
        totalVouchStakeReceivedUsdcMicros: 0n,
        authorBondUsdcMicros: 0n,
        activeFreeListingCount: 0n,
        openDisputes: 0n,
        upheldDisputes: 0n,
        dismissedDisputes: 0n,
        rewardIndexUsdcMicrosX1e12: 0n,
        unclaimedVoucherRevenueUsdcMicros: 0n,
        registeredAt: 1n,
      },
    } as never);
    const decoded = decodeFunctionResult({
      abi: AGENTVOUCH_EVM_WRITE_ABI,
      functionName: "getProfile",
      data: encoded,
    } as never) as unknown as { registered: boolean };

    expect(decoded.registered).toBe(true);
  });

  it("submits and verifies the full listing lifecycle", async () => {
    const metamask = provider({ isMetaMask: true });
    const { address, wallet } = walletWithProvider(metamask);
    const skillIdHash = skillIdHashFrom("demo");
    const listingId = computeListingId(address, skillIdHash);

    baseWalletMocks.eventArgs.set("SkillListingCreated", {
      listingId,
      author: address,
      price: 1_000_000n,
    });
    await expect(
      wallet.createSkillListing({
        skillId: "demo",
        uri: "https://example.com/skill.md",
        name: "Demo",
        description: "Demo listing",
        priceUsdcMicros: 1_000_000n,
      })
    ).resolves.toMatchObject({ paidGas: true });

    baseWalletMocks.eventArgs.set("SkillListingUpdated", {
      listingId,
      author: address,
      price: 2_000_000n,
    });
    await expect(
      wallet.updateSkillListing({
        listingId,
        skillId: "demo",
        uri: "https://example.com/skill-v2.md",
        name: "Demo v2",
        description: "Updated listing",
        priceUsdcMicros: 2_000_000n,
      })
    ).resolves.toMatchObject({ paidGas: true });

    baseWalletMocks.eventArgs.set("SkillListingRemoved", { listingId });
    await expect(
      wallet.removeSkillListing({ listingId })
    ).resolves.toMatchObject({ paidGas: true });

    expect(
      sentTransactionData(metamask).map(
        (data) =>
          decodeFunctionData({ abi: AGENTVOUCH_EVM_WRITE_ABI, data })
            .functionName
      )
    ).toEqual([
      "createSkillListing",
      "updateSkillListing",
      "removeSkillListing",
    ]);
  });

  it("uses an exact reset-and-approve sequence before an author bond deposit", async () => {
    const metamask = provider({ isMetaMask: true });
    const { address, wallet } = walletWithProvider(metamask);
    baseWalletMocks.publicClient.readContract.mockImplementation(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === "getProfile") return { registered: true };
        if (functionName === "balanceOf") return 10_000_000n;
        if (functionName === "allowance") return 500_000n;
        throw new Error(`Unexpected readContract call: ${functionName}`);
      }
    );
    baseWalletMocks.eventArgs.set("AuthorBondDeposited", {
      author: address,
      amount: 1_000_000n,
    });

    await expect(
      wallet.depositAuthorBond({ amountUsdcMicros: 1_000_000n })
    ).resolves.toMatchObject({ paidGas: true });

    const [reset, approval, deposit] = sentTransactionData(metamask);
    expect(decodeFunctionData({ abi: erc20Abi, data: reset })).toMatchObject({
      functionName: "approve",
      args: [CONTRACT, 0n],
    });
    expect(decodeFunctionData({ abi: erc20Abi, data: approval })).toMatchObject(
      {
        functionName: "approve",
        args: [CONTRACT, 1_000_000n],
      }
    );
    expect(
      decodeFunctionData({ abi: AGENTVOUCH_EVM_WRITE_ABI, data: deposit })
    ).toMatchObject({
      functionName: "depositAuthorBond",
      args: [1_000_000n],
    });
    expect(baseWalletMocks.publicClient.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({
        account: address,
        functionName: "depositAuthorBond",
        args: [1_000_000n],
      })
    );
    expect(baseWalletMocks.publicClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        abi: AGENTVOUCH_EVM_WRITE_ABI,
        functionName: "getProfile",
      })
    );

    const requestMock = vi.mocked(metamask.request);
    const transactionCallOrders = requestMock.mock.calls.flatMap(
      ([request], index) =>
        request.method === "eth_sendTransaction"
          ? [requestMock.mock.invocationCallOrder[index]]
          : []
    );
    const receiptCallOrders =
      baseWalletMocks.waitForBaseTransactionReceipt.mock.invocationCallOrder;
    const simulationCallOrder =
      baseWalletMocks.publicClient.simulateContract.mock.invocationCallOrder[0];
    expect(transactionCallOrders[0]).toBeLessThan(receiptCallOrders[0]);
    expect(receiptCallOrders[0]).toBeLessThan(transactionCallOrders[1]);
    expect(transactionCallOrders[1]).toBeLessThan(receiptCallOrders[1]);
    expect(receiptCallOrders[1]).toBeLessThan(simulationCallOrder);
    expect(simulationCallOrder).toBeLessThan(transactionCallOrders[2]);
    expect(transactionCallOrders[2]).toBeLessThan(receiptCallOrders[2]);
  });

  it("fails safely across approval, preflight, and action errors", async () => {
    const receiptFailureProvider = provider({ isMetaMask: true });
    const { wallet: receiptFailureWallet } = walletWithProvider(
      receiptFailureProvider
    );
    baseWalletMocks.publicClient.readContract.mockImplementation(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === "getProfile") return { registered: true };
        if (functionName === "balanceOf") return 10_000_000n;
        if (functionName === "allowance") return 500_000n;
        throw new Error(`Unexpected readContract call: ${functionName}`);
      }
    );
    baseWalletMocks.waitForBaseTransactionReceipt.mockRejectedValueOnce(
      new Error("approval reverted")
    );

    await expect(
      receiptFailureWallet.depositAuthorBond({
        amountUsdcMicros: 1_000_000n,
      })
    ).rejects.toThrow(/approval reverted/);
    expect(sentTransactionData(receiptFailureProvider)).toHaveLength(1);
    expect(
      baseWalletMocks.publicClient.simulateContract
    ).not.toHaveBeenCalled();

    vi.clearAllMocks();
    baseWalletMocks.publicClient.readContract.mockImplementation(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === "getProfile") return { registered: true };
        if (functionName === "balanceOf") return 10_000_000n;
        if (functionName === "allowance") return 0n;
        throw new Error(`Unexpected readContract call: ${functionName}`);
      }
    );
    baseWalletMocks.waitForBaseTransactionReceipt.mockResolvedValue({
      logs: [],
    });
    baseWalletMocks.publicClient.simulateContract.mockRejectedValueOnce(
      new Error("locked by report")
    );
    const preflightFailureProvider = provider({ isMetaMask: true });
    const { wallet: preflightFailureWallet } = walletWithProvider(
      preflightFailureProvider
    );

    await expect(
      preflightFailureWallet.vouchForAuthor({
        authorAddress: "0x3333333333333333333333333333333333333333",
        stakeUsdcMicros: 1_000_000n,
      })
    ).rejects.toThrow(/exact USDC allowance may remain/);
    expect(sentTransactionData(preflightFailureProvider)).toHaveLength(1);

    vi.clearAllMocks();
    baseWalletMocks.publicClient.readContract.mockImplementation(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === "getProfile") return { registered: true };
        if (functionName === "balanceOf") return 10_000_000n;
        if (functionName === "allowance") return 0n;
        throw new Error(`Unexpected readContract call: ${functionName}`);
      }
    );
    baseWalletMocks.waitForBaseTransactionReceipt.mockResolvedValue({
      logs: [],
    });
    baseWalletMocks.publicClient.simulateContract.mockResolvedValue({});
    const actionFailureProvider = provider({
      isMetaMask: true,
      transactionErrorAt: 2,
    });
    const { wallet: actionFailureWallet } = walletWithProvider(
      actionFailureProvider
    );

    await expect(
      actionFailureWallet.vouchForAuthor({
        authorAddress: "0x3333333333333333333333333333333333333333",
        stakeUsdcMicros: 1_000_000n,
      })
    ).rejects.toThrow(/exact USDC allowance may remain/);
  });

  it("routes vouch, revoke, withdrawals, and claims through MetaMask", async () => {
    const metamask = provider({ isMetaMask: true });
    const { address, wallet } = walletWithProvider(metamask);
    const author = getAddress("0x3333333333333333333333333333333333333333");
    const listingId =
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    baseWalletMocks.eventArgs.set("Vouched", {
      voucher: address,
      vouchee: author,
      stake: 1_000_000n,
    });
    await wallet.vouchForAuthor({
      authorAddress: author,
      stakeUsdcMicros: 1_000_000n,
    });

    baseWalletMocks.eventArgs.set("VouchRevoked", {
      voucher: address,
      vouchee: author,
    });
    await wallet.revokeVouch({ authorAddress: author });

    baseWalletMocks.eventArgs.set("AuthorBondWithdrawn", {
      author: address,
      amount: 500_000n,
    });
    await wallet.withdrawAuthorBond({ amountUsdcMicros: 500_000n });

    baseWalletMocks.eventArgs.set("VoucherRevenueClaimed", {
      voucher: address,
      author,
    });
    await wallet.claimVoucherRevenue({ authorAddress: author });

    baseWalletMocks.eventArgs.set("AuthorProceedsWithdrawn", {
      listingId,
      revision: 2n,
      author: address,
      amount: 250_000n,
    });
    await wallet.withdrawAuthorProceeds({
      listingId,
      listingRevision: 2,
      amountUsdcMicros: 250_000n,
    });

    const protocolFunctions = sentTransactionData(metamask).flatMap((data) => {
      try {
        return [
          decodeFunctionData({ abi: AGENTVOUCH_EVM_WRITE_ABI, data })
            .functionName,
        ];
      } catch {
        return [];
      }
    });
    expect(protocolFunctions).toEqual([
      "vouch",
      "revokeVouch",
      "withdrawAuthorBond",
      "claimVoucherRevenue",
      "withdrawAuthorProceeds",
    ]);
  });

  it("rejects a transaction whose receipt event does not match the request", async () => {
    const metamask = provider({ isMetaMask: true });
    const { address, wallet } = walletWithProvider(metamask);
    const listingId = computeListingId(address, skillIdHashFrom("demo"));
    baseWalletMocks.eventArgs.set("SkillListingCreated", {
      listingId,
      author: getAddress("0x4444444444444444444444444444444444444444"),
      price: 1_000_000n,
    });

    await expect(
      wallet.createSkillListing({
        skillId: "demo",
        uri: "https://example.com/skill.md",
        name: "Demo",
        description: "Demo listing",
        priceUsdcMicros: 1_000_000n,
      })
    ).rejects.toThrow(/did not match the submitted listing/);
  });
});

describe("Base injected MetaMask provider detection", () => {
  it("chooses MetaMask from an injected provider list", () => {
    const coinbase = provider({ isMetaMask: false });
    const metamask = provider({ isMetaMask: true });

    expect(selectMetaMaskProvider([coinbase, metamask])).toBe(metamask);
    expect(
      getInjectedMetaMaskProvider({
        ethereum: { ...coinbase, providers: [coinbase, metamask] },
      } as never)
    ).toBe(metamask);
  });

  it("prefers the EIP-6963 MetaMask provider over compatibility flags", () => {
    const phantomCompat = provider({ isMetaMask: true, isPhantom: true });
    const metamask = provider({ isMetaMask: true });

    expect(
      selectMetaMaskProvider([
        {
          info: { rdns: "app.phantom", name: "Phantom" },
          provider: phantomCompat,
        },
        { info: { rdns: "io.metamask", name: "MetaMask" }, provider: metamask },
      ])
    ).toBe(metamask);
  });

  it("lets an authoritative EIP-6963 announcement replace a legacy compatibility provider", () => {
    const legacyCompat = provider({ isMetaMask: true });
    const metamask = provider({ isMetaMask: true });

    expect(
      reconcileDetectedMetaMaskProvider(legacyCompat, metamask, "eip6963")
    ).toBe(metamask);
    expect(
      reconcileDetectedMetaMaskProvider(metamask, legacyCompat, "legacy")
    ).toBe(metamask);
  });

  it("does not select legacy injected providers that only spoof MetaMask compatibility", () => {
    const phantomCompat = provider({ isMetaMask: true, isPhantom: true });
    const braveCompat = provider({ isMetaMask: true, isBraveWallet: true });
    const rabbyCompat = provider({ isMetaMask: true, isRabby: true });

    expect(
      selectMetaMaskProvider([phantomCompat, braveCompat, rabbyCompat])
    ).toBeNull();
  });

  it("skips Core Wallet's MetaMask-compatible provider shim", () => {
    const coreCompat = Object.assign(provider({ isMetaMask: true }), {
      coreProvider: {},
      addProvider: vi.fn(),
    });
    const metamask = provider({ isMetaMask: true });

    expect(selectMetaMaskProvider([coreCompat, metamask])).toBe(metamask);
  });
});

describe("Base injected chain switching", () => {
  it("rejects Base mainnet before attempting a switch", async () => {
    const metamask = provider({ isMetaMask: true, chainId: "0x2105" });

    await expect(ensureBaseSepoliaInjectedChain(metamask)).rejects.toThrow(
      /Base mainnet is not enabled/
    );
    expect(metamask.requests.map((request) => request.method)).toEqual([
      "eth_chainId",
    ]);
  });

  it("switches to Base Sepolia when MetaMask is on another test chain", async () => {
    const metamask = provider({ isMetaMask: true, chainId: "0xaa36a7" });

    await ensureBaseSepoliaInjectedChain(metamask);

    expect(metamask.requests).toContainEqual({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_SEPOLIA_CHAIN_ID_HEX }],
    });
  });
});

describe("Base injected execution mode probe", () => {
  it("records EOA fallback when MetaMask does not expose a 7702 batch capability", async () => {
    const metamask = provider({
      isMetaMask: true,
      capabilities: { "0x14a34": {} },
    });
    const address = getAddress("0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854");

    await expect(
      probeBaseInjectedExecutionMode(metamask, address)
    ).resolves.toBe("eoa");
    expect(metamask.requests).toContainEqual({
      method: "wallet_getCapabilities",
      params: [address, [BASE_SEPOLIA_CHAIN_ID_HEX]],
    });
  });

  it("records the skipped 7702 capability when MetaMask advertises atomic batching", async () => {
    const metamask = provider({
      isMetaMask: true,
      capabilities: { "0x14a34": { atomicBatch: { supported: true } } },
    });
    const address = getAddress("0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854");

    await expect(
      probeBaseInjectedExecutionMode(metamask, address)
    ).resolves.toBe("erc7702-capable-skipped");
  });

  it("records EOA fallback when the capability probe is unsupported", async () => {
    const metamask = provider({ isMetaMask: true });
    metamask.request = vi.fn(async () => {
      throw new Error("Method wallet_getCapabilities is not supported");
    });
    const address = getAddress("0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854");

    await expect(
      probeBaseInjectedExecutionMode(metamask, address)
    ).resolves.toBe("eoa");
  });
});

describe("Base injected ChainWallet", () => {
  it("lowercases API identity while personal_sign uses the connected EOA", async () => {
    const metamask = provider({ isMetaMask: true, signature: "0xfeed" });
    const address = getAddress("0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854");
    const session: BaseInjectedWalletSession = {
      provider: metamask,
      address,
      executionMode: "eoa",
    };

    const wallet = createBaseInjectedChainWallet(session, async () => {});
    await expect(wallet.signMessage?.("download message")).resolves.toBe(
      "0xfeed"
    );

    expect(wallet.address).toBe(address.toLowerCase());
    expect(metamask.requests).toContainEqual({
      method: "personal_sign",
      params: ["0x646f776e6c6f6164206d657373616765", address],
    });
  });

  it("exposes registration, paid reports, and the full existing Base write surface", async () => {
    const session: BaseInjectedWalletSession = {
      provider: provider({ isMetaMask: true }),
      address: getAddress("0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854"),
      executionMode: "eoa",
    };
    const wallet = createBaseInjectedChainWallet(session, async () => {});

    expect(typeof wallet.registerAgent).toBe("function");
    expect(typeof wallet.openPaidPurchaseReport).toBe("function");
    expect(typeof wallet.claimPaidPurchaseReportCredit).toBe("function");
    expect(typeof wallet.createSkillListing).toBe("function");
    expect(typeof wallet.updateSkillListing).toBe("function");
    expect(typeof wallet.removeSkillListing).toBe("function");
    expect(typeof wallet.depositAuthorBond).toBe("function");
    expect(typeof wallet.withdrawAuthorBond).toBe("function");
    expect(typeof wallet.vouchForAuthor).toBe("function");
    expect(typeof wallet.revokeVouch).toBe("function");
    expect(typeof wallet.claimVoucherRevenue).toBe("function");
    expect(typeof wallet.withdrawAuthorProceeds).toBe("function");
    await expect(
      wallet.openAuthorReport({
        authorAddress: "0x0000000000000000000000000000000000000001",
        evidenceUri: "https://example.com/evidence",
      })
    ).rejects.toThrow(/receipt-bound paid-purchase report/);
  });
});
