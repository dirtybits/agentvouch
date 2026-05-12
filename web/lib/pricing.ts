export const PRICING = {
  USDC: {
    symbol: "USDC",
    decimals: 6,
    minPrice: 0.01,
    defaultPrice: 0.01,
    step: 0.001,
  },
  SOL: {
    symbol: "SOL",
    decimals: 9,
    minPrice: 0.001,
    defaultPrice: 0.001,
    step: 0.001,
  },
} as const;

export type CurrencyKey = keyof typeof PRICING;

export const DEFAULT_CURRENCY: CurrencyKey = "USDC";

export function formatMinPrice(
  currency: CurrencyKey = DEFAULT_CURRENCY
): string {
  return `${PRICING[currency].minPrice} ${PRICING[currency].symbol}`;
}

export function getMinPriceLamports(
  currency: CurrencyKey = DEFAULT_CURRENCY
): number {
  return currency === "SOL"
    ? toLamports(PRICING.SOL.minPrice)
    : toUsdcMicros(PRICING.USDC.minPrice);
}

export function isValidListingPriceLamports(
  lamports: number,
  currency: CurrencyKey = DEFAULT_CURRENCY
): boolean {
  return (
    Number.isFinite(lamports) &&
    (lamports === 0 || lamports >= getMinPriceLamports(currency))
  );
}

export function isValidListingPriceMicros(micros: number): boolean {
  return (
    Number.isFinite(micros) &&
    (micros === 0 || micros >= getMinPriceLamports("USDC"))
  );
}

export function formatSolAmount(
  lamports: number,
  minimumFractionDigits = 2,
  maximumFractionDigits = 3
): string {
  if (!Number.isFinite(lamports)) return "0.00";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(fromLamports(lamports));
}

export function formatUsdcMicros(
  micros: string | number | bigint | null | undefined
): string | null {
  if (!micros) return null;
  try {
    const amount = Number(BigInt(micros)) / 1_000_000;
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 6,
    }).format(amount);
  } catch {
    return null;
  }
}

export function toLamports(sol: number): number {
  return Math.round(sol * 10 ** PRICING.SOL.decimals);
}

export function fromLamports(lamports: number): number {
  return lamports / 10 ** PRICING.SOL.decimals;
}

export function toUsdcMicros(usdc: number): number {
  return Math.round(usdc * 10 ** PRICING.USDC.decimals);
}

export function fromUsdcMicros(micros: number): number {
  return micros / 10 ** PRICING.USDC.decimals;
}
