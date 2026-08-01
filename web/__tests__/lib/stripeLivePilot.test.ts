import { describe, expect, it } from "vitest";

import {
  evaluateStripeLivePilotCaps,
  type StripeLivePilotCapSnapshot,
} from "@/lib/stripeLivePilotPolicy";

const limits = {
  maxGrossUsdCents: 1_000,
  maxCompletedPayments: 3,
  maxConcurrentReservations: 2,
};

function snapshot(
  overrides: Partial<StripeLivePilotCapSnapshot> = {}
): StripeLivePilotCapSnapshot {
  return {
    grossReservedUsdCents: 0,
    completedPayments: 0,
    concurrentReservations: 0,
    ...overrides,
  };
}

describe("Stripe live-pilot durable controls", () => {
  it("allows a reservation only while every aggregate cap remains under its limit", () => {
    expect(evaluateStripeLivePilotCaps(snapshot(), 500, limits)).toBeNull();
  });

  it("does not restore gross capacity for failed, expired, refunded, or disputed reservations", () => {
    expect(
      evaluateStripeLivePilotCaps(
        snapshot({ grossReservedUsdCents: 800 }),
        201,
        limits
      )
    ).toBe("gross-cap");
  });

  it("rejects the next reservation once completed-payment or concurrency capacity is consumed", () => {
    expect(
      evaluateStripeLivePilotCaps(
        snapshot({ completedPayments: 3 }),
        100,
        limits
      )
    ).toBe("completed-payment-cap");
    expect(
      evaluateStripeLivePilotCaps(
        snapshot({ concurrentReservations: 2 }),
        100,
        limits
      )
    ).toBe("concurrent-reservation-cap");
  });

  it("reserves completed-payment capacity for every concurrently payable Session", () => {
    expect(
      evaluateStripeLivePilotCaps(
        snapshot({ completedPayments: 2, concurrentReservations: 1 }),
        100,
        limits
      )
    ).toBe("completed-payment-cap");
  });

  it("fails closed on unsafe amounts or malformed snapshots", () => {
    expect(evaluateStripeLivePilotCaps(snapshot(), 0, limits)).toBe(
      "invalid-state"
    );
    expect(
      evaluateStripeLivePilotCaps(
        snapshot({ completedPayments: -1 }),
        100,
        limits
      )
    ).toBe("invalid-state");
  });
});
