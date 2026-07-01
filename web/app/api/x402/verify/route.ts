import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { verifyPaymentProof, type PaymentProof } from "@/lib/x402";
import { getErrorMessage } from "@/lib/errors";
import { BASE_SEPOLIA_CHAIN_CONTEXT } from "@/lib/chains";
import { verifyBaseX402PaymentPayload } from "@/lib/baseX402";
import {
  getBaseX402PayloadFromBody,
  getBaseX402SkillIdFromBody,
  loadBaseX402Skill,
} from "@/lib/baseX402Api";
import { hasChainUsdcPurchaseEntitlement } from "@/lib/usdcPurchases";

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
      return NextResponse.json({
        verification_status: "valid",
        payment_ref: verified.paymentRefHashHex,
        payer: verified.buyerAddress,
        chain_context: BASE_SEPOLIA_CHAIN_CONTEXT,
        evm_listing_id: verified.listingId,
        amount_micros: verified.priceUsdcMicros.toString(),
        settlement_required: !alreadyEntitled,
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
      verification_status: result.status,
      payment_ref: result.paymentRef,
      error: result.error,
    });
  } catch (error: unknown) {
    console.error("POST /api/x402/verify error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "Internal server error") },
      { status: 500 }
    );
  }
}
