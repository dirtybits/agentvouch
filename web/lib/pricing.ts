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

export function formatUsdcMicros(
  micros: string | number | bigint | null | undefined
): string | null {
  if (!micros) return null;
  try {
    const amount = BigInt(micros);
    const absoluteAmount = amount < 0n ? -amount : amount;
    const whole = absoluteAmount / 1_000_000n;
    const fractionalMicros = absoluteAmount % 1_000_000n;
    const formattedWhole = new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 0,
    }).format(whole);
    const sign = amount < 0n ? "-" : "";

    if (fractionalMicros === 0n) return `${sign}${formattedWhole}`;

    const fraction = fractionalMicros
      .toString()
      .padStart(6, "0")
      .replace(/0+$/, "")
      .padEnd(2, "0");
    return `${sign}${formattedWhole}.${fraction}`;
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
