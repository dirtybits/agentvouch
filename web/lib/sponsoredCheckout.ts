export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const DEFAULT_SPONSORED_CHECKOUT_BUFFER_BPS = 2_000n;

export type SponsoredCheckoutQuoteInput = {
  rentLamports: bigint | number | string;
  transactionFeeLamports?: bigint | number | string;
  microUsdcPerSol: bigint | number | string;
  bufferBps?: bigint | number | string;
  capUsdcMicros?: bigint | number | string | null;
};

export type SponsoredCheckoutQuote = {
  baseLamports: bigint;
  bufferedLamports: bigint;
  microUsdcPerSol: bigint;
  setupFeeUsdcMicros: bigint;
  capped: boolean;
};

function toNonNegativeBigInt(value: bigint | number | string, label: string) {
  const result = BigInt(value);
  if (result < 0n) {
    throw new Error(`${label} must be non-negative`);
  }
  return result;
}

function ceilDiv(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n) throw new Error("Denominator must be positive");
  return (numerator + denominator - 1n) / denominator;
}

export function quoteSponsoredCheckoutSetupFee(
  input: SponsoredCheckoutQuoteInput
): SponsoredCheckoutQuote {
  const rentLamports = toNonNegativeBigInt(
    input.rentLamports,
    "rentLamports"
  );
  const transactionFeeLamports = toNonNegativeBigInt(
    input.transactionFeeLamports ?? 0n,
    "transactionFeeLamports"
  );
  const microUsdcPerSol = toNonNegativeBigInt(
    input.microUsdcPerSol,
    "microUsdcPerSol"
  );
  if (microUsdcPerSol === 0n) {
    throw new Error("microUsdcPerSol must be positive");
  }
  const bufferBps = toNonNegativeBigInt(
    input.bufferBps ?? DEFAULT_SPONSORED_CHECKOUT_BUFFER_BPS,
    "bufferBps"
  );
  const capUsdcMicros =
    input.capUsdcMicros === null || input.capUsdcMicros === undefined
      ? null
      : toNonNegativeBigInt(input.capUsdcMicros, "capUsdcMicros");

  const baseLamports = rentLamports + transactionFeeLamports;
  const bufferedLamports = ceilDiv(baseLamports * (10_000n + bufferBps), 10_000n);
  const uncappedSetupFeeUsdcMicros = ceilDiv(
    bufferedLamports * microUsdcPerSol,
    LAMPORTS_PER_SOL
  );
  const capped =
    capUsdcMicros !== null && uncappedSetupFeeUsdcMicros > capUsdcMicros;

  return {
    baseLamports,
    bufferedLamports,
    microUsdcPerSol,
    setupFeeUsdcMicros: capped
      ? capUsdcMicros ?? uncappedSetupFeeUsdcMicros
      : uncappedSetupFeeUsdcMicros,
    capped,
  };
}

export function parseSponsoredCheckoutMicroUsdcPerSol(
  value: string | undefined,
  envName = "AGENTVOUCH_SPONSOR_SOL_USDC_MICRO_PRICE"
) {
  if (!value) {
    throw new Error(`${envName} is required when sponsored checkout is enabled`);
  }
  const parsed = BigInt(value);
  if (parsed <= 0n) {
    throw new Error(`${envName} must be a positive integer micro-USDC price`);
  }
  return parsed;
}
