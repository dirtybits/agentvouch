"use client";

// Write-focused chain wallet hook (Phase 2 circle-back).
//
// useChainWallet() from WalletContextProvider stays the lightweight status/session hook the
// header uses; it deliberately does NOT build a Solana ChainWallet (that would pull the Solana
// write stack into the provider and every page). Write-heavy surfaces call this hook instead:
// it returns the Base passkey ChainWallet when Base is connected, or composes the connected
// Solana session with the shared write helpers into a Solana ChainWallet.

import { useMemo } from "react";
import type { Address } from "@solana/kit";
import { useChainWallet } from "@/components/WalletContextProvider";
import { useAgentVouchTransactionSigner } from "./useAgentVouchTransactionSigner";
import { createSolanaChainWallet } from "@/lib/adapters/solanaWallet";
import type { ChainWallet } from "@/lib/adapters/types";

export function useWritableChainWallet(): ChainWallet | null {
  const chain = useChainWallet();
  const { signer, connectorSigner, capabilities, signMessage } =
    useAgentVouchTransactionSigner();

  const solanaConnected =
    chain.solana.status === "connected" && !!chain.solana.account;
  const solanaAccount = chain.solana.account;
  const solanaDisconnect = chain.solana.disconnect;
  const baseChainWallet = chain.chainWallet;

  return useMemo(() => {
    // Base passkey session: the provider already built its ChainWallet.
    if (baseChainWallet) return baseChainWallet;

    if (!solanaConnected || !solanaAccount || !signer) return null;
    return createSolanaChainWallet({
      session: {
        signer,
        walletAddress: solanaAccount as Address,
        connectorSigner: connectorSigner ?? null,
        canSignSponsored: capabilities.canSign,
        signMessage,
      },
      disconnect: solanaDisconnect,
    });
  }, [
    baseChainWallet,
    solanaConnected,
    solanaAccount,
    solanaDisconnect,
    signer,
    connectorSigner,
    capabilities.canSign,
    signMessage,
  ]);
}
