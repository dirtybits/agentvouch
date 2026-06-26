// Tier 1 Stripe checkout — PROTOTYPE. See docs/STRIPE_FEASIBILITY.md.
// Creates a Stripe Checkout Session for a paid skill's listed price. No-ops
// with 501 unless Stripe is configured.
import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase, sql } from "@/lib/db";
import {
  createCheckoutSession,
  isStripeEnabled,
  usdcMicrosToUsdCents,
} from "@/lib/stripe";
import { getErrorMessage } from "@/lib/errors";

type SkillPriceRow = {
  id: string;
  name: string;
  price_usdc_micros: string | null;
};

function resolveBaseUrl(req: NextRequest): string {
  const configured = process.env.AGENTVOUCH_PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return req.nextUrl.origin;
}

export async function POST(req: NextRequest) {
  if (!isStripeEnabled()) {
    return NextResponse.json(
      { error: "Stripe payments are not enabled" },
      { status: 501 }
    );
  }

  let body: { skillId?: string; customerEmail?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const skillId = body.skillId?.trim();
  if (!skillId) {
    return NextResponse.json({ error: "skillId is required" }, { status: 400 });
  }

  try {
    await initializeDatabase();

    const rows = await sql()<SkillPriceRow>`
      SELECT id, name, price_usdc_micros::text AS price_usdc_micros
      FROM skills
      WHERE id = ${skillId}::uuid
      LIMIT 1
    `;
    const skill = rows[0];
    if (!skill) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    const micros = skill.price_usdc_micros ? BigInt(skill.price_usdc_micros) : 0n;
    if (micros <= 0n) {
      return NextResponse.json(
        { error: "Skill is not a paid listing" },
        { status: 400 }
      );
    }

    const base = resolveBaseUrl(req);
    const session = await createCheckoutSession({
      skillDbId: skill.id,
      skillName: skill.name,
      amountUsdCents: usdcMicrosToUsdCents(micros),
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
