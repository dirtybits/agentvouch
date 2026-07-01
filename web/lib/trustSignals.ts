import type { AuthorTrust } from "@/lib/trust";
import type { SkillSecurityScan } from "@/lib/securityScan";

export type OpenWorldAction = "allow" | "review" | "avoid" | "unknown";

export type TrustSignalStatus = "pass" | "warn" | "fail" | "unknown";
export type TrustSignalScope = "skill" | "author";
export type TrustSignalId =
  | "ai_scan"
  | "vouched"
  | "author_bonded"
  | "registered"
  | "dispute_free";

export interface TrustSignal {
  id: TrustSignalId;
  label: string;
  scope: TrustSignalScope;
  status: TrustSignalStatus;
  detail: string;
}

// Fuse staked on-chain trust with the advisory scan into one rollup action.
// (Relocated from /api/check so it can serve as the shared derivation engine.)
//   - A concrete `avoid` from either side always wins.
//   - With no on-chain basis (`staked === "unknown"`), defer to the scan.
//   - Otherwise staked trust stands: an advisory `review`/`unknown` scan never
//     lowers it (only staked trust can grant `allow`; the scan never does).
export function fuseActions(input: {
  staked: OpenWorldAction;
  scan: OpenWorldAction;
}): OpenWorldAction {
  if (input.staked === "avoid" || input.scan === "avoid") return "avoid";
  if (input.staked === "unknown") {
    return input.scan === "review" ? "review" : "unknown";
  }
  return input.staked;
}

function aiScanSignal(scan: SkillSecurityScan | null): TrustSignal {
  const base = {
    id: "ai_scan" as const,
    label: "AI security scan",
    scope: "skill" as const,
  };
  if (!scan) {
    return {
      ...base,
      status: "unknown",
      detail: "No automated scan on record for this skill tree.",
    };
  }
  if (scan.verdict === "avoid") {
    return {
      ...base,
      status: "fail",
      detail: "Advisory scan flagged concrete risk (avoid).",
    };
  }
  if (scan.truncated) {
    return {
      ...base,
      status: "warn",
      detail: "Advisory scan completed with truncation; review the full tree.",
    };
  }
  if (scan.findings.length > 0) {
    return {
      ...base,
      status: "warn",
      detail: `Advisory scan completed with ${scan.findings.length} finding(s) to review.`,
    };
  }
  return {
    ...base,
    status: "pass",
    detail: "Advisory scan completed with no concrete findings.",
  };
}

// Author-scoped signals require an on-chain profile to be meaningful. Without a
// registered author there is no record to read, so they report `unknown` rather
// than a misleading `fail` (absence of data is not evidence of bad standing).
//
// Status discipline across every signal: `fail` is reserved for active adverse
// evidence — a scan that flagged concrete risk, or an upheld dispute. The
// absence of a positive signal (no on-chain identity, no vouch stake, no
// self-bond) is `warn`: something to weigh before installing, not a failed
// check. A brand-new honest skill should never read the same red as one whose
// author lost a dispute.
function authorSignals(trust: AuthorTrust | null): TrustSignal[] {
  const registered: TrustSignal = {
    id: "registered",
    label: "On-chain identity",
    scope: "author",
    status: !trust ? "unknown" : trust.isRegistered ? "pass" : "warn",
    detail: !trust
      ? "No author wallet supplied."
      : trust.isRegistered
      ? "Author is registered on-chain."
      : "Author has no on-chain agent profile.",
  };

  if (!trust || !trust.isRegistered) {
    const unknownDetail = "Requires an on-chain author profile.";
    return [
      registered,
      {
        id: "vouched",
        label: "Vouched by others",
        scope: "author",
        status: "unknown",
        detail: unknownDetail,
      },
      {
        id: "author_bonded",
        label: "Author bond",
        scope: "author",
        status: "unknown",
        detail: unknownDetail,
      },
      {
        id: "dispute_free",
        label: "Dispute history",
        scope: "author",
        status: "unknown",
        detail: unknownDetail,
      },
    ];
  }

  const vouched: TrustSignal = {
    id: "vouched",
    label: "Vouched by others",
    scope: "author",
    status: trust.totalStakedFor > 0 ? "pass" : "warn",
    detail:
      trust.totalStakedFor > 0
        ? "Other accounts have staked USDC vouching for this author."
        : "No external vouch stake yet.",
  };

  const authorBonded: TrustSignal = {
    id: "author_bonded",
    label: "Author bond",
    scope: "author",
    status: trust.authorBondUsdcMicros > 0 ? "pass" : "warn",
    detail:
      trust.authorBondUsdcMicros > 0
        ? "Author posted a USDC self-bond (skin in the game)."
        : "Author has not posted a self-bond.",
  };

  const disputeFree: TrustSignal = {
    id: "dispute_free",
    label: "Dispute history",
    scope: "author",
    status:
      trust.disputesUpheldAgainstAuthor > 0
        ? "fail"
        : trust.activeDisputesAgainstAuthor > 0
        ? "warn"
        : "pass",
    detail:
      trust.disputesUpheldAgainstAuthor > 0
        ? `${trust.disputesUpheldAgainstAuthor} dispute(s) upheld against this author.`
        : trust.activeDisputesAgainstAuthor > 0
        ? `${trust.activeDisputesAgainstAuthor} active dispute(s) pending against this author.`
        : "No disputes against this author.",
  };

  return [registered, vouched, authorBonded, disputeFree];
}

// The transparent checklist: discrete trust signals an agent (or person) can
// evaluate against its own policy, instead of an opaque single verdict.
export function buildTrustSignals(input: {
  trust: AuthorTrust | null;
  scan: SkillSecurityScan | null;
}): TrustSignal[] {
  return [aiScanSignal(input.scan), ...authorSignals(input.trust)];
}

function signalById(
  signals: TrustSignal[],
  id: TrustSignalId
): TrustSignal | undefined {
  return signals.find((signal) => signal.id === id);
}

// Convenience rollup, DERIVED from the checklist so the one-line verdict and the
// signals can never drift. Equivalent to the prior staked-vs-scan fusion.
export function recommendedActionFromSignals(
  signals: TrustSignal[]
): OpenWorldAction {
  const aiScan = signalById(signals, "ai_scan")?.status ?? "unknown";
  const registered = signalById(signals, "registered")?.status ?? "unknown";
  const disputeFree = signalById(signals, "dispute_free")?.status ?? "unknown";
  const vouched = signalById(signals, "vouched")?.status ?? "unknown";

  const scanAction: OpenWorldAction =
    aiScan === "fail" ? "avoid" : aiScan === "unknown" ? "unknown" : "review";

  let stakedAction: OpenWorldAction;
  if (registered !== "pass") {
    stakedAction = "unknown"; // no on-chain basis to grant trust
  } else if (disputeFree === "fail") {
    stakedAction = "avoid";
  } else if (disputeFree === "warn" || vouched !== "pass") {
    stakedAction = "review";
  } else {
    stakedAction = "allow";
  }

  return fuseActions({ staked: stakedAction, scan: scanAction });
}
