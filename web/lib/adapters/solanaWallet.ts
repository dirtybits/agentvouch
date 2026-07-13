"use client";

// Solana ChainWallet (Phase 2 circle-back). A thin facade over lib/solanaWrites.ts — the same
// implementation the legacy hooks call — so wallet-bound writes are uniform across chains at
// the call site. Connection stays in WalletContextProvider; sessions come from
// useWritableChainWallet, which composes the wallet context with the transaction signer.

import { address } from "@solana/kit";
import {
  getConfiguredSolanaChainContext,
  getConfiguredSolanaExplorerAddressUrl,
  getConfiguredSolanaExplorerTxUrl,
} from "@/lib/chains";
import {
  createSolanaSkillListing,
  purchaseSolanaSkill,
  registerSolanaAgent,
  type SolanaWriteSession,
} from "@/lib/solanaWrites";
import type {
  ChainWallet,
  CreateSkillListingInput,
  PurchaseSkillInput,
  PurchaseSkillResult,
  RegisterAgentResult,
  TxResult,
} from "./types";

export const SOLANA_BROWSER_WALLET_NAME = "Solana browser wallet";

function txResult(ref: string, paidGas: boolean): TxResult {
  return {
    ref,
    explorerUrl: getConfiguredSolanaExplorerTxUrl(ref),
    paidGas,
  };
}

const unsupportedSolanaTrustWrite = (action: string) =>
  Promise.reject(
    new Error(
      `${action} is still routed through the legacy Solana reputation hook; the ChainWallet trust-write facade is implemented for Base first in Phase 9.`
    )
  );

export function createSolanaChainWallet(input: {
  session: SolanaWriteSession;
  disconnect: () => Promise<void>;
}): ChainWallet {
  const { session, disconnect } = input;

  return {
    chainContext: getConfiguredSolanaChainContext(),
    address: String(session.walletAddress),
    disconnect,

    async registerAgent(metadataUri: string): Promise<RegisterAgentResult> {
      const { tx, agentProfile, sponsored } = await registerSolanaAgent(
        session,
        metadataUri
      );
      return {
        ...txResult(String(tx), !sponsored),
        agentProfile: String(agentProfile),
      };
    },

    async createSkillListing(
      listing: CreateSkillListingInput
    ): Promise<TxResult> {
      const { tx, summary } = await createSolanaSkillListing(session, {
        skillId: listing.skillId,
        skillUri: listing.uri,
        name: listing.name,
        description: listing.description,
        priceUsdcMicros: listing.priceUsdcMicros,
      });
      return txResult(String(tx), summary.feePayer === session.signer.address);
    },

    updateSkillListing: () =>
      Promise.reject(
        new Error(
          "Solana listing updates are still routed through the legacy reputation hook."
        )
      ),

    removeSkillListing: () =>
      Promise.reject(
        new Error(
          "Solana listing removal is still routed through the legacy reputation hook."
        )
      ),

    async purchaseSkill(
      purchase: PurchaseSkillInput
    ): Promise<PurchaseSkillResult> {
      const result = await purchaseSolanaSkill(session, {
        skillListingKey: address(purchase.listingId),
        expectedPriceUsdcMicros: purchase.expectedPriceUsdcMicros,
      });
      if (result.alreadyPurchased) {
        // No transaction was sent; the ref is the existing purchase receipt account.
        return {
          ref: String(result.purchase),
          explorerUrl: getConfiguredSolanaExplorerAddressUrl(
            String(result.purchase)
          ),
          paidGas: false,
          alreadyPurchased: true,
        };
      }
      // Sponsored checkout pays gas from the sponsor account; direct pays from the buyer.
      return txResult(
        String(result.tx),
        result.summary.feePayer === session.signer.address
      );
    },

    depositAuthorBond: () => unsupportedSolanaTrustWrite("Author bond deposit"),
    withdrawAuthorBond: () =>
      unsupportedSolanaTrustWrite("Author bond withdrawal"),
    vouchForAuthor: () => unsupportedSolanaTrustWrite("Solana vouching"),
    revokeVouch: () => unsupportedSolanaTrustWrite("Solana vouch revocation"),
    openAuthorReport: () =>
      unsupportedSolanaTrustWrite("Solana author reports"),
    claimVoucherRevenue: () =>
      unsupportedSolanaTrustWrite("Solana voucher revenue claim"),
    withdrawAuthorProceeds: () =>
      unsupportedSolanaTrustWrite("Solana author proceeds withdrawal"),

    buildX402Payment: () =>
      Promise.reject(
        new Error(
          `buildX402Payment is part of AgentVouch Phase 2d but is not implemented for the ${SOLANA_BROWSER_WALLET_NAME}.`
        )
      ),
  };
}
