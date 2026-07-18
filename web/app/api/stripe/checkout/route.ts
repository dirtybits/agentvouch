// Tier 1 Stripe checkout — PROTOTYPE. See docs/STRIPE_FEASIBILITY.md.
// Creates a Stripe Checkout Session for a paid skill's listed price. No-ops
// with 501 unless Stripe is configured and checkout is explicitly activated.
import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase, sql } from "@/lib/db";
import {
  STRIPE_MIN_CHARGE_USD_CENTS,
  createCheckoutSession,
  getStripeCheckoutActivation,
  usdcMicrosToUsdCents,
} from "@/lib/stripe";
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
      : !activation.serverFlagEnabled
      ? "Set AGENTVOUCH_STRIPE_CHECKOUT_ENABLED=true."
      : "Install the production edge rate limit, then set AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY=true.";
    return NextResponse.json(
      {
        error: `Stripe checkout is not enabled. ${reason}`,
      },
      { status: 501 }
    );
  }

  let body: { skillId?: string; customerEmail?: string; auth?: AuthPayload };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const skillId = body.skillId?.trim();
  if (!skillId) {
    return NextResponse.json({ error: "skillId is required" }, { status: 400 });
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
    const session = await createCheckoutSession({
      skillDbId: skill.id,
      skillName: skill.name,
      buyer: accountCheckout
        ? { kind: "account", accountId: buyerSession!.accountId }
        : { kind: "wallet", pubkey: verification.pubkey! },
      amountUsdcMicros: micros.toString(),
      amountUsdCents,
      successUrl: `${base}/skills/${skill.id}?stripe=success`,
      cancelUrl: `${base}/skills/${skill.id}?stripe=cancelled`,
      customerEmail: body.customerEmail?.trim() || undefined,
    });

    return NextResponse.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
