// Tier 1 Stripe webhook — PROTOTYPE. See docs/STRIPE_FEASIBILITY.md.
// On a verified `checkout.session.completed` event, mints an OFF-CHAIN
// entitlement. Does NOT settle on-chain or fund author/voucher economics.
//
// Response policy: Stripe retries every non-2xx delivery with backoff for up
// to ~3 days and can flag the endpoint as failing, delaying other buyers'
// events. So permanently-unprocessable events (bad metadata, amount mismatch,
// deleted skill) are ACKed with 200 plus a logged reason for the operator
// reconciliation queue; non-2xx is reserved for signature failures (400) and
// transient errors like DB outages (500), which retries can actually fix.
import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase, sql } from "@/lib/db";
import {
  hasUsdcPurchaseEntitlement,
  recordUsdcPurchaseReceipt,
} from "@/lib/usdcPurchases";
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

// Terminal ack for events this endpoint will never be able to fulfill.
// Logged so paid-but-not-entitled cases stay visible to reconciliation.
function ackUnprocessable(sessionId: string | undefined, reason: string) {
  console.error(
    `Stripe webhook unprocessable (session ${
      sessionId ?? "unknown"
    }): ${reason}`
  );
  return NextResponse.json({ received: true, ignored: reason });
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

  if (paymentFlow !== STRIPE_PAYMENT_FLOW) {
    // Not a session this app created (e.g. dashboard-created session on a
    // shared Stripe account). Never fulfillable here.
    return ackUnprocessable(
      session.id,
      "payment_flow is not an AgentVouch Stripe payment"
    );
  }
  if (!skillDbId || !buyerPubkey || !checkoutPriceMicros) {
    return ackUnprocessable(
      session.id,
      "missing skill_db_id, buyer_pubkey, or price_usdc_micros metadata"
    );
  }
  if (session.mode !== "payment") {
    return ackUnprocessable(session.id, "session is not a one-time payment");
  }
  if (session.payment_status !== "paid") {
    // Normal ordering for delayed payment methods: `completed` arrives with
    // payment_status "unpaid", then `async_payment_succeeded` follows. Ack and
    // wait for the paid event.
    return NextResponse.json({
      received: true,
      ignored: "session not paid yet",
    });
  }
  if ((session.currency ?? "").toLowerCase() !== "usd") {
    return ackUnprocessable(session.id, "session currency is not USD");
  }

  let micros: bigint;
  try {
    micros = BigInt(checkoutPriceMicros);
  } catch {
    return ackUnprocessable(session.id, "price_usdc_micros is invalid");
  }
  if (micros <= 0n) {
    return ackUnprocessable(session.id, "price_usdc_micros must be positive");
  }
  if (
    typeof session.amount_total !== "number" ||
    session.amount_total !== usdcMicrosToUsdCents(micros)
  ) {
    return ackUnprocessable(
      session.id,
      "charged amount does not match checkout metadata price"
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
    if (!rows[0]) {
      return ackUnprocessable(session.id, "skill no longer exists");
    }

    // The entitlement upsert is last-receipt-wins: letting a Stripe receipt
    // through for a buyer who already holds an entitlement (e.g. a real
    // on-chain purchase, or a duplicate delivery) would null out its
    // purchase_pda / chain-context provenance. Ack without writing instead.
    if (await hasUsdcPurchaseEntitlement(skillDbId, buyerPubkey)) {
      return NextResponse.json({
        received: true,
        entitled: buyerPubkey,
        alreadyEntitled: true,
      });
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
