import { describe, expect, it } from "vitest";
import {
  evaluateStripeLivePilotCaps,
  type StripeLivePilotCapLimits,
  type StripeLivePilotCapSnapshot,
} from "@/lib/stripeLivePilotPolicy";

const LIMITS: StripeLivePilotCapLimits = {
  maxGrossUsdCents: 10_000,
  maxCompletedPayments: 10,
  maxConcurrentReservations: 3,
};

const EMPTY: StripeLivePilotCapSnapshot = {
  grossReservedUsdCents: 0,
  completedPayments: 0,
  concurrentReservations: 0,
};

describe("evaluateStripeLivePilotCaps", () => {
  it("allows a reservation when every cap has headroom", () => {
    expect(evaluateStripeLivePilotCaps(EMPTY, 100, LIMITS)).toBeNull();
  });

  it("allows a reservation that lands exactly at the gross cap (no overshoot)", () => {
    const snapshot: StripeLivePilotCapSnapshot = {
      grossReservedUsdCents: 9_500,
      completedPayments: 0,
      concurrentReservations: 0,
    };
    // 9_500 + 500 == 10_000 -> allowed; only a strict overshoot rejects.
    expect(evaluateStripeLivePilotCaps(snapshot, 500, LIMITS)).toBeNull();
  });

  it("rejects when the new reservation would overshoot the gross cap", () => {
    const snapshot: StripeLivePilotCapSnapshot = {
      grossReservedUsdCents: 9_501,
      completedPayments: 0,
      concurrentReservations: 0,
    };
    // 9_501 + 500 > 10_000
    expect(evaluateStripeLivePilotCaps(snapshot, 500, LIMITS)).toBe(
      "gross-cap"
    );
  });

  it("rejects when completed payments plus open reservations saturate the completion cap", () => {
    const snapshot: StripeLivePilotCapSnapshot = {
      grossReservedUsdCents: 0,
      completedPayments: 7,
      concurrentReservations: 3,
    };
    // 7 + 3 == 10 -> every remaining slot is reserved; no new Session may open.
    expect(evaluateStripeLivePilotCaps(snapshot, 100, LIMITS)).toBe(
      "completed-payment-cap"
    );
  });

  it("allows one more reservation while the completion cap still has a free slot", () => {
    const snapshot: StripeLivePilotCapSnapshot = {
      grossReservedUsdCents: 0,
      completedPayments: 7,
      concurrentReservations: 2,
    };
    // 7 + 2 < 10
    expect(evaluateStripeLivePilotCaps(snapshot, 100, LIMITS)).toBeNull();
  });

  it("rejects when open reservations saturate the concurrent-reservation cap", () => {
    const snapshot: StripeLivePilotCapSnapshot = {
      grossReservedUsdCents: 0,
      completedPayments: 0,
      concurrentReservations: 3,
    };
    // 3 >= 3 -> no further concurrent reservations.
    expect(evaluateStripeLivePilotCaps(snapshot, 100, LIMITS)).toBe(
      "concurrent-reservation-cap"
    );
  });

  it("allows one more reservation below the concurrent-reservation cap", () => {
    const snapshot: StripeLivePilotCapSnapshot = {
      grossReservedUsdCents: 0,
      completedPayments: 0,
      concurrentReservations: 2,
    };
    expect(evaluateStripeLivePilotCaps(snapshot, 100, LIMITS)).toBeNull();
  });

  it("reports gross-cap before the other caps when several would trip", () => {
    const snapshot: StripeLivePilotCapSnapshot = {
      grossReservedUsdCents: 9_999,
      completedPayments: 10,
      concurrentReservations: 3,
    };
    // Gross overshoots (9_999 + 2 > 10_000) AND both count caps saturate; the
    // first check wins.
    expect(evaluateStripeLivePilotCaps(snapshot, 2, LIMITS)).toBe("gross-cap");
  });

  it("reports completed-payment-cap before concurrent-reservation-cap", () => {
    const snapshot: StripeLivePilotCapSnapshot = {
      grossReservedUsdCents: 0,
      completedPayments: 8,
      concurrentReservations: 3,
    };
    // Completion cap trips (8 + 3 >= 10) before the concurrency cap (3 >= 3).
    expect(evaluateStripeLivePilotCaps(snapshot, 100, LIMITS)).toBe(
      "completed-payment-cap"
    );
  });

  it("rejects a zero charge amount as invalid state", () => {
    expect(evaluateStripeLivePilotCaps(EMPTY, 0, LIMITS)).toBe("invalid-state");
  });

  it("rejects negative amounts as invalid state", () => {
    expect(evaluateStripeLivePilotCaps(EMPTY, -1, LIMITS)).toBe(
      "invalid-state"
    );
  });

  it("rejects a non-integer amount as invalid state", () => {
    expect(evaluateStripeLivePilotCaps(EMPTY, 10.5, LIMITS)).toBe(
      "invalid-state"
    );
  });

  it("rejects a non-safe-integer amount as invalid state", () => {
    expect(
      evaluateStripeLivePilotCaps(EMPTY, Number.MAX_SAFE_INTEGER + 1, LIMITS)
    ).toBe("invalid-state");
  });

  it("rejects a zero gross cap as invalid state (misconfigured scope)", () => {
    expect(
      evaluateStripeLivePilotCaps(EMPTY, 100, {
        ...LIMITS,
        maxGrossUsdCents: 0,
      })
    ).toBe("invalid-state");
  });

  it("rejects a zero completed-payment cap as invalid state", () => {
    expect(
      evaluateStripeLivePilotCaps(EMPTY, 100, {
        ...LIMITS,
        maxCompletedPayments: 0,
      })
    ).toBe("invalid-state");
  });

  it("rejects a zero concurrent-reservation cap as invalid state", () => {
    expect(
      evaluateStripeLivePilotCaps(EMPTY, 100, {
        ...LIMITS,
        maxConcurrentReservations: 0,
      })
    ).toBe("invalid-state");
  });

  it("rejects a negative snapshot counter as invalid state", () => {
    const snapshot: StripeLivePilotCapSnapshot = {
      grossReservedUsdCents: -1,
      completedPayments: 0,
      concurrentReservations: 0,
    };
    expect(evaluateStripeLivePilotCaps(snapshot, 100, LIMITS)).toBe(
      "invalid-state"
    );
  });

  it("rejects a non-integer snapshot counter as invalid state", () => {
    const snapshot: StripeLivePilotCapSnapshot = {
      grossReservedUsdCents: 0,
      completedPayments: 0,
      concurrentReservations: 1.25,
    };
    expect(evaluateStripeLivePilotCaps(snapshot, 100, LIMITS)).toBe(
      "invalid-state"
    );
  });
});
