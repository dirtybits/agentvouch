import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { verifyPaymentProof, type PaymentProof } from "@/lib/x402";
import { getErrorMessage } from "@/lib/errors";
import { BASE_SEPOLIA_CHAIN_CONTEXT } from "@/lib/chains";
import {
  relayAndRecordBaseX402Purchase,
  verifyBaseX402PaymentPayload,
} from "@/lib/baseX402";
import {
  getBaseX402PayloadFromBody,
  getBaseX402SkillIdFromBody,
  loadBaseX402Skill,
} from "@/lib/baseX402Api";
import {
  claimX402SettlementAttempt,
  completeX402SettlementAttempt,
  failX402SettlementAttempt,
  getX402SettlementEntitlement,
  hasChainUsdcPurchaseEntitlement,
} from "@/lib/usdcPurchases";

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request.clone());
    if (!auth.valid) {
      return NextResponse.json(
        { error: "Authentication required for facilitator endpoints" },
        { status: 401 }
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const baseSkillId = getBaseX402SkillIdFromBody(body);
    const basePayload = getBaseX402PayloadFromBody(body);
    if (baseSkillId || basePayload) {
      if (!baseSkillId || !basePayload) {
        return NextResponse.json(
          { error: "Missing skillDbId or Base payment payload" },
          { status: 400 }
        );
      }
      const skill = await loadBaseX402Skill(baseSkillId);
      if (!skill) {
        return NextResponse.json({ error: "Skill not found" }, { status: 404 });
      }
      const verified = await verifyBaseX402PaymentPayload({
        skillDbId: baseSkillId,
        skill,
        priceUsdcMicros: BigInt(skill.price_usdc_micros),
        payload: basePayload,
      });
      const alreadyEntitled = await hasChainUsdcPurchaseEntitlement(
        baseSkillId,
        {
          buyerChainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
          buyerAddress: verified.buyerAddress,
        }
      ).catch(() => false);
      if (alreadyEntitled) {
        return NextResponse.json({
          settlement_id: verified.paymentRefHashHex,
          status: "complete",
          existing: true,
          payer: verified.buyerAddress,
          chain_context: BASE_SEPOLIA_CHAIN_CONTEXT,
          evm_listing_id: verified.listingId,
        });
      }

      const existingSettlement = await getX402SettlementEntitlement(
        baseSkillId,
        verified.paymentRefHashHex
      ).catch(() => null);
      if (existingSettlement) {
        return NextResponse.json({
          settlement_id: verified.paymentRefHashHex,
          status: "complete",
          existing: true,
          transaction: existingSettlement.transaction,
          payer: existingSettlement.payer,
          chain_context:
            existingSettlement.chainContext ?? BASE_SEPOLIA_CHAIN_CONTEXT,
          evm_listing_id: existingSettlement.evmListingId ?? verified.listingId,
          evm_purchase_id: existingSettlement.evmPurchaseId,
          listing_revision: existingSettlement.listingRevision,
        });
      }

      const claim = await claimX402SettlementAttempt({
        skillDbId: baseSkillId,
        paymentRefHash: verified.paymentRefHashHex,
        buyerChainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
        buyerAddress: verified.buyerAddress,
      });
      if (!claim.claimed) {
        const settled = await getX402SettlementEntitlement(
          baseSkillId,
          verified.paymentRefHashHex
        ).catch(() => null);
        if (settled) {
          return NextResponse.json({
            settlement_id: verified.paymentRefHashHex,
            status: "complete",
            existing: true,
            transaction: settled.transaction,
            payer: settled.payer,
            chain_context: settled.chainContext ?? BASE_SEPOLIA_CHAIN_CONTEXT,
            evm_listing_id: settled.evmListingId ?? verified.listingId,
            evm_purchase_id: settled.evmPurchaseId,
            listing_revision: settled.listingRevision,
          });
        }

        return NextResponse.json(
          {
            settlement_id: verified.paymentRefHashHex,
            status: claim.status === "complete" ? "complete" : "pending",
            existing: true,
            transaction: claim.transaction,
            payer: verified.buyerAddress,
            chain_context: BASE_SEPOLIA_CHAIN_CONTEXT,
            evm_listing_id: verified.listingId,
          },
          { status: claim.status === "complete" ? 200 : 202 }
        );
      }

      let settlement: Awaited<
        ReturnType<typeof relayAndRecordBaseX402Purchase>
      >;
      try {
        settlement = await relayAndRecordBaseX402Purchase({
          skillDbId: baseSkillId,
          skill,
          verified,
        });
        await completeX402SettlementAttempt({
          paymentRefHash: verified.paymentRefHashHex,
          settlementTxSignature: settlement.transaction,
        }).catch((error) => {
          console.warn("Failed to mark Base x402 settlement complete:", error);
        });
      } catch (error) {
        await failX402SettlementAttempt({
          paymentRefHash: verified.paymentRefHashHex,
          error: getErrorMessage(error),
        }).catch((markError) => {
          console.warn(
            "Failed to mark Base x402 settlement failed:",
            markError
          );
        });
        throw error;
      }
      return NextResponse.json({
        settlement_id: settlement.paymentRefHashHex,
        status: "complete",
        transaction: settlement.transaction,
        payer: settlement.payer,
        chain_context: BASE_SEPOLIA_CHAIN_CONTEXT,
        evm_listing_id: settlement.listingId,
        evm_purchase_id: settlement.purchaseId,
        listing_revision: settlement.listingRevision,
      });
    }

    const { proof } = body as { proof: PaymentProof };

    if (!proof?.buyer || !proof?.requirement?.skillListingAddress) {
      return NextResponse.json(
        {
          error: "Missing proof.buyer or proof.requirement.skillListingAddress",
        },
        { status: 400 }
      );
    }

    const result = await verifyPaymentProof(proof);
    return NextResponse.json({
      settlement_id: result.paymentRef,
      status: result.status === "valid" ? "complete" : result.status,
      error: result.error,
    });
  } catch (error: unknown) {
    console.error("POST /api/x402/settle error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "Internal server error") },
      { status: 500 }
    );
  }
}
