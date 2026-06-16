import { NextRequest, NextResponse } from "next/server";
import { address, createSolanaRpc, isAddress } from "@solana/kit";
import type { Base64EncodedBytes, Base58EncodedBytes } from "@solana/rpc-types";
import {
  fetchAllMaybeSkillListing,
  getPurchaseDecoder,
  PURCHASE_DISCRIMINATOR,
  type Purchase,
  type SkillListing,
} from "@/generated/agentvouch/src/generated";
import { AGENTVOUCH_PROGRAM_ADDRESS } from "@/generated/agentvouch/src/generated/programs";
import { PRIVATE_NO_STORE_CACHE_CONTROL } from "@/lib/cachePolicy";
import { decodeBase64 } from "@/lib/base64";
import { getErrorMessage } from "@/lib/errors";
import { DEFAULT_SOLANA_RPC_URL } from "@/lib/solanaRpc";

const rpc = createSolanaRpc(DEFAULT_SOLANA_RPC_URL);
const asBase64 = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("base64") as Base64EncodedBytes;
const asBase58 = (value: string) => value as unknown as Base58EncodedBytes;

function serializePurchaseAccount(account: Purchase) {
  return {
    buyer: String(account.buyer),
    skillListing: String(account.skillListing),
    purchasedAt: account.purchasedAt.toString(),
    listingRevision: account.listingRevision.toString(),
    listingSettlement: String(account.listingSettlement),
    pricePaidUsdcMicros: account.pricePaidUsdcMicros.toString(),
    authorShareUsdcMicros: account.authorShareUsdcMicros.toString(),
    voucherPoolUsdcMicros: account.voucherPoolUsdcMicros.toString(),
    usdcMint: String(account.usdcMint),
    bump: account.bump,
  };
}

function serializeSkillListingAccount(account: SkillListing) {
  return {
    author: String(account.author),
    skillUri: account.skillUri,
    name: account.name,
    description: account.description,
    priceUsdcMicros: account.priceUsdcMicros.toString(),
    rewardVault: String(account.rewardVault),
    rewardVaultRentPayer: String(account.rewardVaultRentPayer),
    currentRevision: account.currentRevision.toString(),
    currentSettlement: String(account.currentSettlement),
    currentAuthorProceedsVault: String(account.currentAuthorProceedsVault),
    totalDownloads: account.totalDownloads.toString(),
    totalRevenueUsdcMicros: account.totalRevenueUsdcMicros.toString(),
    totalAuthorRevenueUsdcMicros:
      account.totalAuthorRevenueUsdcMicros.toString(),
    totalVoucherRevenueUsdcMicros:
      account.totalVoucherRevenueUsdcMicros.toString(),
    activeRewardStakeUsdcMicros: account.activeRewardStakeUsdcMicros.toString(),
    activeRewardPositionCount: account.activeRewardPositionCount,
    rewardIndexUsdcMicrosX1e12: account.rewardIndexUsdcMicrosX1e12.toString(),
    unclaimedVoucherRevenueUsdcMicros:
      account.unclaimedVoucherRevenueUsdcMicros.toString(),
    createdAt: account.createdAt.toString(),
    updatedAt: account.updatedAt.toString(),
    status: account.status,
    bump: account.bump,
    rewardVaultBump: account.rewardVaultBump,
  };
}

export async function GET(request: NextRequest) {
  try {
    const buyer = request.nextUrl.searchParams.get("buyer");
    if (!buyer || !isAddress(buyer)) {
      return NextResponse.json(
        { error: "buyer must be a valid Solana address" },
        { status: 400 }
      );
    }

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
    const purchases = accounts.map((account) => {
      const data = decodeBase64(account.account.data[0]);
      return {
        publicKey: String(account.pubkey),
        account: decoder.decode(data),
      };
    });
    const listingAddresses = [
      ...new Set(
        purchases.map((purchase) => String(purchase.account.skillListing))
      ),
    ].filter(isAddress);
    const listingAccounts =
      listingAddresses.length > 0
        ? await fetchAllMaybeSkillListing(
            rpc,
            listingAddresses.map((listingAddress) => address(listingAddress))
          )
        : [];
    const listings = listingAccounts.flatMap((account, index) =>
      account.exists
        ? [
            {
              publicKey: listingAddresses[index],
              account: serializeSkillListingAccount(account.data),
            },
          ]
        : []
    );

    return NextResponse.json(
      {
        purchases: purchases.map((purchase) => ({
          publicKey: purchase.publicKey,
          account: serializePurchaseAccount(purchase.account),
        })),
        listings,
      },
      {
        headers: {
          "Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL,
        },
      }
    );
  } catch (error: unknown) {
    console.error("GET /api/dashboard/purchases error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
