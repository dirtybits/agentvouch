import { describe, expect, it } from "vitest";
import {
  MAX_BASE_LOG_BLOCK_SPAN,
  assertCheckpointCanonical,
  buildInclusiveBlockRanges,
  buildPaidReportAlerts,
  evaluateGateCDecision,
  deriveEventReserveCredit,
  parseOpsMode,
  sanitizeOpsDiagnostic,
  type GateCDecisionRecord,
  type GateCObservedDeployment,
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
    expect(parseOpsMode(["gate-c-readiness"])).toBe("gate-c-readiness");
    expect(() => parseOpsMode(["monitor", "--apply"])).toThrow("apply");
    expect(() => parseOpsMode(["--private-key=0xdead"])).toThrow(
      "secret-bearing"
    );
    expect(() => parseOpsMode(["sepolia-smoke"])).toThrow("only read-only");
  });

  it("redacts RPC URLs from diagnostics", () => {
    expect(
      sanitizeOpsDiagnostic(
        new Error(
          "HTTP request failed: https://rpc.example/v2/SECRET?api_key=TOKEN"
        )
      )
    ).toBe("HTTP request failed: <redacted-rpc-url>");
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

  const candidateCommit = "a".repeat(40);
  const contractAddress = "0x1111111111111111111111111111111111111111";
  const libraryAddress = "0x2222222222222222222222222222222222222222";
  const usdcAddress = "0x3333333333333333333333333333333333333333";
  const restitutionRecipient = "0x4444444444444444444444444444444444444444";
  const resolver = "0x5555555555555555555555555555555555555555";
  const pauseAuthority = "0x6666666666666666666666666666666666666666";

  const observed: GateCObservedDeployment = {
    candidateCommit,
    chainId: 84_532,
    protocolVersion: "base-v1-a1",
    contractAddress,
    libraryAddress,
    deploymentBlock: "12345",
    usdcAddress,
    paused: true,
    slashPercentage: 25,
    restitutionRecipient,
    chainContext: "eip155:84532",
    reportBondUsdcMicros: "5000000",
    minVouchStakeUsdcMicros: "1000000",
    minAuthorBondForFreeListingUsdcMicros: "1000000",
    minPaidListingPriceUsdcMicros: "10000",
    authorShareBps: 6000,
    voucherShareBps: 4000,
    protocolFeeBps: 0,
    authorProceedsLockSeconds: "0",
    refundClaimWindowSeconds: "604800",
    challengerRewardBps: 0,
    challengerRewardCapUsdcMicros: "0",
    stakeWeightPerUsdc: 0,
    riskComponentCap: "0",
    vouchWeight: 0,
    vouchComponentCap: "0",
    longevityBonusPerDay: 0,
    longevityComponentCap: "0",
    upheldDisputePenalty: "0",
    reputationScoreCap: "0",
    roleHolders: {
      DEFAULT_ADMIN_ROLE: ["0x7777777777777777777777777777777777777777"],
      CONFIG_ROLE: ["0x7777777777777777777777777777777777777777"],
      RESOLVER_ROLE: [resolver],
      SETTLEMENT_ROLE: ["0x8888888888888888888888888888888888888888"],
      PAUSE_ROLE: [pauseAuthority],
    },
    registeredFixtureAddresses: [],
  };

  const decision: GateCDecisionRecord = {
    schemaVersion: 1,
    decision: "GO: isolated smoke",
    approvedBy: "founder:andy",
    approvedAt: "2026-07-31T12:00:00Z",
    candidateCommit,
    chainId: 84_532,
    protocolVersion: "base-v1-a1",
    contractAddress,
    libraryAddress,
    deploymentBlock: "12345",
    usdcAddress,
    slashPercentage: 25,
    restitutionRecipient,
    roleCustodyReference: "ops-record:role-custody-v1",
    securityAcceptanceReference: "review:testnet-risk-acceptance-v1",
    gateBReadbackReference: "evidence:gate-b-readback-v1",
    signingMethod: "hardware-backed role wallets",
    fallbackCranker: "0x9999999999999999999999999999999999999999",
    monitorOwner: "on-call:primary",
    incidentCommander: "on-call:founder",
    exposure: {
      policy: "isolated named fixtures only",
      capUsdcMicros: "80000000",
      authorBondUsdcMicros: "20000000",
      voucherStakeUsdcMicros: ["4000000", "6000000"],
      listingPriceUsdcMicros: "10000000",
      purchaseLane: "Direct",
    },
    fixtures: {
      author: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      upheldBuyer: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      rejectedBuyer: "0xcccccccccccccccccccccccccccccccccccccccc",
      expiryBuyer: "0xdddddddddddddddddddddddddddddddddddddddd",
      vouchers: [
        "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        "0xffffffffffffffffffffffffffffffffffffffff",
      ],
      resolver,
      pauseAuthority,
    },
  };

  it("turns an exact Gate-C record into a non-authorizing human-review plan", () => {
    const result = evaluateGateCDecision(decision, observed);

    expect(result.assessment).toBe("READY_FOR_HUMAN_REVIEW");
    expect(result.executionAuthorized).toBe(false);
    expect(result.blockers).toEqual([]);
    expect(result.writeModesEnabled).toBe(false);
    expect(result.plannedGrossFundingUsdcMicros).toBe("75000000");
    expect(result.transactionPlan).toHaveLength(31);
    expect(
      result.transactionPlan.every(
        (step) => step.publicNetworkTimeWarpAllowed === false
      )
    ).toBe(true);
    expect(result.transactionPlan.map((step) => step.id)).toEqual(
      expect.arrayContaining([
        "preflight-paused-deployment",
        "open-upheld-report",
        "replay-upheld-receipt",
        "slash-upheld-voucher-page-1",
        "slash-upheld-voucher-page-2",
        "open-rejected-report",
        "open-expiry-report",
        "premature-expiry-close",
        "close-expired-report",
        "final-repause-and-reconcile",
      ])
    );
    expect(
      result.transactionPlan.find((step) => step.id === "close-expired-report")
    ).toMatchObject({
      earliestExecution: "event:open-expiry-report.reviewDeadline",
      publicNetworkTimeWarpAllowed: false,
    });
  });

  it("keeps Gate C blocked when founder inputs drift from the paused deployment", () => {
    const result = evaluateGateCDecision(
      {
        ...decision,
        decision: "NO-GO",
        candidateCommit: "PENDING",
        slashPercentage: 50,
        restitutionRecipient: "0x0000000000000000000000000000000000000001",
        fallbackCranker: "PENDING",
        exposure: {
          ...decision.exposure,
          capUsdcMicros: "1",
          purchaseLane: "Settlement",
        },
        fixtures: {
          ...decision.fixtures,
          rejectedBuyer: decision.fixtures.upheldBuyer,
          vouchers: [decision.fixtures.vouchers[0]],
          resolver: pauseAuthority,
        },
      },
      { ...observed, paused: false }
    );

    expect(result.assessment).toBe("BLOCKED");
    expect(result.executionAuthorized).toBe(false);
    expect(result.writeModesEnabled).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "Founder decision is not GO: isolated smoke",
        "Candidate commit is not an exact 40-character Git SHA",
        "Candidate is not paused",
        "Slash percentage differs from the deployed config",
        "Restitution recipient differs from the deployed config",
        "At least two fresh voucher fixtures are required",
        "Fresh author, buyer, and voucher fixture addresses must be distinct",
        "Resolver fixture is not an observed RESOLVER_ROLE holder",
        "Fallback cranker is missing or pending",
        "Settlement-lane receipts are ineligible for Gate-C reports",
        "Planned gross fixture funding exceeds the approved exposure cap",
      ])
    );
  });

  it.each([
    ["chainContext", "eip155:8453"],
    ["minVouchStakeUsdcMicros", "999999"],
    ["reportBondUsdcMicros", "1"],
    ["minAuthorBondForFreeListingUsdcMicros", "1"],
    ["minPaidListingPriceUsdcMicros", "1"],
    ["authorShareBps", 5999],
    ["voucherShareBps", 3999],
    ["protocolFeeBps", 1],
    ["authorProceedsLockSeconds", "1"],
    ["refundClaimWindowSeconds", "1"],
    ["challengerRewardBps", 1],
    ["challengerRewardCapUsdcMicros", "1"],
    ["stakeWeightPerUsdc", 1],
    ["riskComponentCap", "1"],
    ["vouchWeight", 1],
    ["vouchComponentCap", "1"],
    ["longevityBonusPerDay", 1],
    ["longevityComponentCap", "1"],
    ["upheldDisputePenalty", "1"],
    ["reputationScoreCap", "1"],
  ] as const)("blocks drift in locked config field %s", (field, value) => {
    const result = evaluateGateCDecision(decision, {
      ...observed,
      [field]: value,
    });

    expect(result.assessment).toBe("BLOCKED");
    expect(
      result.blockers.some((blocker) => blocker.startsWith("Locked A1"))
    ).toBe(true);
  });

  it("blocks registered, role-bearing, or overlapping negative-test actors", () => {
    const result = evaluateGateCDecision(
      {
        ...decision,
        fallbackCranker: restitutionRecipient,
        fixtures: {
          ...decision.fixtures,
          resolver: pauseAuthority,
        },
      },
      {
        ...observed,
        registeredFixtureAddresses: [decision.fixtures.author],
        roleHolders: {
          ...observed.roleHolders,
          RESOLVER_ROLE: [pauseAuthority, decision.fixtures.upheldBuyer],
        },
      }
    );

    expect(result.assessment).toBe("BLOCKED");
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining("already registered"),
        expect.stringContaining("unexpectedly hold protocol roles"),
        "Fallback cranker must differ from the restitution recipient",
        "Resolver and pause authority fixtures must be distinct",
      ])
    );
  });

  it("blocks unknown purchase lanes instead of silently planning Direct", () => {
    const result = evaluateGateCDecision(
      {
        ...decision,
        exposure: {
          ...decision.exposure,
          purchaseLane:
            "Bogus" as GateCDecisionRecord["exposure"]["purchaseLane"],
        },
      },
      observed
    );

    expect(result.assessment).toBe("BLOCKED");
    expect(result.blockers).toContain(
      "Purchase lane must be Direct, Authorization, or Settlement"
    );
    expect(result.transactionPlan).toEqual([]);
  });
});
