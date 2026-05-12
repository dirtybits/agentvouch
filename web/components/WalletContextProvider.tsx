"use client";

import { createContext, FC, ReactNode, useContext, useEffect, useMemo } from "react";
import { SolanaProvider } from "@solana/react-hooks";
import { autoDiscover, createClient } from "@solana/client";
import {
  AddressType,
  PhantomProvider,
  useAccounts,
  usePhantom,
  useSolana,
  type PhantomSDKConfig,
} from "@phantom/react-sdk";
import { useMounted } from "@/hooks/useMounted";

function PhantomDebugShim() {
  const phantom = usePhantom();
  const accounts = useAccounts();
  const { solana, isAvailable } = useSolana();
  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as unknown as { __phantom?: unknown }).__phantom = {
      phantom,
      accounts,
      solana,
      isAvailable,
    };
    // eslint-disable-next-line no-console
    console.info(
      "[PhantomDebugShim] window.__phantom set",
      { isConnected: phantom.isConnected, isAvailable, accountCount: accounts?.length ?? 0 }
    );
  }, [phantom, accounts, solana, isAvailable]);
  return null;
}

const PhantomConfiguredContext = createContext(false);
export const usePhantomConfigured = () => useContext(PhantomConfiguredContext);

const ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const PHANTOM_APP_ID = process.env.NEXT_PUBLIC_PHANTOM_APP_ID ?? "";

export const WalletContextProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const mounted = useMounted();
  const phantomReady = mounted && !!PHANTOM_APP_ID;

  const client = useMemo(
    () =>
      createClient({
        endpoint: ENDPOINT,
        walletConnectors: autoDiscover(),
      }),
    []
  );

  const phantomConfig = useMemo<PhantomSDKConfig>(
    () => {
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
    },
    [mounted]
  );

  const wantsPhantom = mounted && !!PHANTOM_APP_ID;

  const solanaProvider = (
    <SolanaProvider client={client}>{children}</SolanaProvider>
  );

  return (
    <PhantomConfiguredContext.Provider value={phantomReady}>
      {wantsPhantom ? (
        <PhantomProvider config={phantomConfig}>
          {process.env.NODE_ENV !== "production" ? <PhantomDebugShim /> : null}
          {solanaProvider}
        </PhantomProvider>
      ) : (
        solanaProvider
      )}
    </PhantomConfiguredContext.Provider>
  );
};
