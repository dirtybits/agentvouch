import { describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";

import {
  BASE_SEPOLIA_CHAIN_ID_HEX,
  createBaseInjectedChainWallet,
  ensureBaseSepoliaInjectedChain,
  getInjectedMetaMaskProvider,
  probeBaseInjectedExecutionMode,
  selectMetaMaskProvider,
  type BaseInjectedWalletSession,
  type Eip1193Provider,
} from "@/lib/adapters/baseInjectedWallet";

type MockProvider = Eip1193Provider & {
  requests: { method: string; params?: unknown[] | Record<string, unknown> }[];
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
  } = {}
): MockProvider {
  const requests: MockProvider["requests"] = [];
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
      return [];
    }),
  };
}

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

  it("does not select legacy injected providers that only spoof MetaMask compatibility", () => {
    const phantomCompat = provider({ isMetaMask: true, isPhantom: true });
    const braveCompat = provider({ isMetaMask: true, isBraveWallet: true });
    const rabbyCompat = provider({ isMetaMask: true, isRabby: true });

    expect(
      selectMetaMaskProvider([phantomCompat, braveCompat, rabbyCompat])
    ).toBeNull();
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

  it("keeps author writes unsupported for the buyer-only MetaMask pass", async () => {
    const session: BaseInjectedWalletSession = {
      provider: provider({ isMetaMask: true }),
      address: getAddress("0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854"),
      executionMode: "eoa",
    };
    const wallet = createBaseInjectedChainWallet(session, async () => {});

    await expect(wallet.registerAgent("ipfs://agent")).rejects.toThrow(
      /Coinbase Smart Wallet/
    );
    await expect(
      wallet.createSkillListing({
        skillId: "demo",
        uri: "https://example.com/skill.md",
        name: "Demo",
        description: "Demo",
        priceUsdcMicros: 1_000_000n,
      })
    ).rejects.toThrow(/Coinbase Smart Wallet/);
  });
});
