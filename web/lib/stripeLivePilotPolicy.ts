import type { StripeLivePilotScope } from "@/lib/stripe";

export type StripeLivePilotCapSnapshot = {
  grossReservedUsdCents: number;
  completedPayments: number;
  concurrentReservations: number;
};

export type StripeLivePilotCapLimits = Pick<
  StripeLivePilotScope,
  "maxGrossUsdCents" | "maxCompletedPayments" | "maxConcurrentReservations"
>;

export type StripeLivePilotCapRejection =
  | "invalid-state"
  | "gross-cap"
  | "completed-payment-cap"
  | "concurrent-reservation-cap";

export function evaluateStripeLivePilotCaps(
  snapshot: StripeLivePilotCapSnapshot,
  amountUsdCents: number,
  limits: StripeLivePilotCapLimits
): StripeLivePilotCapRejection | null {
  const values = [
    snapshot.grossReservedUsdCents,
    snapshot.completedPayments,
    snapshot.concurrentReservations,
    amountUsdCents,
    limits.maxGrossUsdCents,
    limits.maxCompletedPayments,
    limits.maxConcurrentReservations,
  ];
  if (
    values.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    amountUsdCents === 0 ||
    limits.maxGrossUsdCents === 0 ||
    limits.maxCompletedPayments === 0 ||
    limits.maxConcurrentReservations === 0
  ) {
    return "invalid-state";
  }
  if (
    snapshot.grossReservedUsdCents + amountUsdCents >
    limits.maxGrossUsdCents
  ) {
    return "gross-cap";
  }
  // Every open Session reserves one potential completed-payment slot. This
  // prevents N concurrent Sessions from later exceeding the completion cap.
  if (
    snapshot.completedPayments + snapshot.concurrentReservations >=
    limits.maxCompletedPayments
  ) {
    return "completed-payment-cap";
  }
  if (snapshot.concurrentReservations >= limits.maxConcurrentReservations) {
    return "concurrent-reservation-cap";
  }
  return null;
}
