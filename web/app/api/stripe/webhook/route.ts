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
  syntheticBuyerRef,
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
  metadata?: Record<string, string> | null;
};

export async function POST(req: NextRequest) {
  if (!isStripeEnabled()) {
    return NextResponse.json(
      { error: "Stripe payments are not enabled" },
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

  // Only completed checkouts grant entitlement; ack everything else.
  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  const session = event.data.object as SessionObject;
  const skillDbId =
    session.metadata?.skill_db_id?.trim() ||
    session.client_reference_id?.trim();

  if (!skillDbId) {
    return NextResponse.json(
      { error: "Webhook missing skill_db_id" },
      { status: 400 }
    );
  }

  try {
    await initializeDatabase();

    // Re-read the authoritative price from our DB rather than trusting the
    // webhook amount, then sanity-check it matches what Stripe charged.
    const rows = await sql()<{ price_usdc_micros: string | null }>`
      SELECT price_usdc_micros::text AS price_usdc_micros
      FROM skills
      WHERE id = ${skillDbId}::uuid
      LIMIT 1
    `;
    const priceRow = rows[0];
    if (!priceRow) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }
    const micros = priceRow.price_usdc_micros
      ? BigInt(priceRow.price_usdc_micros)
      : 0n;

    if (
      typeof session.amount_total === "number" &&
      session.amount_total !== usdcMicrosToUsdCents(micros)
    ) {
      return NextResponse.json(
        { error: "Charged amount does not match listing price" },
        { status: 409 }
      );
    }

    // Synthetic buyer identity + synthetic tx signature (Obstacles 1 & 2).
    // `payment_tx_signature` is UNIQUE, giving us idempotency on retries.
    const buyerRef = syntheticBuyerRef(session.customer || session.id);
    const paymentRef = `stripe:${session.payment_intent || session.id}`.slice(
      0,
      128
    );

    await recordUsdcPurchaseReceipt({
      skillDbId,
      buyerPubkey: buyerRef,
      paymentTxSignature: paymentRef,
      recipientAta: STRIPE_RECIPIENT_SENTINEL,
      currencyMint: STRIPE_CURRENCY_SENTINEL,
      amountMicros: micros.toString(),
      paymentFlow: STRIPE_PAYMENT_FLOW,
    });

    return NextResponse.json({ received: true, entitled: buyerRef });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
