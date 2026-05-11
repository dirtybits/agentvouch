"use client";

import { useCallback, useMemo } from "react";
import { useWalletConnection, useSendTransaction } from "@solana/react-hooks";
import {
  address,
  createSolanaRpc,
  getAddressEncoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
  isAddress,
  signature,
  type AccountMeta,
  type Address,
  type Instruction,
  type ReadonlyUint8Array,
  type TransactionSigner,
} from "@solana/kit";
import {
  createWalletTransactionSigner,
  type TransactionPrepareAndSendRequest,
} from "@solana/client";
import type { Base58EncodedBytes, Base64EncodedBytes } from "@solana/rpc-types";
import { decodeBase64, encodeBase64 } from "@/lib/base64";
import {
  assessPurchasePreflight,
  createPurchasePreflightContext,
  type PurchasePreflightAssessment,
} from "@/lib/purchasePreflight";
import {
  getConfiguredSolanaChainDisplayLabel,
  getConfiguredSolanaRpcTargetLabel,
} from "@/lib/chains";
import { getErrorMessage } from "@/lib/errors";
import { wrapRpcLookupError } from "@/lib/rpcErrors";
import { getConfiguredUsdcMint } from "@/lib/x402";
import {
  assertUsdcAccountReady,
  formatUsdcMicrosValue,
  getAssociatedTokenAccount,
  logTransactionSummary,
  type AgentVouchTransactionSummary,
} from "@/lib/agentvouchUsdc";
import {
  fetchAllMaybePurchase,
  fetchMaybePurchase,
  getPurchaseDecoder,
  PURCHASE_DISCRIMINATOR,
} from "../generated/agentvouch/src/generated/accounts/purchase";
import { fetchMaybeAgentProfile } from "../generated/agentvouch/src/generated";
import {
  fetchAllMaybeSkillListing,
  fetchMaybeSkillListing,
  getSkillListingDecoder,
  SKILL_LISTING_DISCRIMINATOR,
} from "../generated/agentvouch/src/generated/accounts/skillListing";
import { getPurchaseSkillInstructionAsync } from "../generated/agentvouch/src/generated/instructions/purchaseSkill";

const AGENTVOUCH_PROGRAM_ADDRESS = address(
  "AgNtCcWfeMYUzHxvGdZP5BJszQhx6NJGB4pQ7AN6XVWz"
);
const ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const rpc = createSolanaRpc(ENDPOINT);
const SIGNATURE_CONFIRMATION_TIMEOUT_MS = 45_000;
const SIGNATURE_CONFIRMATION_POLL_MS = 1_000;

const textEncoder = getUtf8Encoder();
const addressEncoder = getAddressEncoder();

const asBase64 = (bytes: Uint8Array) =>
  encodeBase64(bytes) as Base64EncodedBytes;
const asBase58 = (value: string) => value as unknown as Base58EncodedBytes;

type SendInstructionAccount = {
  address: Address;
  role: number;
  signer?: TransactionSigner;
};

type SendInstruction = Instruction<string, readonly AccountMeta[]> & {
  data?: ReadonlyUint8Array;
  accounts: readonly SendInstructionAccount[];
};

function normalizeInstructionForSend(ix: SendInstruction): SendInstruction {
  return {
    programAddress: ix.programAddress,
    data: ix.data,
    accounts: ix.accounts.map((acc) => ({
      address: acc.address,
      role: acc.role,
      ...("signer" in acc && acc.signer ? { signer: acc.signer } : {}),
    })),
  } as SendInstruction;
}

function buildTransactionSendRequest(
  ix: SendInstruction | readonly SendInstruction[],
  authority: TransactionSigner
): TransactionPrepareAndSendRequest {
  const instructions = Array.isArray(ix) ? ix : [ix];
  return {
    instructions: instructions.map(normalizeInstructionForSend),
    authority,
  };
}

function u64Seed(value: bigint | number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return bytes;
}

async function deriveAddress(
  seeds: (string | Address | Uint8Array)[],
  programId: Address = AGENTVOUCH_PROGRAM_ADDRESS
): Promise<Address> {
  const encodedSeeds = seeds.map((seed) =>
    seed instanceof Uint8Array
      ? seed
      : isAddress(seed)
      ? addressEncoder.encode(seed)
      : textEncoder.encode(seed)
  );
  const [derived] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: encodedSeeds,
  });
  return derived;
}

async function getAgentPDA(agentKey: Address): Promise<Address> {
  return deriveAddress(["agent", agentKey]);
}

async function getAuthorRewardVaultAuthorityPDA(
  authorProfile: Address
): Promise<Address> {
  return deriveAddress(["author_reward_vault_authority", authorProfile]);
}

async function getAuthorRewardVaultPDA(
  authorProfile: Address
): Promise<Address> {
  return deriveAddress(["author_reward_vault", authorProfile]);
}

async function getPurchasePDA(
  buyer: Address,
  skillListing: Address,
  revision: bigint | number = 0n
): Promise<Address> {
  return deriveAddress(["purchase", buyer, skillListing, u64Seed(revision)]);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shortAddress(value: string) {
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function estimatePurchasePreflight(
  buyer: Address,
  skillListing: Address,
  author: Address
): Promise<PurchasePreflightAssessment> {
  const listing = await fetchMaybeSkillListing(rpc, skillListing);
  if (!listing.exists) throw new Error("Skill listing not found on-chain");
  const usdcMint = address(getConfiguredUsdcMint());
  const authorProfile = await getAgentPDA(author);
  const maybeAuthorProfile = await fetchMaybeAgentProfile(
    rpc,
    authorProfile
  ).catch(() => null);
  const context = await createPurchasePreflightContext({
    rpc,
    buyer,
    usdcMint,
    authors: [author],
  });
  return assessPurchasePreflight({
    context,
    priceUsdcMicros: BigInt(listing.data.priceUsdcMicros),
    author,
    authorBackingUsdcMicros: maybeAuthorProfile?.exists
      ? BigInt(maybeAuthorProfile.data.totalVouchStakeUsdcMicros)
      : 0n,
  });
}

function buildPurchaseBalanceError(
  walletAddress: Address,
  estimate: PurchasePreflightAssessment
) {
  const configuredNetwork = `${getConfiguredSolanaChainDisplayLabel()} (${getConfiguredSolanaRpcTargetLabel()} RPC)`;
  return `Connected wallet ${shortAddress(
    walletAddress
  )} has ${formatUsdcMicrosValue(
    estimate.buyerUsdcBalanceMicros ?? 0n
  )} USDC on the configured ${configuredNetwork}. Buying this skill needs ${formatUsdcMicrosValue(
    estimate.creatorPriceUsdcMicros
  )} USDC plus SOL for receipt rent and network fees.`;
}

function buildPurchaseClusterMismatchError(
  walletAddress: Address,
  estimate: PurchasePreflightAssessment
) {
  const configuredNetwork = `${getConfiguredSolanaChainDisplayLabel()} (${getConfiguredSolanaRpcTargetLabel()} RPC)`;
  return `Phantom reported insufficient SOL, but connected wallet ${shortAddress(
    walletAddress
  )} appears connected to the configured ${configuredNetwork}. If Phantom shows a different balance, switch Phantom and the app to the same network and retry.`;
}

async function waitForConfirmedSignature(
  txSignature: ReturnType<typeof signature>
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < SIGNATURE_CONFIRMATION_TIMEOUT_MS) {
    const response = await rpc
      .getSignatureStatuses([txSignature], { searchTransactionHistory: true })
      .send();
    const status = response.value[0];

    if (status?.err) {
      throw new Error(
        `Transaction ${txSignature} failed on-chain: ${JSON.stringify(
          status.err
        )}`
      );
    }

    if (
      status &&
      (status.confirmationStatus === "confirmed" ||
        status.confirmationStatus === "finalized")
    ) {
      return;
    }

    await sleep(SIGNATURE_CONFIRMATION_POLL_MS);
  }

  throw new Error(
    `Transaction ${txSignature} was sent but not confirmed within ${
      SIGNATURE_CONFIRMATION_TIMEOUT_MS / 1000
    } seconds.`
  );
}

export function useMarketplaceOracle() {
  const { wallet, status } = useWalletConnection();
  const connected = status === "connected" && wallet;
  const { send: frameworkSend } = useSendTransaction();

  const walletAddress: Address | null = connected
    ? (wallet.account.address as Address)
    : null;

  const signer: TransactionSigner | null = useMemo(() => {
    if (!connected || !wallet) return null;
    return createWalletTransactionSigner(wallet).signer;
  }, [connected, wallet]);

  const sendIx = useCallback(
    async (
      ix: SendInstruction | readonly SendInstruction[],
      summary?: AgentVouchTransactionSummary
    ) => {
      if (!walletAddress || !signer) throw new Error("Wallet not connected");
      const request = buildTransactionSendRequest(ix, signer);
      try {
        if (summary) logTransactionSummary(summary);
        const sig = await frameworkSend(request);
        const txSignature = signature(String(sig));
        await waitForConfirmedSignature(txSignature);
        return txSignature;
      } catch (error: unknown) {
        const cause =
          error && typeof error === "object" && "cause" in error
            ? (error as { cause?: unknown }).cause ?? error
            : error;
        const logs =
          cause &&
          typeof cause === "object" &&
          "logs" in cause &&
          Array.isArray((cause as { logs?: unknown }).logs)
            ? (cause as { logs: unknown[] }).logs
            : cause &&
              typeof cause === "object" &&
              "context" in cause &&
              (cause as { context?: unknown }).context &&
              typeof (cause as { context?: unknown }).context === "object" &&
              "logs" in
                ((cause as { context: { logs?: unknown } }).context ?? {})
            ? (cause as { context: { logs?: unknown[] } }).context.logs ?? null
            : null;
        if (logs?.length) console.error("Simulation logs:", logs);
        if (cause) {
          console.error("Transaction failed (cause):", cause);
          throw cause;
        }
        throw new Error(getErrorMessage(error));
      }
    },
    [walletAddress, signer, frameworkSend]
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
      if (!signer || !walletAddress) throw new Error("Wallet not connected");
      const listing = await fetchMaybeSkillListing(rpc, skillListingKey);
      if (!listing.exists) throw new Error("Skill listing not found");
      const purchasePda = await getPurchasePDA(
        walletAddress,
        skillListingKey,
        listing.data.currentRevision
      );
      const existingPurchase = await fetchMaybePurchase(rpc, purchasePda).catch(
        () => null
      );
      if (existingPurchase?.exists) {
        return {
          tx: null,
          alreadyPurchased: true,
          purchase: purchasePda,
        };
      }
      let purchaseEstimate: PurchasePreflightAssessment | null = null;
      try {
        purchaseEstimate = await estimatePurchasePreflight(
          walletAddress,
          skillListingKey,
          authorKey
        );
        if (
          purchaseEstimate.purchasePreflightStatus ===
          "buyerInsufficientBalance"
        ) {
          throw new Error(
            buildPurchaseBalanceError(walletAddress, purchaseEstimate)
          );
        }
        if (
          purchaseEstimate.purchasePreflightStatus ===
            "authorPayoutRentBlocked" ||
          purchaseEstimate.purchasePreflightStatus === "authorMissingBacking"
        ) {
          throw new Error(
            purchaseEstimate.purchasePreflightMessage ??
              "This listing is temporarily not purchasable."
          );
        }
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes("Buying this skill needs about") ||
            error.message.includes("cannot currently be purchased"))
        ) {
          throw error;
        }
        console.warn("Purchase preflight skipped:", error);
      }

      const authorProfile = await getAgentPDA(authorKey);
      const usdcMint = address(getConfiguredUsdcMint());
      const [buyerUsdcAccount, authorRewardVaultAuthority, authorRewardVault] =
        await Promise.all([
          getAssociatedTokenAccount(walletAddress, usdcMint),
          getAuthorRewardVaultAuthorityPDA(authorProfile),
          getAuthorRewardVaultPDA(authorProfile),
        ]);
      await assertUsdcAccountReady({
        rpc,
        owner: walletAddress,
        mint: usdcMint,
        purpose: "Skill purchase",
        minimumBalanceUsdcMicros: BigInt(listing.data.priceUsdcMicros),
      });
      const ix = await getPurchaseSkillInstructionAsync({
        skillListing: skillListingKey,
        purchase: purchasePda,
        author: authorKey,
        authorProfile,
        usdcMint,
        buyerUsdcAccount,
        listingSettlement: listing.data.currentSettlement,
        authorProceedsVault: listing.data.currentAuthorProceedsVault,
        authorRewardVaultAuthority,
        authorRewardVault,
        buyer: signer,
      });
      const summary = {
        action: "Purchase skill",
        token: "USDC" as const,
        amountUsdcMicros: BigInt(listing.data.priceUsdcMicros),
        recipient: listing.data.currentAuthorProceedsVault,
        vault: authorRewardVault,
        feePayer: signer.address,
        cluster: `${getConfiguredSolanaChainDisplayLabel()} (${getConfiguredSolanaRpcTargetLabel()} RPC)`,
      };
      try {
        return { tx: await sendIx(ix, summary), summary };
      } catch (error: unknown) {
        const existingPurchaseAfterFailure = await fetchMaybePurchase(
          rpc,
          purchasePda
        ).catch(() => null);
        if (existingPurchaseAfterFailure?.exists) {
          return {
            tx: null,
            alreadyPurchased: true,
            purchase: purchasePda,
          };
        }
        const message = getErrorMessage(error, "");
        if (/insufficient|not enough sol/i.test(message)) {
          const latestEstimate =
            purchaseEstimate ??
            (await estimatePurchasePreflight(
              walletAddress,
              skillListingKey,
              authorKey
            ).catch(() => null));
          if (latestEstimate) {
            if (
              latestEstimate.purchasePreflightStatus ===
              "buyerInsufficientBalance"
            ) {
              throw new Error(
                buildPurchaseBalanceError(walletAddress, latestEstimate)
              );
            }
            if (
              latestEstimate.purchasePreflightStatus ===
                "authorPayoutRentBlocked" ||
              latestEstimate.purchasePreflightStatus === "authorMissingBacking"
            ) {
              throw new Error(
                latestEstimate.purchasePreflightMessage ??
                  "This listing is temporarily not purchasable."
              );
            }
            throw new Error(
              buildPurchaseClusterMismatchError(walletAddress, latestEstimate)
            );
          }
        }
        throw error;
      }
    },
    [signer, walletAddress, sendIx]
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
