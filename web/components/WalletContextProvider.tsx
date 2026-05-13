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
import { SolanaProvider } from "@solana/react-hooks";
import { autoDiscover, createClient } from "@solana/client";
import {
  AppProvider,
  useConnectWallet,
  useWallet,
  useWalletConnectors,
} from "@solana/connector/react";
import { getDefaultConfig } from "@solana/connector/headless";
import {
  AddressType,
  PhantomProvider,
  useAccounts,
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
    if (!isAvailable || !phantom.isConnected || !solana) {
      handle.clearSession();
      return;
    }
    const solanaAccount = accounts?.find(
      (a) => a.addressType === AddressType.solana
    );
    if (!solanaAccount) {
      handle.clearSession();
      return;
    }
    handle.setSession(solana as never, solanaAccount.address);
    // Idempotent: if already on this network, Phantom's SDK no-ops.
    void solana.switchNetwork(PHANTOM_NETWORK).catch(() => {
      // Transient or already-correct network — safe to ignore.
    });
    // Surface the embedded session to ConnectorKit if nothing else is
    // already connected. Skipped when another wallet (e.g. extension) is
    // active so we don't fight it.
    if (
      embeddedConnectorId &&
      (wallet.status === "disconnected" || wallet.status === "error")
    ) {
      void connect(embeddedConnectorId).catch(() => {
        // ConnectorKit will report via its own error surface.
      });
    }
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

  // Legacy @solana/react-hooks client — kept during the migration so
  // existing `useWalletConnection` consumers continue to work. Will be
  // removed once all call sites are migrated to ConnectorKit's useWallet.
  const legacyClient = useMemo(
    () =>
      createClient({
        endpoint: ENDPOINT,
        walletConnectors: autoDiscover(),
      }),
    []
  );

  const connectorConfig = useMemo(
    () =>
      getDefaultConfig({
        appName: "AgentVouch",
        network: TARGET_NETWORK,
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
          <AppProvider connectorConfig={connectorConfig}>
            <PhantomEmbeddedBridge handle={phantomEmbedded} />
            <SolanaProvider client={legacyClient}>{children}</SolanaProvider>
          </AppProvider>
        </PhantomProvider>
      ) : (
        <AppProvider connectorConfig={connectorConfig}>
          <SolanaProvider client={legacyClient}>{children}</SolanaProvider>
        </AppProvider>
      )}
    </PhantomConfiguredContext.Provider>
  );
};
