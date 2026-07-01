// Tier 1 Stripe webhook — PROTOTYPE. See docs/STRIPE_FEASIBILITY.md.
// On a verified `checkout.session.completed` event, mints an OFF-CHAIN
// entitlement. Does NOT settle on-chain or fund author/voucher economics.
import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase, sql } from "@/lib/db";
import { recordUsdcPurchaseReceipt } from "@/lib/usdcPurchases";
import {
  STRIPE_CURRENCY_SENTINEL,
  STRIPE_PAYMENT_FLOW,
  STRIPE_RECIPIENT_SENTINEL,
  isStripeEnabled,
  usdcMicrosToUsdCents,
  verifyAndParseWebhook,
} from "@/lib/stripe";
import { getErrorMessage } from "@/lib/errors";

type SessionObject = {
  id: string;
  client_reference_id?: string | null;
  customer?: string | null;
  customer_email?: string | null;
  payment_intent?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  mode?: string | null;
  payment_status?: string | null;
  metadata?: Record<string, string> | null;
};

function metadataString(
  metadata: Record<string, string> | null | undefined,
  key: string
) {
  const value = metadata?.[key]?.trim();
  return value || null;
}

export async function POST(req: NextRequest) {
  if (!isStripeEnabled()) {
    return NextResponse.json(
      {
        error:
          "Stripe payments are not enabled. Configure STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET before accepting checkout payments.",
      },
      { status: 501 }
    );
  }

  // Raw body is required for signature verification — do not parse first.
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  let event;
  try {
    event = verifyAndParseWebhook(rawBody, signature);
  } catch (error) {
    return NextResponse.json(
      { error: `Webhook verification failed: ${getErrorMessage(error)}` },
      { status: 400 }
    );
  }

  // Only successful payment-mode checkouts grant entitlement; ack everything else.
  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded"
  ) {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  const session = event.data.object as SessionObject;
  const skillDbId =
    metadataString(session.metadata, "skill_db_id") ||
    session.client_reference_id?.trim();
  const buyerPubkey = metadataString(session.metadata, "buyer_pubkey");
  const checkoutPriceMicros = metadataString(
    session.metadata,
    "price_usdc_micros"
  );
  const paymentFlow = metadataString(session.metadata, "payment_flow");

  if (!skillDbId) {
    return NextResponse.json(
      { error: "Webhook missing skill_db_id" },
      { status: 400 }
    );
  }
  if (!buyerPubkey) {
    return NextResponse.json(
      { error: "Webhook missing buyer_pubkey" },
      { status: 400 }
    );
  }
  if (!checkoutPriceMicros) {
    return NextResponse.json(
      { error: "Webhook missing price_usdc_micros" },
      { status: 400 }
    );
  }
  if (paymentFlow !== STRIPE_PAYMENT_FLOW) {
    return NextResponse.json(
      { error: "Webhook payment_flow is not an AgentVouch Stripe payment" },
      { status: 400 }
    );
  }
  if (session.mode !== "payment") {
    return NextResponse.json(
      { error: "Stripe session is not a one-time payment" },
      { status: 400 }
    );
  }
  if (session.payment_status !== "paid") {
    return NextResponse.json(
      { error: "Stripe session is not paid" },
      { status: 400 }
    );
  }
  if ((session.currency ?? "").toLowerCase() !== "usd") {
    return NextResponse.json(
      { error: "Stripe session currency is not USD" },
      { status: 400 }
    );
  }

  try {
    await initializeDatabase();

    // Re-read only to ensure the skill still exists. Fulfillment uses the
    // checkout-time amount stored in Stripe metadata, so author price changes
    // between checkout and webhook do not strand paid buyers.
    const rows = await sql()<{ id: string }>`
      SELECT id
      FROM skills
      WHERE id = ${skillDbId}::uuid
      LIMIT 1
    `;
    const skill = rows[0];
    if (!skill) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    let micros: bigint;
    try {
      micros = BigInt(checkoutPriceMicros);
    } catch {
      return NextResponse.json(
        { error: "Webhook price_usdc_micros is invalid" },
        { status: 400 }
      );
    }
    if (micros <= 0n) {
      return NextResponse.json(
        { error: "Webhook price_usdc_micros must be positive" },
        { status: 400 }
      );
    }

    if (
      typeof session.amount_total !== "number" ||
      session.amount_total !== usdcMicrosToUsdCents(micros)
    ) {
      return NextResponse.json(
        { error: "Charged amount does not match listing price" },
        { status: 409 }
      );
    }

    // Stripe payment reference + wallet buyer identity from checkout metadata.
    // `payment_tx_signature` is UNIQUE, giving us idempotency on retries.
    const paymentRef = `stripe:${session.payment_intent || session.id}`.slice(
      0,
      128
    );

    await recordUsdcPurchaseReceipt({
      skillDbId,
      buyerPubkey,
      paymentTxSignature: paymentRef,
      recipientAta: STRIPE_RECIPIENT_SENTINEL,
      currencyMint: STRIPE_CURRENCY_SENTINEL,
      amountMicros: micros.toString(),
      paymentFlow: STRIPE_PAYMENT_FLOW,
    });

    return NextResponse.json({ received: true, entitled: buyerPubkey });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
