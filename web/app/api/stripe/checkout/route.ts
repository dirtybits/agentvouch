// Tier 1 Stripe checkout — PROTOTYPE. See docs/STRIPE_FEASIBILITY.md.
// Creates a Stripe Checkout Session for a paid skill's listed price. No-ops
// with 501 unless Stripe is configured and checkout is explicitly activated.
import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase, sql } from "@/lib/db";
import {
  STRIPE_MIN_CHARGE_USD_CENTS,
  createCheckoutSession,
  expireCheckoutSession,
  getStripeCheckoutActivation,
  getStripeLivePilotScope,
  usdcMicrosToUsdCents,
} from "@/lib/stripe";
import { CARD_CHECKOUT_RECOURSE_DISCLOSURE_VERSION } from "@/lib/stripePolicyCopy";
import {
  buildStripeCheckoutMessage,
  normalizeProtocolNewlines,
  verifyWalletSignature,
  type AuthPayload,
} from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { hasUsdcPurchaseEntitlement } from "@/lib/usdcPurchases";
import { hasOnChainPurchase } from "@/lib/x402";
import { checkRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { getBuyerSession, isSameOriginMutation } from "@/lib/buyerSession";
import { isBuyerCardAccessServerEnabled } from "@/lib/buyerAuthConfig";
import { hasActiveMarketplaceAccessGrant } from "@/lib/buyerAccessGrants";
import {
  StripeLivePilotCapError,
  attachStripeLivePilotCheckoutSession,
  closeStripeLivePilotReservationAfterApiFailure,
  reserveStripeLivePilotCheckout,
  markStripeLivePilotReview,
} from "@/lib/stripeLivePilot";

const STRIPE_CHECKOUT_IP_LIMIT = { limit: 20, windowMs: 15 * 60_000 };
const STRIPE_CHECKOUT_WALLET_LIMIT = { limit: 5, windowMs: 10 * 60_000 };
const STRIPE_CHECKOUT_ACCOUNT_LIMIT = { limit: 5, windowMs: 10 * 60_000 };

type SkillPriceRow = {
  id: string;
  name: string;
  price_usdc_micros: string | null;
  on_chain_address: string | null;
  evm_listing_id: string | null;
};

function resolveBaseUrl(req: NextRequest): string {
  const configured =
    process.env.AGENTVOUCH_PUBLIC_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return req.nextUrl.origin;
}

export async function POST(req: NextRequest) {
  const activation = getStripeCheckoutActivation();
  if (!activation.enabled) {
    const reason = !activation.stripeConfigured
      ? "Configure STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET."
      : !activation.keyModePermitted
      ? activation.keyMode === "live"
        ? "STRIPE_SECRET_KEY is a live key. Real card payments require an explicit AGENTVOUCH_STRIPE_LIVE_MODE_ENABLED=true acknowledgement."
        : "STRIPE_SECRET_KEY is not a recognized Stripe test or live key."
      : !activation.serverFlagEnabled
      ? "Set AGENTVOUCH_STRIPE_CHECKOUT_ENABLED=true."
      : !activation.livePilotScopeReady
      ? "Configure the complete live-pilot buyer/skill scope, reservation policy, and unit/GMV/payment/concurrency caps."
      : !activation.livePilotImplementationReady
      ? "The live pilot remains source-disabled pending founder decisions and external activation gates."
      : "Install the production edge rate limit, then set AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY=true.";
    return NextResponse.json(
      {
        error: `Stripe checkout is not enabled. ${reason}`,
      },
      { status: 501 }
    );
  }

  let body: {
    skillId?: string;
    customerEmail?: string;
    cardDisclosureVersion?: string;
    auth?: AuthPayload;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const skillId = body.skillId?.trim();
  if (!skillId) {
    return NextResponse.json({ error: "skillId is required" }, { status: 400 });
  }
  if (
    body.cardDisclosureVersion !== CARD_CHECKOUT_RECOURSE_DISCLOSURE_VERSION
  ) {
    return NextResponse.json(
      {
        error:
          "Acknowledge the current card-checkout recourse disclosure before continuing.",
      },
      { status: 400 }
    );
  }

  // Defense in depth only: this limiter is per runtime instance. Production
  // activation separately requires an operator acknowledgement that a Vercel
  // Firewall/WAF rule protects this route at the edge.
  const ipLimit = checkRateLimit(
    `stripe-checkout:ip:${clientIpFromRequest(req)}`,
    STRIPE_CHECKOUT_IP_LIMIT
  );
  if (!ipLimit.ok) {
    return NextResponse.json(
      { error: "Too many card checkout attempts. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(ipLimit.retryAfterSeconds) },
      }
    );
  }

  const accountCardAccessEnabled = isBuyerCardAccessServerEnabled();
  const buyerSession = accountCardAccessEnabled
    ? await getBuyerSession(req)
    : null;
  const accountCheckout = Boolean(buyerSession);
  if (accountCheckout && !isSameOriginMutation(req)) {
    return NextResponse.json(
      { error: "Same-origin request required for account checkout." },
      { status: 403 }
    );
  }
  if (activation.keyMode === "live" && !accountCheckout) {
    return NextResponse.json(
      {
        error:
          "The limited live card pilot requires a signed-in AgentVouch buyer account.",
      },
      { status: 403 }
    );
  }

  const livePilotScope =
    activation.keyMode === "live" ? getStripeLivePilotScope() : null;
  if (
    activation.keyMode === "live" &&
    (!livePilotScope ||
      !buyerSession ||
      !livePilotScope.buyerAccountIds.includes(
        buyerSession.accountId.toLowerCase()
      ))
  ) {
    return NextResponse.json(
      {
        error:
          "This buyer account is not included in the limited live card pilot.",
      },
      { status: 403 }
    );
  }

  const auth = body.auth;
  const verification = accountCheckout
    ? { valid: false, pubkey: null, error: null }
    : auth
    ? verifyWalletSignature(auth)
    : { valid: false, pubkey: null, error: "Wallet auth is required" };
  if (!accountCheckout && (!verification.valid || !verification.pubkey)) {
    return NextResponse.json(
      {
        error: accountCardAccessEnabled
          ? verification.error || "Sign in or provide valid wallet auth"
          : verification.error ||
            "Wallet auth is required before Stripe checkout",
      },
      { status: 401 }
    );
  }

  const buyerLimit = checkRateLimit(
    accountCheckout
      ? `stripe-checkout:account:${buyerSession!.accountId}`
      : `stripe-checkout:wallet:${verification.pubkey}`,
    accountCheckout
      ? STRIPE_CHECKOUT_ACCOUNT_LIMIT
      : STRIPE_CHECKOUT_WALLET_LIMIT
  );
  if (!buyerLimit.ok) {
    return NextResponse.json(
      { error: "Too many card checkout attempts. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(buyerLimit.retryAfterSeconds) },
      }
    );
  }

  try {
    await initializeDatabase();

    const rows = await sql()<SkillPriceRow>`
      SELECT
        id,
        name,
        price_usdc_micros::text AS price_usdc_micros,
        on_chain_address,
        evm_listing_id
      FROM skills
      WHERE id = ${skillId}::uuid
      LIMIT 1
    `;
    const skill = rows[0];
    if (!skill) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    if (
      activation.keyMode === "live" &&
      !livePilotScope?.skillIds.includes(skill.id.toLowerCase())
    ) {
      return NextResponse.json(
        { error: "This skill is not included in the limited live card pilot." },
        { status: 403 }
      );
    }

    const micros = skill.price_usdc_micros
      ? BigInt(skill.price_usdc_micros)
      : 0n;
    if (micros <= 0n) {
      return NextResponse.json(
        { error: "Skill is not a paid listing" },
        { status: 400 }
      );
    }

    // Legacy wallet-bound card access cannot redeem Base protocol downloads.
    // Signed-in account checkout mints a separate marketplace grant and is
    // intentionally allowed for Base Sepolia without a protocol receipt.
    if (skill.evm_listing_id && !accountCheckout) {
      return NextResponse.json(
        {
          error:
            "Card checkout is not available for Base protocol listings yet. Purchase with Base USDC instead.",
        },
        { status: 409 }
      );
    }

    const amountUsdCents = usdcMicrosToUsdCents(micros);
    if (amountUsdCents < STRIPE_MIN_CHARGE_USD_CENTS) {
      return NextResponse.json(
        {
          error:
            "This listing is priced below the card checkout minimum ($0.50). Use a USDC purchase path instead.",
        },
        { status: 400 }
      );
    }
    if (livePilotScope && amountUsdCents > livePilotScope.maxUnitUsdCents) {
      return NextResponse.json(
        {
          error:
            "This skill exceeds the limited live card pilot's maximum charge.",
        },
        { status: 403 }
      );
    }

    if (!accountCheckout) {
      // Wallet checkout binds skill id and exact amount to the signature.
      const expectedMessage = buildStripeCheckoutMessage(
        skill.id,
        micros.toString(),
        auth!.timestamp
      );
      if (normalizeProtocolNewlines(auth!.message) !== expectedMessage) {
        return NextResponse.json(
          {
            error:
              "Message scope mismatch. If the listing price changed, reload the page and try again.",
            expected_format:
              "AgentVouch Stripe Checkout\\nAction: stripe-checkout\\nSkill id: {id}\\nAmount (USDC micros): {micros}\\nTimestamp: {ms}",
          },
          { status: 401 }
        );
      }
    }

    const alreadyPurchased = accountCheckout
      ? await hasActiveMarketplaceAccessGrant(buyerSession!.accountId, skill.id)
      : (await hasUsdcPurchaseEntitlement(skill.id, verification.pubkey!)) ||
        (skill.on_chain_address
          ? await hasOnChainPurchase(
              verification.pubkey!,
              skill.on_chain_address
            )
          : false);
    if (alreadyPurchased) {
      return NextResponse.json(
        {
          error: accountCheckout
            ? "This account already has access to the skill"
            : "This wallet already has access to the skill",
        },
        { status: 409 }
      );
    }

    const base = resolveBaseUrl(req);
    // Store and send one exact expected-expiry timestamp. The 31-minute
    // minimum leaves round-trip headroom above Stripe's 30-minute API floor.
    // Only a signed Stripe lifecycle event releases a created Session's slot.
    const livePilotExpiresAtUnixSeconds = livePilotScope
      ? Math.floor(Date.now() / 1000) +
        livePilotScope.reservationTtlMinutes * 60
      : null;
    const reservation = livePilotScope
      ? await reserveStripeLivePilotCheckout({
          buyerAccountId: buyerSession!.accountId,
          skillDbId: skill.id,
          recourseDisclosureVersion: body.cardDisclosureVersion,
          amountUsdCents,
          expiresAtUnixSeconds: livePilotExpiresAtUnixSeconds!,
          scope: livePilotScope,
        })
      : null;
    let session;
    try {
      session = await createCheckoutSession({
        skillDbId: skill.id,
        skillName: skill.name,
        buyer: accountCheckout
          ? { kind: "account", accountId: buyerSession!.accountId }
          : { kind: "wallet", pubkey: verification.pubkey! },
        amountUsdcMicros: micros.toString(),
        amountUsdCents,
        recourseDisclosureVersion: body.cardDisclosureVersion,
        successUrl: `${base}/skills/${skill.id}?stripe=success`,
        cancelUrl: `${base}/skills/${skill.id}?stripe=cancelled`,
        customerEmail: body.customerEmail?.trim() || undefined,
        ...(reservation && livePilotScope
          ? {
              livePilotReservationId: reservation.reservationId,
              expiresAtUnixSeconds: livePilotExpiresAtUnixSeconds!,
            }
          : {}),
      });
    } catch (error) {
      if (reservation) {
        await closeStripeLivePilotReservationAfterApiFailure(
          reservation.reservationId,
          getErrorMessage(error)
        );
      }
      throw error;
    }
    if (reservation) {
      try {
        await attachStripeLivePilotCheckoutSession({
          reservationId: reservation.reservationId,
          checkoutSessionId: session.id,
        });
      } catch (attachError) {
        let sessionExpired = false;
        try {
          await expireCheckoutSession(session.id);
          sessionExpired = true;
        } catch (expireError) {
          // The Session may still be payable. Preserve a durable review row;
          // a later signed webhook may recover by binding this exact Session
          // to the immutable reservation metadata.
          await markStripeLivePilotReview({
            reservationId: reservation.reservationId,
            reason: `Checkout Session ${
              session.id
            } attachment failed (${getErrorMessage(
              attachError
            )}); expiration also failed (${getErrorMessage(expireError)})`,
          });
        }
        if (sessionExpired) {
          try {
            await closeStripeLivePilotReservationAfterApiFailure(
              reservation.reservationId,
              `Checkout Session attachment failed and Session was expired: ${getErrorMessage(
                attachError
              )}`
            );
          } catch (closeError) {
            // Payment is impossible after successful expiration. If the DB is
            // transiently unavailable the immutable row remains reserved and
            // consumes gross capacity; the stale-reservation monitor exposes it.
            console.error(
              `Stripe live-pilot Session ${
                session.id
              } was expired but reservation close failed: ${getErrorMessage(
                closeError
              )}`
            );
          }
        }
        throw attachError;
      }
    }

    return NextResponse.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    if (error instanceof StripeLivePilotCapError) {
      return NextResponse.json(
        {
          error:
            "The limited live card pilot has reached its configured exposure limit.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
