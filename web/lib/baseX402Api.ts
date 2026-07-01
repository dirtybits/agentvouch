import { sql } from "@/lib/db";
import { normalizeUsdcMicros } from "@/lib/listingContract";
import {
  decodeX402PaymentSignatureHeader,
  type X402PaymentPayload,
} from "@/lib/x402";
import type { BaseX402Skill } from "@/lib/baseX402";
import { BASE_SEPOLIA_CHAIN_CONTEXT } from "@/lib/chains";

export type LoadedBaseX402Skill = BaseX402Skill & {
  price_usdc_micros: string;
};

export function getBaseX402PayloadFromBody(
  body: Record<string, unknown>
): X402PaymentPayload | null {
  if (typeof body.paymentSignature === "string") {
    return decodeX402PaymentSignatureHeader(body.paymentSignature);
  }

  const payload = body.paymentPayload ?? body.payload;
  if (!payload || typeof payload !== "object") return null;
  return payload as X402PaymentPayload;
}

export function getBaseX402SkillIdFromBody(
  body: Record<string, unknown>
): string | null {
  const value = body.skillDbId ?? body.skill_id ?? body.skillId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function loadBaseX402Skill(
  skillDbId: string
): Promise<LoadedBaseX402Skill | null> {
  const rows = await sql()<BaseX402Skill>`
    SELECT
      id,
      price_usdc_micros::text,
      currency_mint,
      chain_context,
      on_chain_protocol_version,
      on_chain_program_id,
      evm_listing_id,
      evm_contract_address
    FROM skills
    WHERE id = ${skillDbId}::uuid
  `;
  const skill = rows[0];
  if (!skill) return null;
  if (
    skill.chain_context !== BASE_SEPOLIA_CHAIN_CONTEXT ||
    !skill.evm_listing_id
  ) {
    throw new Error("Skill is not a Base x402 listing");
  }

  const priceUsdcMicros = normalizeUsdcMicros(skill.price_usdc_micros);
  if (!priceUsdcMicros) {
    throw new Error("Base x402 skill is missing a paid USDC price");
  }

  return {
    ...skill,
    price_usdc_micros: priceUsdcMicros,
  };
}
