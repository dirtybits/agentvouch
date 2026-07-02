"use client";

import { useCallback, useMemo } from "react";
import { address, type Address, type TransactionSigner } from "@solana/kit";
import type { Base58EncodedBytes, Base64EncodedBytes } from "@solana/rpc-types";
import { decodeBase64, encodeBase64 } from "@/lib/base64";
import {} from "@/lib/purchasePreflight";
import {} from "@/lib/chains";
import { wrapRpcLookupError } from "@/lib/rpcErrors";
import { getConfiguredUsdcMint } from "@/lib/x402";
import {} from "@/lib/sponsoredPurchaseClient";
import {} from "@/lib/agentvouchUsdc";
import { useAgentVouchTransactionSigner } from "./useAgentVouchTransactionSigner";
import { useAgentVouchWallet } from "@/components/WalletContextProvider";
import {
  fetchAllMaybePurchase,
  getPurchaseDecoder,
  PURCHASE_DISCRIMINATOR,
} from "../generated/agentvouch/src/generated/accounts/purchase";
import {
  fetchAllMaybeSkillListing,
  getSkillListingDecoder,
  SKILL_LISTING_DISCRIMINATOR,
} from "../generated/agentvouch/src/generated/accounts/skillListing";

import { AGENTVOUCH_PROGRAM_ADDRESS } from "../generated/agentvouch/src/generated/programs";
import {
  rpc,
  type SolanaWriteSession,
  getPurchasePDA,
  purchaseSolanaSkill,
} from "@/lib/solanaWrites";

const asBase64 = (bytes: Uint8Array) =>
  encodeBase64(bytes) as Base64EncodedBytes;
const asBase58 = (value: string) => value as unknown as Base58EncodedBytes;

export function useMarketplaceOracle() {
  const { status, account } = useAgentVouchWallet();
  const connected = status === "connected" && !!account;
  const {
    signer: activeSigner,
    connectorSigner,
    capabilities,
  } = useAgentVouchTransactionSigner();

  const walletAddress: Address | null = connected ? (account as Address) : null;

  const signer: TransactionSigner | null = activeSigner ?? null;

  const writeSession = useMemo<SolanaWriteSession | null>(
    () =>
      signer && walletAddress
        ? {
            signer,
            walletAddress,
            connectorSigner: connectorSigner ?? null,
            canSignSponsored: capabilities.canSign,
          }
        : null,
    [signer, walletAddress, connectorSigner, capabilities.canSign]
  );

  const getAllSkillListings = useCallback(async () => {
    try {
      const accounts = await rpc
        .getProgramAccounts(AGENTVOUCH_PROGRAM_ADDRESS, {
          encoding: "base64",
          filters: [
            {
              memcmp: {
                offset: 0n,
                bytes: asBase64(SKILL_LISTING_DISCRIMINATOR),
                encoding: "base64",
              },
            },
          ],
        })
        .send();
      const decoder = getSkillListingDecoder();
      return accounts.map((account) => ({
        publicKey: account.pubkey,
        account: decoder.decode(decodeBase64(account.account.data[0])),
      }));
    } catch (error) {
      console.error("Error fetching skill listings:", error);
      return [];
    }
  }, []);

  const getSkillListingsByAuthor = useCallback(async (author: Address) => {
    try {
      const accounts = await rpc
        .getProgramAccounts(AGENTVOUCH_PROGRAM_ADDRESS, {
          encoding: "base64",
          filters: [
            {
              memcmp: {
                offset: 0n,
                bytes: asBase64(SKILL_LISTING_DISCRIMINATOR),
                encoding: "base64",
              },
            },
            {
              memcmp: {
                offset: 8n,
                bytes: asBase58(author),
                encoding: "base58",
              },
            },
          ],
        })
        .send();
      const decoder = getSkillListingDecoder();
      return accounts.map((account) => ({
        publicKey: account.pubkey,
        account: decoder.decode(decodeBase64(account.account.data[0])),
      }));
    } catch {
      return [];
    }
  }, []);

  const getSkillListingsByAddresses = useCallback(
    async (skillListings: Address[]) => {
      if (skillListings.length === 0) return [];
      try {
        const accounts = await fetchAllMaybeSkillListing(rpc, skillListings);
        return accounts.flatMap((account, index) =>
          account.exists
            ? [
                {
                  publicKey: skillListings[index],
                  account: account.data,
                },
              ]
            : []
        );
      } catch (error) {
        console.error("Error fetching skill listings by address:", error);
        throw wrapRpcLookupError(
          error,
          "Failed to fetch skill listings by address"
        );
      }
    },
    []
  );

  const getAllPurchases = useCallback(async () => {
    try {
      const accounts = await rpc
        .getProgramAccounts(AGENTVOUCH_PROGRAM_ADDRESS, {
          encoding: "base64",
          filters: [
            {
              memcmp: {
                offset: 0n,
                bytes: asBase64(PURCHASE_DISCRIMINATOR),
                encoding: "base64",
              },
            },
          ],
        })
        .send();
      const decoder = getPurchaseDecoder();
      return accounts.map((account) => ({
        publicKey: account.pubkey,
        account: decoder.decode(decodeBase64(account.account.data[0])),
      }));
    } catch {
      return [];
    }
  }, []);

  const getPurchasesByBuyer = useCallback(async (buyer: Address) => {
    try {
      const accounts = await rpc
        .getProgramAccounts(AGENTVOUCH_PROGRAM_ADDRESS, {
          encoding: "base64",
          filters: [
            {
              memcmp: {
                offset: 0n,
                bytes: asBase64(PURCHASE_DISCRIMINATOR),
                encoding: "base64",
              },
            },
            {
              memcmp: {
                offset: 8n,
                bytes: asBase58(buyer),
                encoding: "base58",
              },
            },
          ],
        })
        .send();
      const decoder = getPurchaseDecoder();
      return accounts.map((account) => ({
        publicKey: account.pubkey,
        account: decoder.decode(decodeBase64(account.account.data[0])),
      }));
    } catch (error) {
      console.error("Error fetching purchases by buyer:", error);
      throw wrapRpcLookupError(error, "Failed to fetch purchases by buyer");
    }
  }, []);

  const getPurchasedSkillListingKeys = useCallback(
    async (buyer: Address, skillListings: Address[]) => {
      if (skillListings.length === 0) return new Set<string>();
      try {
        const listings = await fetchAllMaybeSkillListing(rpc, skillListings);
        const purchaseAddresses = await Promise.all(
          skillListings.map((skillListing, index) =>
            getPurchasePDA(
              buyer,
              skillListing,
              listings[index]?.exists
                ? listings[index].data.currentRevision
                : 0n
            )
          )
        );
        const maybePurchases = await fetchAllMaybePurchase(
          rpc,
          purchaseAddresses
        );

        return new Set(
          skillListings
            .filter((_, index) => maybePurchases[index]?.exists)
            .map((skillListing) => String(skillListing))
        );
      } catch (error) {
        console.error("Error resolving purchased skill flags:", error);
        throw wrapRpcLookupError(
          error,
          "Failed to resolve purchased skill flags"
        );
      }
    },
    []
  );

  const purchaseSkill = useCallback(
    async (skillListingKey: Address, authorKey: Address) => {
      if (!writeSession) throw new Error("Wallet not connected");
      // Marketplace historically resolved USDC from the configured env mint rather than the
      // on-chain protocol config; preserved via resolveUsdcMint.
      return purchaseSolanaSkill(writeSession, {
        skillListingKey,
        authorKey,
        resolveUsdcMint: async () => address(getConfiguredUsdcMint()),
      });
    },
    [writeSession]
  );

  return useMemo(
    () => ({
      connected: !!connected,
      walletAddress,
      getAllSkillListings,
      getSkillListingsByAuthor,
      getSkillListingsByAddresses,
      getAllPurchases,
      getPurchasesByBuyer,
      getPurchasedSkillListingKeys,
      purchaseSkill,
    }),
    [
      connected,
      walletAddress,
      getAllSkillListings,
      getSkillListingsByAuthor,
      getSkillListingsByAddresses,
      getAllPurchases,
      getPurchasesByBuyer,
      getPurchasedSkillListingKeys,
      purchaseSkill,
    ]
  );
}
