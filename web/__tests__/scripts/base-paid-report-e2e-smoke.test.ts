import { describe, expect, it } from "vitest";
import {
  MAX_BASE_LOG_BLOCK_SPAN,
  assertCheckpointCanonical,
  buildInclusiveBlockRanges,
  buildPaidReportAlerts,
  deriveEventReserveCredit,
  parseOpsMode,
  type StoredEvent,
} from "../../scripts/base-paid-report-e2e-smoke";

function event(eventName: string, args: Record<string, string>): StoredEvent {
  return {
    blockNumber: "1",
    blockHash: `0x${"a".repeat(64)}`,
    transactionHash: `0x${"b".repeat(64)}`,
    logIndex: 0,
    eventName,
    args,
  };
}

describe("Base paid-report operations driver", () => {
  it("defaults to read-only preflight and hard-disables public apply or secret args", () => {
    expect(parseOpsMode([])).toBe("preflight");
    expect(parseOpsMode(["monitor"])).toBe("monitor");
    expect(() => parseOpsMode(["monitor", "--apply"])).toThrow("apply");
    expect(() => parseOpsMode(["--private-key=0xdead"])).toThrow(
      "secret-bearing"
    );
    expect(() => parseOpsMode(["sepolia-smoke"])).toThrow("only read-only");
  });

  it("splits inclusive log scans into at most 1,999-block chunks", () => {
    const ranges = buildInclusiveBlockRanges(10n, 4_010n);
    expect(ranges).toEqual([
      { fromBlock: 10n, toBlock: 2_008n },
      { fromBlock: 2_009n, toBlock: 4_007n },
      { fromBlock: 4_008n, toBlock: 4_010n },
    ]);
    expect(
      ranges.every(
        (range) =>
          range.toBlock - range.fromBlock + 1n <= MAX_BASE_LOG_BLOCK_SPAN
      )
    ).toBe(true);
  });

  it("fails closed when a restart checkpoint is no longer canonical", () => {
    const checkpoint = {
      chainId: 84_532,
      contractAddress: "0x1111111111111111111111111111111111111111",
      blockNumber: "100",
      blockHash: `0x${"a".repeat(64)}`,
    };
    expect(() =>
      assertCheckpointCanonical(checkpoint, checkpoint.blockHash)
    ).not.toThrow();
    expect(() =>
      assertCheckpointCanonical(checkpoint, `0x${"b".repeat(64)}`)
    ).toThrow("reorg");
  });

  it("derives reserve credit only from complete deployment-scoped lifecycle events", () => {
    expect(
      deriveEventReserveCredit([
        event("PaidPurchaseReportRejected", { reserveCredit: "5000000" }),
        event("PaidPurchaseReportFinalized", { reserveCredit: "2000000" }),
        event("RestitutionReserveClaimed", { amount: "3000000" }),
      ])
    ).toBe(4_000_000n);
    expect(() =>
      deriveEventReserveCredit([
        event("RestitutionReserveClaimed", { amount: "1" }),
      ])
    ).toThrow("incomplete");
  });

  it("separates pause, stale resolution, crank, credit, reserve, and candidate alerts", () => {
    const alerts = buildPaidReportAlerts({
      nowSeconds: 10_000n,
      paused: false,
      expectedPaused: true,
      acceptedAgeAlertSeconds: 100n,
      creditExpiryAlertSeconds: 200n,
      eventDerivedReserveCredit: 7n,
      reports: [
        {
          reportId: "1",
          authorAddress: "0x1111111111111111111111111111111111111111",
          status: 1,
          outcome: 0,
          reviewDeadline: "9999",
          acceptedAt: "0",
          activeVouchStakeUsdcMicros: "0",
          processedPreSlashStakeUsdcMicros: "0",
          buyerCreditUsdcMicros: "0",
          claimDeadline: "0",
          creditHandled: false,
          fallbackCrankerCandidates: 0,
        },
        {
          reportId: "2",
          authorAddress: "0x2222222222222222222222222222222222222222",
          status: 2,
          outcome: 0,
          reviewDeadline: "9000",
          acceptedAt: "9800",
          activeVouchStakeUsdcMicros: "0",
          processedPreSlashStakeUsdcMicros: "0",
          buyerCreditUsdcMicros: "0",
          claimDeadline: "0",
          creditHandled: false,
          fallbackCrankerCandidates: 0,
        },
        {
          reportId: "3",
          authorAddress: "0x3333333333333333333333333333333333333333",
          status: 3,
          outcome: 4,
          reviewDeadline: "9000",
          acceptedAt: "9500",
          activeVouchStakeUsdcMicros: "100",
          processedPreSlashStakeUsdcMicros: "40",
          buyerCreditUsdcMicros: "5000000",
          claimDeadline: "10100",
          creditHandled: false,
          fallbackCrankerCandidates: 0,
        },
      ],
    });
    expect(new Set(alerts.map((alert) => alert.kind))).toEqual(
      new Set([
        "unexpected-pause-state",
        "event-derived-reserve-credit",
        "pending-past-review-deadline",
        "accepted-awaiting-ruling",
        "slash-work-stalled",
        "missing-fallback-cranker-candidate",
        "buyer-credit-near-expiry",
      ])
    );
  });
});
