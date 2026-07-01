import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase, sql } from "@/lib/db";
import {
  verifyDirectPurchase,
  verifyAndRecordDirectPurchase,
  type DirectPurchaseSkillRow,
} from "@/lib/directPurchaseVerification";
import {
  verifyAndRecordBaseDirectPurchase,
  type BaseDirectPurchaseSkillRow,
} from "@/lib/basePurchaseVerification";
import { fetchOnChainSkillListing } from "@/lib/onchain";
import { getConfiguredUsdcMint } from "@/lib/x402";
import {
  AGENTVOUCH_PROTOCOL_VERSION,
  getAgentVouchChainContext,
  getAgentVouchProgramId,
} from "@/lib/protocolMetadata";

const CHAIN_PREFIX = "chain-";

type VerifyPurchaseBody = {
  signature?: unknown;
  txHash?: unknown;
  buyer?: unknown;
  listing?: unknown;
  listingAddress?: unknown;
  listingId?: unknown;
  chainContext?: unknown;
  expectedPriceUsdcMicros?: unknown;
};

type RepoDirectPurchaseSkillRow = Omit<
  DirectPurchaseSkillRow,
  "author_pubkey"
> & {
  author_pubkey: string | null;
  evm_listing_id: string | null;
  evm_contract_address: string | null;
  evm_tx_hash: string | null;
};

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function logVerificationFailure(input: {
  reason: string;
  skillId: string;
  signature?: string | null;
  buyer?: string | null;
  listing?: string | null;
}) {
  console.warn(
    `[purchase-verify] failed reason=${input.reason} skill=${
      input.skillId
    } listing=${input.listing ?? "unknown"} buyer=${
      input.buyer ?? "unknown"
    } tx=${input.signature ?? "unknown"}`
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await initializeDatabase();

  let body: VerifyPurchaseBody;
  try {
    body = (await request.json()) as VerifyPurchaseBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 }
    );
  }

  const signature = stringOrNull(body.signature);
  const txHash = stringOrNull(body.txHash);
  const buyer = stringOrNull(body.buyer);
  const listing =
    stringOrNull(body.listingAddress) ?? stringOrNull(body.listing);
  const listingId = stringOrNull(body.listingId);
  const chainContext = stringOrNull(body.chainContext);
  const expectedPriceUsdcMicros = stringOrNull(body.expectedPriceUsdcMicros);
  const paymentRef = txHash ?? signature;

  if (!paymentRef) {
    return NextResponse.json(
      { error: "Missing transaction signature" },
      { status: 400 }
    );
  }

  const skill = id.startsWith(CHAIN_PREFIX)
    ? await buildChainOnlySkillRow(id.slice(CHAIN_PREFIX.length))
    : await fetchRepoSkillRow(id);

  if (!skill) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }

  const skillEvmListingId =
    "evm_listing_id" in skill ? skill.evm_listing_id : null;
  const skillEvmContractAddress =
    "evm_contract_address" in skill ? skill.evm_contract_address : null;

  const isBasePurchase =
    chainContext?.startsWith("eip155:") ||
    Boolean(listingId) ||
    Boolean(skillEvmListingId);
  if (isBasePurchase) {
    if (id.startsWith(CHAIN_PREFIX)) {
      return NextResponse.json(
        { error: "Base purchase verification requires a repo skill id" },
        { status: 400 }
      );
    }

    const baseSkill: BaseDirectPurchaseSkillRow = {
      id: skill.id,
      price_usdc_micros: skill.price_usdc_micros,
      currency_mint: skill.currency_mint,
      chain_context: skill.chain_context,
      on_chain_protocol_version: skill.on_chain_protocol_version,
      on_chain_program_id: skill.on_chain_program_id,
      evm_listing_id: skillEvmListingId,
      evm_contract_address: skillEvmContractAddress,
    };

    try {
      const verification = await verifyAndRecordBaseDirectPurchase({
        skill: baseSkill,
        txHash: paymentRef,
        buyerAddress: buyer,
        listingId: listingId ?? listing,
        expectedPriceUsdcMicros,
      });

      return NextResponse.json({
        ok: true,
        entitlement: {
          skill_id: baseSkill.id,
          buyer_pubkey: verification.buyerAddress.toLowerCase(),
          buyer_chain_context: verification.chainContext,
          buyer_address: verification.buyerAddress,
          payment_tx_signature: verification.txHash,
          evm_listing_id: verification.listingId,
          evm_purchase_id: verification.purchaseId,
          amount_micros: verification.amountMicros,
          currency_mint: verification.currencyMint,
          payment_flow: verification.paymentFlow,
          protocol_version: verification.protocolVersion,
          on_chain_program_id: verification.onChainProgramId,
          chain_context: verification.chainContext,
        },
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Purchase verification failed";
      logVerificationFailure({
        reason: message,
        skillId: skill.id,
        signature: paymentRef,
        buyer,
        listing: listingId ?? listing ?? skillEvmListingId,
      });

      const status = /already recorded/i.test(message) ? 409 : 400;
      return NextResponse.json({ error: message }, { status });
    }
  }

  if (!skill.author_pubkey) {
    return NextResponse.json(
      {
        error:
          "This skill does not have a linked author wallet and cannot verify protocol purchases.",
      },
      { status: 409 }
    );
  }

  const walletBackedSkill: DirectPurchaseSkillRow = {
    ...skill,
    author_pubkey: skill.author_pubkey,
  };

  try {
    const verification = id.startsWith(CHAIN_PREFIX)
      ? await verifyDirectPurchase({
          skill: walletBackedSkill,
          signature: paymentRef,
          buyerPubkey: buyer,
          listingAddress: listing,
        })
      : await verifyAndRecordDirectPurchase({
          skill: walletBackedSkill,
          signature: paymentRef,
          buyerPubkey: buyer,
          listingAddress: listing,
        });

    return NextResponse.json({
      ok: true,
      entitlement: {
        skill_id: walletBackedSkill.id,
        buyer_pubkey: verification.buyerPubkey,
        payment_tx_signature: verification.signature,
        purchase_pda: verification.purchasePda,
        on_chain_address: verification.listingAddress,
        amount_micros: verification.amountMicros,
        currency_mint: verification.currencyMint,
        payment_flow: verification.paymentFlow,
        protocol_version: verification.protocolVersion,
        on_chain_program_id: verification.onChainProgramId,
        chain_context: verification.chainContext,
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Purchase verification failed";
    logVerificationFailure({
      reason: message,
      skillId: skill.id,
      signature: paymentRef,
      buyer,
      listing: listing ?? skill.on_chain_address,
    });

    const status = /already recorded/i.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

async function fetchRepoSkillRow(
  id: string
): Promise<RepoDirectPurchaseSkillRow | null> {
  const rows = await sql()<RepoDirectPurchaseSkillRow>`
    SELECT
      id,
      on_chain_address,
      author_pubkey,
      price_usdc_micros::text,
      currency_mint,
      chain_context,
      on_chain_protocol_version,
      on_chain_program_id,
      evm_listing_id,
      evm_contract_address,
      evm_tx_hash
    FROM skills
    WHERE id = ${id}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function buildChainOnlySkillRow(
  listingAddress: string
): Promise<DirectPurchaseSkillRow | null> {
  const listing = await fetchOnChainSkillListing(listingAddress);
  if (!listing) return null;

  return {
    id: `${CHAIN_PREFIX}${listing.publicKey}`,
    on_chain_address: listing.publicKey,
    author_pubkey: String(listing.data.author),
    price_usdc_micros: String(listing.data.priceUsdcMicros),
    currency_mint: getConfiguredUsdcMint(),
    chain_context: getAgentVouchChainContext(),
    on_chain_protocol_version: AGENTVOUCH_PROTOCOL_VERSION,
    on_chain_program_id: getAgentVouchProgramId(),
  };
}
