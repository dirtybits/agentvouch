import { describe, expect, it } from "vitest";
import type { AuthorTrust } from "@/lib/trust";
import type { SkillSecurityScan } from "@/lib/securityScan";
import {
  buildTrustSignals,
  fuseActions,
  recommendedActionFromSignals,
  type OpenWorldAction,
  type TrustSignalId,
  type TrustSignalStatus,
} from "@/lib/trustSignals";

function trust(overrides: Partial<AuthorTrust> = {}): AuthorTrust {
  return {
    reputationScore: 0,
    totalVouchesReceived: 0,
    totalStakedFor: 0,
    authorBondUsdcMicros: 0,
    totalStakeAtRisk: 0,
    disputesAgainstAuthor: 0,
    disputesUpheldAgainstAuthor: 0,
    activeDisputesAgainstAuthor: 0,
    registeredAt: 0,
    isRegistered: true,
    ...overrides,
  };
}

function scan(overrides: Partial<SkillSecurityScan> = {}): SkillSecurityScan {
  return {
    verdict: "review",
    risk: "low",
    findings: [],
    truncated: false,
    scanned_at: "2026-05-30T00:00:00.000Z",
    model: "google/gemini-2.0-flash-lite",
    rubric_version: "v1",
    scan_source: "model",
    generated_by_model: true,
    advisory: true,
    ...overrides,
  };
}

function statusOf(
  signals: ReturnType<typeof buildTrustSignals>,
  id: TrustSignalId
): TrustSignalStatus | undefined {
  return signals.find((s) => s.id === id)?.status;
}

describe("buildTrustSignals", () => {
  it("reports everything unknown with no author and no scan", () => {
    const signals = buildTrustSignals({ trust: null, scan: null });
    for (const id of [
      "ai_scan",
      "registered",
      "vouched",
      "author_bonded",
      "dispute_free",
    ] as TrustSignalId[]) {
      expect(statusOf(signals, id)).toBe("unknown");
    }
  });

  it("passes a fully-trusted, cleanly-scanned skill", () => {
    const signals = buildTrustSignals({
      trust: trust({
        totalStakedFor: 1_000_000,
        authorBondUsdcMicros: 25_000_000,
      }),
      scan: scan(),
    });
    expect(statusOf(signals, "ai_scan")).toBe("pass");
    expect(statusOf(signals, "vouched")).toBe("pass");
    expect(statusOf(signals, "author_bonded")).toBe("pass");
    expect(statusOf(signals, "registered")).toBe("pass");
    expect(statusOf(signals, "dispute_free")).toBe("pass");
  });

  it("warns (not fails) when a scan has findings or is truncated", () => {
    expect(
      statusOf(
        buildTrustSignals({ trust: null, scan: scan({ truncated: true }) }),
        "ai_scan"
      )
    ).toBe("warn");
    expect(
      statusOf(
        buildTrustSignals({
          trust: null,
          scan: scan({
            findings: [
              {
                severity: "low",
                category: "scope",
                detail: "d",
                evidence: "e",
                file: "SKILL.md",
              },
            ],
          }),
        }),
        "ai_scan"
      )
    ).toBe("warn");
  });

  it("fails the scan signal on an avoid verdict", () => {
    expect(
      statusOf(
        buildTrustSignals({ trust: null, scan: scan({ verdict: "avoid" }) }),
        "ai_scan"
      )
    ).toBe("fail");
  });

  it("marks unregistered authors as review-worthy, not failed", () => {
    const signals = buildTrustSignals({
      trust: trust({ isRegistered: false }),
      scan: scan(),
    });
    expect(statusOf(signals, "registered")).toBe("warn");
    expect(statusOf(signals, "vouched")).toBe("unknown");
    expect(statusOf(signals, "author_bonded")).toBe("unknown");
    expect(statusOf(signals, "dispute_free")).toBe("unknown");
  });

  it("warns instead of failing when registered authors lack vouch stake or self-bond", () => {
    const signals = buildTrustSignals({
      trust: trust({ totalStakedFor: 0, authorBondUsdcMicros: 0 }),
      scan: scan(),
    });

    expect(statusOf(signals, "registered")).toBe("pass");
    expect(statusOf(signals, "vouched")).toBe("warn");
    expect(statusOf(signals, "author_bonded")).toBe("warn");
    expect(recommendedActionFromSignals(signals)).toBe("review");
  });

  it("warns on active disputes and fails on upheld disputes", () => {
    expect(
      statusOf(
        buildTrustSignals({
          trust: trust({ activeDisputesAgainstAuthor: 1 }),
          scan: null,
        }),
        "dispute_free"
      )
    ).toBe("warn");
    expect(
      statusOf(
        buildTrustSignals({
          trust: trust({ disputesUpheldAgainstAuthor: 1 }),
          scan: null,
        }),
        "dispute_free"
      )
    ).toBe("fail");
  });
});

describe("recommendedActionFromSignals", () => {
  const cases: Array<{
    name: string;
    trust: AuthorTrust | null;
    scan: SkillSecurityScan | null;
    expected: OpenWorldAction;
  }> = [
    {
      name: "fully staked + clean scan -> allow",
      trust: trust({ totalStakedFor: 1_000_000 }),
      scan: scan(),
      expected: "allow",
    },
    {
      name: "fully staked but avoid scan -> avoid",
      trust: trust({ totalStakedFor: 1_000_000 }),
      scan: scan({ verdict: "avoid" }),
      expected: "avoid",
    },
    {
      name: "staked + scan with findings still allow (advisory review does not cap)",
      trust: trust({ totalStakedFor: 1_000_000 }),
      scan: scan({
        findings: [
          {
            severity: "low",
            category: "scope",
            detail: "d",
            evidence: "e",
            file: "SKILL.md",
          },
        ],
      }),
      expected: "allow",
    },
    {
      name: "registered, no stake -> review",
      trust: trust({ totalStakedFor: 0 }),
      scan: scan(),
      expected: "review",
    },
    {
      name: "upheld dispute -> avoid",
      trust: trust({
        totalStakedFor: 1_000_000,
        disputesUpheldAgainstAuthor: 1,
      }),
      scan: scan(),
      expected: "avoid",
    },
    {
      name: "active dispute -> review",
      trust: trust({
        totalStakedFor: 1_000_000,
        activeDisputesAgainstAuthor: 1,
      }),
      scan: scan(),
      expected: "review",
    },
    {
      name: "unregistered author + clean scan -> review (scan ran, no on-chain basis)",
      trust: trust({ isRegistered: false }),
      scan: scan(),
      expected: "review",
    },
    {
      name: "no author + no scan -> unknown",
      trust: null,
      scan: null,
      expected: "unknown",
    },
    {
      name: "no author + avoid scan -> avoid",
      trust: null,
      scan: scan({ verdict: "avoid" }),
      expected: "avoid",
    },
  ];

  it.each(cases)("$name", ({ trust: t, scan: s, expected }) => {
    expect(
      recommendedActionFromSignals(buildTrustSignals({ trust: t, scan: s }))
    ).toBe(expected);
  });

  it("never emits allow without a registered, staked, dispute-free author", () => {
    const noStake = buildTrustSignals({
      trust: trust({ totalStakedFor: 0 }),
      scan: scan(),
    });
    const unregistered = buildTrustSignals({
      trust: trust({ isRegistered: false }),
      scan: scan(),
    });
    expect(recommendedActionFromSignals(noStake)).not.toBe("allow");
    expect(recommendedActionFromSignals(unregistered)).not.toBe("allow");
  });
});

describe("fuseActions", () => {
  const cases: Array<{
    staked: OpenWorldAction;
    scan: OpenWorldAction;
    expected: OpenWorldAction;
  }> = [
    { staked: "allow", scan: "review", expected: "allow" },
    { staked: "allow", scan: "unknown", expected: "allow" },
    { staked: "allow", scan: "avoid", expected: "avoid" },
    { staked: "review", scan: "review", expected: "review" },
    { staked: "review", scan: "unknown", expected: "review" },
    { staked: "review", scan: "avoid", expected: "avoid" },
    { staked: "avoid", scan: "review", expected: "avoid" },
    { staked: "avoid", scan: "unknown", expected: "avoid" },
    { staked: "unknown", scan: "review", expected: "review" },
    { staked: "unknown", scan: "avoid", expected: "avoid" },
    { staked: "unknown", scan: "unknown", expected: "unknown" },
    { staked: "unknown", scan: "allow", expected: "unknown" },
  ];

  it.each(cases)(
    "staked=$staked + scan=$scan -> $expected",
    ({ staked, scan, expected }) => {
      expect(fuseActions({ staked, scan })).toBe(expected);
    }
  );
});
