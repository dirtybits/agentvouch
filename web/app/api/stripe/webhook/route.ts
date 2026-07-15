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
  getUsdcPurchaseEntitlementStatus,
  hasUsdcPurchaseReceiptForPaymentRef,
  recordAndApplyUsdcPaymentRevocation,
  recordRevocableUsdcPurchaseReceipt,
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
import {
  recordStripeWebhookOutcome,
  type RecordStripeWebhookOutcomeInput,
} from "@/lib/stripeReconciliation";

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

// `charge.refunded` carries a Charge; `charge.dispute.created` carries a
// Dispute. Both reference the payment intent our receipts are keyed on.
type RefundOrDisputeObject = {
  id: string;
  payment_intent?: string | null;
  refunded?: boolean | null;
  amount_refunded?: number | null;
};

function stripePaymentRef(paymentIntent: string | null | undefined) {
  return paymentIntent ? `stripe:${paymentIntent}`.slice(0, 128) : null;
}

function metadataString(
  metadata: Record<string, string> | null | undefined,
  key: string
) {
  const value = metadata?.[key]?.trim();
  return value || null;
}

async function recordOutcomeOrRetry(
  input: RecordStripeWebhookOutcomeInput,
  response: NextResponse
): Promise<NextResponse> {
  try {
    await recordStripeWebhookOutcome(input);
    return response;
  } catch (error) {
    // A durable audit/review record is part of processing. Returning 500 keeps
    // Stripe retries active instead of silently losing an operator action.
    return NextResponse.json(
      {
        error: `Failed to persist Stripe webhook outcome: ${getErrorMessage(
          error
        )}`,
      },
      { status: 500 }
    );
  }
}

// Terminal ack for events this endpoint will never be able to fulfill.
// Persisted before ACK so paid-but-not-entitled cases survive log retention.
async function ackUnprocessable(input: {
  eventId: string;
  eventType: string;
  objectId?: string | null;
  paymentRef?: string | null;
  skillDbId?: string | null;
  buyerKey?: string | null;
  reason: string;
  needsReview?: boolean;
}) {
  console.error(
    `Stripe webhook unprocessable (object ${input.objectId ?? "unknown"}): ${
      input.reason
    }`
  );
  return recordOutcomeOrRetry(
    {
      eventId: input.eventId,
      eventType: input.eventType,
      objectId: input.objectId,
      paymentRef: input.paymentRef,
      skillDbId: input.skillDbId,
      buyerKey: input.buyerKey,
      outcome: input.needsReview === false ? "ignored" : "needs-review",
      reason: input.reason,
      needsReview: input.needsReview !== false,
    },
    NextResponse.json({ received: true, ignored: input.reason })
  );
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

  // Refunds and chargebacks revoke the wallet-bound entitlement the payment
  // minted. Partial refunds are logged but do not revoke.
  if (
    event.type === "charge.refunded" ||
    event.type === "charge.dispute.created"
  ) {
    const object = event.data.object as RefundOrDisputeObject;
    const paymentRef = stripePaymentRef(object.payment_intent);
    if (!paymentRef) {
      return await ackUnprocessable({
        eventId: event.id,
        eventType: event.type,
        objectId: object.id,
        reason: `${event.type} without payment_intent`,
      });
    }
    if (event.type === "charge.refunded" && object.refunded !== true) {
      console.warn(
        `Stripe partial refund on ${paymentRef} (amount_refunded=${
          object.amount_refunded ?? "?"
        }); entitlement kept — reconcile manually.`
      );
      return await recordOutcomeOrRetry(
        {
          eventId: event.id,
          eventType: event.type,
          objectId: object.id,
          paymentRef,
          outcome: "needs-review",
          reason: "partial refund",
          needsReview: true,
          details: { amountRefunded: object.amount_refunded ?? null },
        },
        NextResponse.json({ received: true, ignored: "partial refund" })
      );
    }

    try {
      await initializeDatabase();
      const reason =
        event.type === "charge.refunded" ? "stripe-refund" : "stripe-dispute";
      const revoked = await recordAndApplyUsdcPaymentRevocation(
        paymentRef,
        reason
      );
      for (const row of revoked) {
        console.warn(
          `Stripe ${reason}: revoked entitlement skill=${row.skill_db_id} buyer=${row.buyer_pubkey} ref=${paymentRef}`
        );
      }
      if (revoked.length === 0) {
        console.warn(
          `Stripe ${reason} on ${paymentRef}: no live entitlement matched (already revoked, superseded by a newer purchase, or never minted) — reconcile manually.`
        );
      }
      return await recordOutcomeOrRetry(
        {
          eventId: event.id,
          eventType: event.type,
          objectId: object.id,
          paymentRef,
          outcome: revoked.length > 0 ? "revoked" : "needs-review",
          reason:
            revoked.length > 0
              ? reason
              : `${reason}: no live entitlement matched`,
          needsReview: revoked.length === 0,
          details: { revokedEntitlements: revoked.length },
        },
        NextResponse.json({ received: true, revoked: revoked.length })
      );
    } catch (error) {
      return NextResponse.json(
        { error: getErrorMessage(error) },
        { status: 500 }
      );
    }
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
    return await ackUnprocessable({
      eventId: event.id,
      eventType: event.type,
      objectId: session.id,
      reason: "payment_flow is not an AgentVouch Stripe payment",
    });
  }
  if (!skillDbId || !buyerPubkey || !checkoutPriceMicros) {
    return await ackUnprocessable({
      eventId: event.id,
      eventType: event.type,
      objectId: session.id,
      skillDbId,
      buyerKey: buyerPubkey,
      reason:
        "missing skill_db_id, buyer_pubkey, or price_usdc_micros metadata",
    });
  }
  if (session.mode !== "payment") {
    return await ackUnprocessable({
      eventId: event.id,
      eventType: event.type,
      objectId: session.id,
      skillDbId,
      buyerKey: buyerPubkey,
      reason: "session is not a one-time payment",
    });
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
    return await ackUnprocessable({
      eventId: event.id,
      eventType: event.type,
      objectId: session.id,
      skillDbId,
      buyerKey: buyerPubkey,
      reason: "session currency is not USD",
    });
  }

  let micros: bigint;
  try {
    micros = BigInt(checkoutPriceMicros);
  } catch {
    return await ackUnprocessable({
      eventId: event.id,
      eventType: event.type,
      objectId: session.id,
      skillDbId,
      buyerKey: buyerPubkey,
      reason: "price_usdc_micros is invalid",
    });
  }
  if (micros <= 0n) {
    return await ackUnprocessable({
      eventId: event.id,
      eventType: event.type,
      objectId: session.id,
      skillDbId,
      buyerKey: buyerPubkey,
      reason: "price_usdc_micros must be positive",
    });
  }
  if (
    typeof session.amount_total !== "number" ||
    session.amount_total !== usdcMicrosToUsdCents(micros)
  ) {
    return await ackUnprocessable({
      eventId: event.id,
      eventType: event.type,
      objectId: session.id,
      skillDbId,
      buyerKey: buyerPubkey,
      reason: "charged amount does not match checkout metadata price",
    });
  }

  try {
    await initializeDatabase();

    // Re-read to ensure the skill still exists and has not become a Base
    // protocol listing since checkout creation. Fulfillment uses the
    // checkout-time amount stored in Stripe metadata, so price changes do not
    // strand paid buyers.
    const rows = await sql()<{
      id: string;
      evm_listing_id: string | null;
    }>`
      SELECT id, evm_listing_id
      FROM skills
      WHERE id = ${skillDbId}::uuid
      LIMIT 1
    `;
    if (!rows[0]) {
      return await ackUnprocessable({
        eventId: event.id,
        eventType: event.type,
        objectId: session.id,
        skillDbId,
        buyerKey: buyerPubkey,
        reason: "skill no longer exists",
      });
    }
    if (rows[0].evm_listing_id) {
      return await ackUnprocessable({
        eventId: event.id,
        eventType: event.type,
        objectId: session.id,
        skillDbId,
        buyerKey: buyerPubkey,
        reason: "card checkout is unavailable for Base protocol listings",
      });
    }

    // Stripe payment reference + wallet buyer identity from checkout metadata.
    // `payment_tx_signature` is UNIQUE, giving us idempotency on retries.
    const paymentRef = stripePaymentRef(session.payment_intent);
    if (!paymentRef) {
      return await ackUnprocessable({
        eventId: event.id,
        eventType: event.type,
        objectId: session.id,
        skillDbId,
        buyerKey: buyerPubkey,
        reason: "paid session without payment_intent",
      });
    }

    // The entitlement upsert is last-receipt-wins: letting a Stripe receipt
    // through for a buyer who already holds a live entitlement (e.g. a real
    // on-chain purchase, or a duplicate delivery) would null out its
    // purchase_pda / chain-context provenance. Ack without writing instead.
    // A REVOKED entitlement (refund/chargeback) stays revoked for replays of
    // the same payment; only a genuinely new payment re-mints.
    const entitlement = await getUsdcPurchaseEntitlementStatus(
      skillDbId,
      buyerPubkey
    );
    if (
      entitlement.revoked &&
      (await hasUsdcPurchaseReceiptForPaymentRef(paymentRef))
    ) {
      return await ackUnprocessable({
        eventId: event.id,
        eventType: event.type,
        objectId: session.id,
        paymentRef,
        skillDbId,
        buyerKey: buyerPubkey,
        reason: "payment was refunded or disputed; entitlement stays revoked",
        needsReview: false,
      });
    }

    const recorded = await recordRevocableUsdcPurchaseReceipt({
      skillDbId,
      buyerPubkey,
      paymentTxSignature: paymentRef,
      recipientAta: STRIPE_RECIPIENT_SENTINEL,
      currencyMint: STRIPE_CURRENCY_SENTINEL,
      amountMicros: micros.toString(),
      paymentFlow: STRIPE_PAYMENT_FLOW,
    });
    if (recorded.revoked) {
      return await ackUnprocessable({
        eventId: event.id,
        eventType: event.type,
        objectId: session.id,
        paymentRef,
        skillDbId,
        buyerKey: buyerPubkey,
        reason: "payment was refunded or disputed; entitlement stays revoked",
        needsReview: false,
      });
    }

    return await recordOutcomeOrRetry(
      {
        eventId: event.id,
        eventType: event.type,
        objectId: session.id,
        paymentRef,
        skillDbId,
        buyerKey: buyerPubkey,
        outcome: "fulfilled",
        reason: "wallet-bound entitlement recorded",
        needsReview: false,
        details: {
          alreadyEntitled: entitlement.exists && !entitlement.revoked,
        },
      },
      NextResponse.json({
        received: true,
        entitled: buyerPubkey,
        alreadyEntitled: entitlement.exists && !entitlement.revoked,
      })
    );
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
