export type SkillPaymentFlow =
  | "free"
  | "direct-purchase-skill"
  | "x402-usdc"
  | "legacy-sol";

type PaymentFlowInput = {
  priceUsdcMicros?: string | number | bigint | null;
  onChainAddress?: string | null;
  legacySolLamports?: number | null;
  allowLegacySol?: boolean;
};

export function normalizeUsdcMicros(
  value: string | number | bigint | null | undefined
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) return null;
  return BigInt(normalized) > 0n ? normalized : null;
}

export function getSkillPaymentFlow({
  priceUsdcMicros,
  onChainAddress,
  legacySolLamports,
  allowLegacySol = false,
}: PaymentFlowInput): SkillPaymentFlow {
  if (normalizeUsdcMicros(priceUsdcMicros)) {
    return onChainAddress ? "direct-purchase-skill" : "x402-usdc";
  }

  if (allowLegacySol && (legacySolLamports ?? 0) > 0) {
    return "legacy-sol";
  }

  return "free";
}

export function requiresPurchase(paymentFlow: SkillPaymentFlow): boolean {
  return paymentFlow !== "free";
}

export function hasUsdcPrice(value: unknown): value is string | number | bigint {
  return normalizeUsdcMicros(value as string | number | bigint | null) !== null;
}
