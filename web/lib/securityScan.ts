export type SkillScanVerdict = "review" | "avoid";
export type SkillScanRisk = "low" | "medium" | "high";

export interface SkillScanFinding {
  severity: SkillScanRisk;
  category: string;
  detail: string;
  evidence: string;
  file: string;
}

export interface SkillSecurityScan {
  verdict: SkillScanVerdict;
  risk: SkillScanRisk | null;
  findings: SkillScanFinding[];
  truncated: boolean;
  scanned_at: string | null;
  model: string;
  rubric_version: string;
  scan_source: string;
  generated_by_model: boolean;
  advisory: true;
}

export interface SkillScanFieldRow {
  scan_verdict?: string | null;
  scan_risk?: string | null;
  scan_findings?: unknown;
  scan_truncated?: boolean | null;
  scan_scanned_at?: string | Date | null;
  scan_model?: string | null;
  scan_rubric_version?: string | null;
  scan_source?: string | null;
  scan_generated_by_model?: boolean | null;
}

function parseFindings(value: unknown): SkillScanFinding[] {
  const parsed =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return [];
          }
        })()
      : value;

  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const finding = item as Record<string, unknown>;
      const severity = finding.severity;
      if (severity !== "low" && severity !== "medium" && severity !== "high") {
        return null;
      }
      return {
        severity,
        category: String(finding.category ?? "unknown"),
        detail: String(finding.detail ?? ""),
        evidence: String(finding.evidence ?? ""),
        file: String(finding.file ?? "SKILL.md"),
      };
    })
    .filter((finding): finding is SkillScanFinding => Boolean(finding));
}

export function buildSecurityScanFromFields(
  row: SkillScanFieldRow
): SkillSecurityScan | null {
  if (row.scan_verdict !== "review" && row.scan_verdict !== "avoid") {
    return null;
  }
  const risk =
    row.scan_risk === "low" ||
    row.scan_risk === "medium" ||
    row.scan_risk === "high"
      ? row.scan_risk
      : null;
  return {
    verdict: row.scan_verdict,
    risk,
    findings: parseFindings(row.scan_findings),
    truncated: Boolean(row.scan_truncated),
    scanned_at: row.scan_scanned_at
      ? new Date(row.scan_scanned_at).toISOString()
      : null,
    model: row.scan_model ?? "unknown",
    rubric_version: row.scan_rubric_version ?? "unknown",
    scan_source: row.scan_source ?? "model",
    generated_by_model: row.scan_generated_by_model ?? true,
    advisory: true,
  };
}
