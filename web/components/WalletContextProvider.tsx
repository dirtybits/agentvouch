"use client";

import {
  createContext,
  FC,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  AppProvider,
  useConnectWallet,
  useWallet,
  useWalletConnectors,
} from "@solana/connector/react";
import {
  createSolanaDevnet,
  createSolanaLocalnet,
  createSolanaMainnet,
  createSolanaTestnet,
  getDefaultConfig,
} from "@solana/connector/headless";
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

const PhantomConfiguredContext = createContext(false);
export const usePhantomConfigured = () => useContext(PhantomConfiguredContext);
const PhantomDisconnectContext = createContext<(() => Promise<void>) | null>(
  null
);
export const usePhantomDisconnect = () => useContext(PhantomDisconnectContext);

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

export const WalletContextProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const mounted = useMounted();
  const phantomReady = mounted && !!PHANTOM_APP_ID;

  // Stable handle — one per provider instance, lives across re-renders.
  const phantomEmbeddedRef = useRef<PhantomEmbeddedWalletHandle | null>(null);
  if (!phantomEmbeddedRef.current) {
    phantomEmbeddedRef.current = createPhantomEmbeddedWallet();
  }
  const phantomEmbedded = phantomEmbeddedRef.current;

  const connectorConfig = useMemo(
    () =>
      getDefaultConfig({
        appName: "AgentVouch",
        network: TARGET_NETWORK,
        clusters: [CONNECTOR_CLUSTER],
        persistClusterSelection: false,
        autoConnect: true,
        enableMobile: false,
        walletConnect: false,
        additionalWallets: [phantomEmbedded.wallet],
      }),
    [phantomEmbedded]
  );

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
            <AppProvider connectorConfig={connectorConfig}>
              <PhantomEmbeddedBridge handle={phantomEmbedded} />
              {children}
            </AppProvider>
          </PhantomDisconnectProvider>
        </PhantomProvider>
      ) : (
        <AppProvider connectorConfig={connectorConfig}>{children}</AppProvider>
      )}
    </PhantomConfiguredContext.Provider>
  );
};
