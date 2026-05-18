"use client";

import {
  createContext,
  FC,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AppProvider,
  useConnectWallet,
  useDisconnectWallet,
  useWallet,
  useWalletConnectors,
} from "@solana/connector/react";
import {
  createKitTransactionSigner,
  createSolanaDevnet,
  createSolanaLocalnet,
  createSolanaMainnet,
  createSolanaTestnet,
  createTransactionSigner,
  getDefaultConfig,
  type TransactionSigner as ConnectorTransactionSigner,
  type TransactionSignerCapabilities,
} from "@solana/connector/headless";
import {
  address,
  type Address,
  type TransactionSigner as KitTransactionSigner,
} from "@solana/kit";
import type { WalletAccount } from "@wallet-standard/base";
import {
  AddressType,
  PhantomProvider,
  useAccounts,
  useDisconnect,
  usePhantom,
  useSolana,
  type PhantomSDKConfig,
} from "@phantom/react-sdk";
import { useMounted } from "@/hooks/useMounted";
import {
  createPhantomEmbeddedWallet,
  PHANTOM_EMBEDDED_WALLET_NAME,
  type PhantomEmbeddedWalletHandle,
} from "@/lib/phantomEmbeddedWalletStandard";
import {
  createPhantomLegacyWallet,
  getPhantomLegacyProvider,
  PHANTOM_LEGACY_WALLET_NAME,
  type PhantomLegacyWalletHandle,
} from "@/lib/phantomLegacyWalletStandard";

const PhantomConfiguredContext = createContext(false);
export const usePhantomConfigured = () => useContext(PhantomConfiguredContext);
const PhantomDisconnectContext = createContext<(() => Promise<void>) | null>(
  null
);
export const usePhantomDisconnect = () => useContext(PhantomDisconnectContext);
const AGENTVOUCH_WALLET_STORAGE_KEY = "agentvouch:v1:wallet";
const CONNECTOR_KIT_WALLET_STORAGE_KEY = "connector-kit:v1:wallet";
const EMPTY_SIGNER_CAPABILITIES: TransactionSignerCapabilities = {
  canSign: false,
  canSend: false,
  canSignMessage: false,
  supportsBatchSigning: false,
};

type AgentVouchWalletStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";
type AgentVouchWalletSource =
  | "phantom-extension"
  | "phantom-embedded"
  | "connector-kit"
  | null;

type AgentVouchWalletContextValue = {
  status: AgentVouchWalletStatus;
  account: Address | null;
  walletName: string | null;
  source: AgentVouchWalletSource;
  phantomInstalled: boolean;
  connectPhantomExtension: () => Promise<void>;
  disconnect: () => Promise<void>;
};

type AgentVouchWalletSignerContextValue = {
  connectorSigner: ConnectorTransactionSigner | null;
  kitSigner: KitTransactionSigner | null;
  capabilities: TransactionSignerCapabilities;
  signMessage: ((message: Uint8Array) => Promise<Uint8Array>) | null;
  source: AgentVouchWalletSource;
};

const AgentVouchWalletContext = createContext<AgentVouchWalletContextValue>({
  status: "disconnected",
  account: null,
  walletName: null,
  source: null,
  phantomInstalled: false,
  connectPhantomExtension: async () => {
    throw new Error("Wallet provider is not mounted");
  },
  disconnect: async () => {},
});

const AgentVouchWalletSignerContext =
  createContext<AgentVouchWalletSignerContextValue>({
    connectorSigner: null,
    kitSigner: null,
    capabilities: EMPTY_SIGNER_CAPABILITIES,
    signMessage: null,
    source: null,
  });

export const useAgentVouchWallet = () => useContext(AgentVouchWalletContext);
export const useAgentVouchWalletSigner = () =>
  useContext(AgentVouchWalletSignerContext);

const ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const PHANTOM_APP_ID = process.env.NEXT_PUBLIC_PHANTOM_APP_ID ?? "";
// ConnectorKit + Phantom embedded both need to know which cluster to target.
// Derive from the RPC URL so changing one env var moves the whole stack.
const TARGET_NETWORK: "devnet" | "mainnet" | "testnet" | "localnet" =
  ENDPOINT.includes("devnet")
    ? "devnet"
    : ENDPOINT.includes("testnet")
    ? "testnet"
    : ENDPOINT.includes("localhost") || ENDPOINT.includes("127.0.0.1")
    ? "localnet"
    : "mainnet";
const PHANTOM_NETWORK: "devnet" | "mainnet" =
  TARGET_NETWORK === "mainnet" ? "mainnet" : "devnet";
const CONNECTOR_CLUSTER =
  TARGET_NETWORK === "mainnet"
    ? createSolanaMainnet(ENDPOINT)
    : TARGET_NETWORK === "testnet"
    ? createSolanaTestnet(ENDPOINT)
    : TARGET_NETWORK === "localnet"
    ? createSolanaLocalnet(ENDPOINT)
    : createSolanaDevnet(ENDPOINT);

/**
 * Bridges the Phantom embedded session into the Wallet Standard wallet
 * handle so ConnectorKit (and any other wallet-standard consumer) sees it
 * as a regular wallet with the user's Solana account exposed.
 *
 * Also pins the Phantom embedded SDK to the configured network on every
 * (re)connect, because the SDK defaults to mainnet at init regardless of
 * the surrounding app, and programmatically connects ConnectorKit to the
 * embedded wallet once the Phantom OAuth flow has produced an account.
 *
 * Mounted INSIDE `<AppProvider>` so it can call ConnectorKit hooks.
 */
function PhantomEmbeddedBridge({
  handle,
}: {
  handle: PhantomEmbeddedWalletHandle;
}) {
  const phantom = usePhantom();
  const accounts = useAccounts();
  const { solana, isAvailable } = useSolana();
  const { connect } = useConnectWallet();
  const connectors = useWalletConnectors();
  const wallet = useWallet();

  const embeddedConnectorId = useMemo(
    () =>
      connectors.find((c) => c.name === PHANTOM_EMBEDDED_WALLET_NAME)?.id ??
      null,
    [connectors]
  );

  useEffect(() => {
    let cancelled = false;

    if (!isAvailable || !phantom.isConnected || !solana) {
      handle.clearSession();
      return () => {
        cancelled = true;
      };
    }
    const solanaAccount = accounts?.find(
      (a) => a.addressType === AddressType.solana
    );
    if (!solanaAccount) {
      handle.clearSession();
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        await solana.switchNetwork(PHANTOM_NETWORK);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to switch Phantom embedded network:", error);
          handle.clearSession();
        }
        return;
      }

      if (cancelled) return;
      handle.setSession(solana as never, solanaAccount.address);
      // Surface the embedded session to ConnectorKit if nothing else is
      // already connected. Skipped when another wallet (e.g. extension) is
      // active so we don't fight it.
      if (
        embeddedConnectorId &&
        (wallet.status === "disconnected" || wallet.status === "error")
      ) {
        try {
          await connect(embeddedConnectorId);
        } catch (error) {
          if (!cancelled) {
            console.error("Failed to connect Phantom embedded wallet:", error);
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    phantom.isConnected,
    isAvailable,
    solana,
    accounts,
    handle,
    embeddedConnectorId,
    connect,
    wallet.status,
  ]);

  return null;
}

function PhantomDisconnectProvider({ children }: { children: ReactNode }) {
  const phantomDisconnect = useDisconnect();
  const disconnect = useMemo(
    () => async () => {
      await phantomDisconnect.disconnect();
    },
    [phantomDisconnect]
  );

  return (
    <PhantomDisconnectContext.Provider value={disconnect}>
      {children}
    </PhantomDisconnectContext.Provider>
  );
}

function readStoredWalletName(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function getStoredWalletName(): string | null {
  return (
    readStoredWalletName(AGENTVOUCH_WALLET_STORAGE_KEY) ??
    readStoredWalletName(CONNECTOR_KIT_WALLET_STORAGE_KEY)
  );
}

function saveStoredWalletName(name: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      AGENTVOUCH_WALLET_STORAGE_KEY,
      JSON.stringify(name)
    );
  } catch {
    // Storage full or blocked — non-critical.
  }
}

function clearStoredWalletName() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(AGENTVOUCH_WALLET_STORAGE_KEY);
  } catch {
    // Storage full or blocked — non-critical.
  }
}

function StoredWalletAutoConnectBridge({
  initialWalletName,
}: {
  initialWalletName: string | null;
}) {
  const attemptedRef = useRef(false);
  const wasConnectedRef = useRef(false);
  const wallet = useWallet();
  const connectors = useWalletConnectors();
  const { connect } = useConnectWallet();

  // Persist the connected wallet name so we can auto-reconnect on refresh.
  useEffect(() => {
    if (wallet.status === "connected" && wallet.connectorId) {
      const name = connectors.find((c) => c.id === wallet.connectorId)?.name;
      if (name) {
        saveStoredWalletName(name);
        wasConnectedRef.current = true;
      }
    } else if (
      wallet.status === "disconnected" &&
      wasConnectedRef.current
    ) {
      clearStoredWalletName();
      wasConnectedRef.current = false;
    }
  }, [wallet.status, wallet.connectorId, connectors]);

  // On mount, attempt silent reconnect to the previously-connected wallet.
  useEffect(() => {
    if (attemptedRef.current) return;
    if (wallet.status === "connected" || wallet.status === "connecting") return;

    const storedWalletName =
      initialWalletName ?? getStoredWalletName();
    if (!storedWalletName) return;
    if (storedWalletName === PHANTOM_LEGACY_WALLET_NAME) return;

    const connector = connectors.find((c) => c.name === storedWalletName);
    if (!connector) return;

    attemptedRef.current = true;
    void connect(connector.id, {
      silent: true,
      allowInteractiveFallback: false,
    }).catch(() => {
      // Silent reconnect is best-effort; leave the normal connect button ready.
    });
  }, [connect, connectors, initialWalletName, wallet.status]);

  return null;
}

type StandardConnectResult = {
  accounts?: readonly WalletAccount[];
};
type StandardConnectFeature = {
  connect(input?: { silent?: boolean }): Promise<StandardConnectResult>;
};
type StandardDisconnectFeature = {
  disconnect(): Promise<void>;
};

function getStandardConnectFeature(
  handle: PhantomLegacyWalletHandle | null
): StandardConnectFeature | null {
  return (
    (handle?.wallet.features["standard:connect"] as
      | StandardConnectFeature
      | undefined) ?? null
  );
}

function getStandardDisconnectFeature(
  handle: PhantomLegacyWalletHandle | null
): StandardDisconnectFeature | null {
  return (
    (handle?.wallet.features["standard:disconnect"] as
      | StandardDisconnectFeature
      | undefined) ?? null
  );
}

function getFirstWalletAccount(
  handle: PhantomLegacyWalletHandle | null,
  address?: string | null
): WalletAccount | null {
  const accounts = handle?.wallet.accounts ?? [];
  if (!accounts.length) return null;
  return (
    accounts.find((account) => account.address === address) ??
    accounts[0] ??
    null
  );
}

function AgentVouchWalletBridge({
  children,
  phantomLegacy,
}: {
  children: ReactNode;
  phantomLegacy: PhantomLegacyWalletHandle | null;
}) {
  const connectorWallet = useWallet();
  const connectors = useWalletConnectors();
  const { disconnect: disconnectConnector } = useDisconnectWallet();
  const disconnectPhantomEmbedded = usePhantomDisconnect();
  const [phantomStatus, setPhantomStatus] =
    useState<AgentVouchWalletStatus>("disconnected");
  const [phantomAccount, setPhantomAccount] = useState<Address | null>(null);
  const directAutoConnectAttemptedRef = useRef(false);

  const connectorWalletName = useMemo(
    () =>
      connectorWallet.connectorId
        ? connectors.find((c) => c.id === connectorWallet.connectorId)?.name ??
          null
        : null,
    [connectorWallet.connectorId, connectors]
  );

  const setPhantomConnectedAccount = useCallback(
    (accountValue: string | null) => {
      const nextAccount = accountValue ? address(accountValue) : null;
      setPhantomAccount(nextAccount);
      setPhantomStatus(nextAccount ? "connected" : "disconnected");
    },
    []
  );

  useEffect(() => {
    if (!phantomLegacy) {
      setPhantomConnectedAccount(null);
      return;
    }

    const readAccount = (payload?: unknown) => {
      if (
        payload &&
        typeof payload === "object" &&
        "publicKey" in payload &&
        (payload as { publicKey?: unknown }).publicKey
      ) {
        return String((payload as { publicKey: unknown }).publicKey);
      }
      return phantomLegacy.provider.publicKey
        ? String(phantomLegacy.provider.publicKey)
        : null;
    };

    setPhantomConnectedAccount(readAccount());

    const onConnect = (payload?: unknown) => {
      const account = readAccount(payload);
      if (account) saveStoredWalletName(PHANTOM_LEGACY_WALLET_NAME);
      setPhantomConnectedAccount(account);
    };
    const onAccountChanged = (payload?: unknown) => {
      const account = readAccount(payload);
      if (account) {
        saveStoredWalletName(PHANTOM_LEGACY_WALLET_NAME);
      }
      setPhantomConnectedAccount(account);
    };
    const onDisconnect = () => {
      clearStoredWalletName();
      setPhantomConnectedAccount(null);
    };

    phantomLegacy.provider.on?.("connect", onConnect);
    phantomLegacy.provider.on?.("accountChanged", onAccountChanged);
    phantomLegacy.provider.on?.("disconnect", onDisconnect);

    return () => {
      phantomLegacy.provider.off?.("connect", onConnect);
      phantomLegacy.provider.off?.("accountChanged", onAccountChanged);
      phantomLegacy.provider.off?.("disconnect", onDisconnect);
    };
  }, [phantomLegacy, setPhantomConnectedAccount]);

  const connectPhantomExtension = useCallback(
    async (input?: { silent?: boolean }) => {
      const connectFeature = getStandardConnectFeature(phantomLegacy);
      if (!phantomLegacy || !connectFeature) {
        throw new Error("Phantom extension is not installed");
      }

      setPhantomStatus("connecting");
      try {
        const result = await connectFeature.connect(
          input?.silent ? { silent: true } : undefined
        );
        const account =
          result.accounts?.[0]?.address ??
          (phantomLegacy.provider.publicKey
            ? String(phantomLegacy.provider.publicKey)
            : null);
        if (!account) throw new Error("Phantom did not return an account");
        saveStoredWalletName(PHANTOM_LEGACY_WALLET_NAME);
        setPhantomConnectedAccount(account);
      } catch (error) {
        setPhantomStatus("disconnected");
        setPhantomAccount(null);
        throw error;
      }
    },
    [phantomLegacy, setPhantomConnectedAccount]
  );

  useEffect(() => {
    if (!phantomLegacy || directAutoConnectAttemptedRef.current) return;
    if (getStoredWalletName() !== PHANTOM_LEGACY_WALLET_NAME) return;

    directAutoConnectAttemptedRef.current = true;
    void connectPhantomExtension({ silent: true }).catch(() => {
      // Phantom only reconnects silently after the origin is trusted.
    });
  }, [connectPhantomExtension, phantomLegacy]);

  const connectorConnected =
    connectorWallet.status === "connected" && !!connectorWallet.account;
  const connectorConnecting = connectorWallet.status === "connecting";
  const directConnected = phantomStatus === "connected" && !!phantomAccount;
  const directConnecting = phantomStatus === "connecting";

  const status: AgentVouchWalletStatus = directConnected
    ? "connected"
    : connectorConnected
    ? "connected"
    : directConnecting || connectorConnecting
    ? "connecting"
    : connectorWallet.status === "error" || phantomStatus === "error"
    ? "error"
    : "disconnected";
  const walletName = directConnected
    ? PHANTOM_LEGACY_WALLET_NAME
    : connectorConnected
    ? connectorWalletName
    : null;
  const source: AgentVouchWalletSource = directConnected
    ? "phantom-extension"
    : connectorConnected
    ? connectorWalletName === PHANTOM_EMBEDDED_WALLET_NAME
      ? "phantom-embedded"
      : "connector-kit"
    : null;
  const account = directConnected
    ? phantomAccount
    : connectorConnected
    ? (connectorWallet.account as Address)
    : null;

  const directConnectorSigner = useMemo<ConnectorTransactionSigner | null>(() => {
    if (!directConnected || !phantomLegacy || !phantomAccount) return null;
    const account = getFirstWalletAccount(phantomLegacy, phantomAccount);
    if (!account) return null;
    return createTransactionSigner({
      wallet: phantomLegacy.wallet,
      account,
      cluster: CONNECTOR_CLUSTER,
    });
  }, [directConnected, phantomAccount, phantomLegacy]);

  const directKitSigner = useMemo<KitTransactionSigner | null>(
    () =>
      directConnectorSigner
        ? createKitTransactionSigner(directConnectorSigner)
        : null,
    [directConnectorSigner]
  );
  const directCapabilities = useMemo(
    () => directConnectorSigner?.getCapabilities() ?? EMPTY_SIGNER_CAPABILITIES,
    [directConnectorSigner]
  );

  const disconnect = useCallback(async () => {
    if (source === "phantom-extension") {
      try {
        await getStandardDisconnectFeature(phantomLegacy)?.disconnect();
      } finally {
        clearStoredWalletName();
        setPhantomConnectedAccount(null);
      }
      return;
    }

    try {
      await disconnectConnector();
    } finally {
      clearStoredWalletName();
      if (source === "phantom-embedded" && disconnectPhantomEmbedded) {
        await disconnectPhantomEmbedded().catch(() => {});
      }
    }
  }, [
    disconnectConnector,
    disconnectPhantomEmbedded,
    phantomLegacy,
    setPhantomConnectedAccount,
    source,
  ]);

  const walletValue = useMemo<AgentVouchWalletContextValue>(
    () => ({
      status,
      account,
      walletName,
      source,
      phantomInstalled: !!phantomLegacy,
      connectPhantomExtension: () => connectPhantomExtension(),
      disconnect,
    }),
    [
      account,
      connectPhantomExtension,
      disconnect,
      phantomLegacy,
      source,
      status,
      walletName,
    ]
  );

  const signerValue = useMemo<AgentVouchWalletSignerContextValue>(
    () => ({
      connectorSigner: directConnectorSigner,
      kitSigner: directKitSigner,
      capabilities: directCapabilities,
      signMessage: directConnectorSigner?.signMessage
        ? (message) => directConnectorSigner.signMessage!(message)
        : null,
      source,
    }),
    [directCapabilities, directConnectorSigner, directKitSigner, source]
  );

  return (
    <AgentVouchWalletContext.Provider value={walletValue}>
      <AgentVouchWalletSignerContext.Provider value={signerValue}>
        {children}
      </AgentVouchWalletSignerContext.Provider>
    </AgentVouchWalletContext.Provider>
  );
}

export const WalletContextProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const mounted = useMounted();
  const phantomReady = mounted && !!PHANTOM_APP_ID;

  const phantomEmbedded = useMemo(() => createPhantomEmbeddedWallet(), []);
  const [initialWalletName] = useState<string | null>(() =>
    typeof window === "undefined" ? null : getStoredWalletName()
  );
  const [phantomLegacy, setPhantomLegacy] =
    useState<PhantomLegacyWalletHandle | null>(null);

  useEffect(() => {
    if (!mounted) return;

    let cancelled = false;
    const detectPhantomLegacy = () => {
      if (cancelled) return;
      setPhantomLegacy((current) => {
        if (current) return current;
        const provider = getPhantomLegacyProvider();
        return provider ? createPhantomLegacyWallet(provider) : null;
      });
    };

    detectPhantomLegacy();
    const timeouts = [
      window.setTimeout(detectPhantomLegacy, 250),
      window.setTimeout(detectPhantomLegacy, 1000),
      window.setTimeout(detectPhantomLegacy, 2000),
    ];

    return () => {
      cancelled = true;
      for (const timeout of timeouts) {
        window.clearTimeout(timeout);
      }
    };
  }, [mounted]);

  useEffect(() => {
    return () => {
      phantomLegacy?.destroy();
    };
  }, [phantomLegacy]);

  const connectorConfig = useMemo(
    () =>
      getDefaultConfig({
        appName: "AgentVouch",
        network: TARGET_NETWORK,
        clusters: [CONNECTOR_CLUSTER],
        persistClusterSelection: false,
        autoConnect: false,
        enableMobile: false,
        walletConnect: false,
        additionalWallets: [
          phantomEmbedded.wallet,
          ...(phantomLegacy ? [phantomLegacy.wallet] : []),
        ],
      }),
    [phantomEmbedded, phantomLegacy]
  );
  const connectorConfigKey = phantomLegacy
    ? "wallets-with-phantom-legacy"
    : "wallets-base";

  const phantomConfig = useMemo<PhantomSDKConfig>(() => {
    const redirectUrl =
      mounted && typeof window !== "undefined"
        ? `${window.location.origin}/auth/callback`
        : undefined;

    return {
      appId: PHANTOM_APP_ID,
      providers: ["google", "apple"],
      addressTypes: [AddressType.solana],
      ...(redirectUrl ? { authOptions: { redirectUrl } } : {}),
    };
  }, [mounted]);

  const wantsPhantom = mounted && !!PHANTOM_APP_ID;

  return (
    <PhantomConfiguredContext.Provider value={phantomReady}>
      {wantsPhantom ? (
        <PhantomProvider config={phantomConfig}>
          <PhantomDisconnectProvider>
            <AppProvider
              key={connectorConfigKey}
              connectorConfig={connectorConfig}
            >
              <AgentVouchWalletBridge phantomLegacy={phantomLegacy}>
                <PhantomEmbeddedBridge handle={phantomEmbedded} />
                <StoredWalletAutoConnectBridge
                  initialWalletName={initialWalletName}
                />
                {children}
              </AgentVouchWalletBridge>
            </AppProvider>
          </PhantomDisconnectProvider>
        </PhantomProvider>
      ) : (
        <AppProvider key={connectorConfigKey} connectorConfig={connectorConfig}>
          <AgentVouchWalletBridge phantomLegacy={phantomLegacy}>
            <StoredWalletAutoConnectBridge
              initialWalletName={initialWalletName}
            />
            {children}
          </AgentVouchWalletBridge>
        </AppProvider>
      )}
    </PhantomConfiguredContext.Provider>
  );
};
