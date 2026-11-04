// Deterministic static checks over a full skill tree (evidence layer L0 in
// .agents/plans/skill-evals-and-packages.plan.md).
//
// The checks read every file, so they also cover the part of a large tree that
// the AI scan truncates. They are cheap and need no model. Results are cached by
// (tree_hash, checks_version) and feed a display-only trust signal: they can
// warn, but they never change recommended_action.
//
// Findings never contain file content: no excerpts and no secret values, only
// the rule, the file, the first line, and a count. Paid skills keep their
// content private before purchase. The URL inventory keeps host names only.

import { parseFrontmatterFields } from "@/lib/mirror/github";

/** Bump this when a rule changes, so cached reports are recomputed. */
export const STATIC_CHECKS_VERSION = "static-v1";

export type StaticCheckSeverity = "info" | "low" | "medium";

export type StaticCheckRule =
  | "frontmatter"
  | "hidden_unicode"
  | "remote_exec"
  | "secret"
  | "archive";

export interface StaticCheckFinding {
  rule: StaticCheckRule;
  severity: StaticCheckSeverity;
  path: string;
  /** 1-based line of the first match; null for a whole-file finding. */
  line: number | null;
  /** How many matches of this kind the file has. */
  count: number;
  /** Plain-language explanation. Never contains file content. */
  detail: string;
}

export interface StaticCheckReport {
  version: string;
  /** Most severe first; at most MAX_STATIC_CHECK_FINDINGS. */
  findings: StaticCheckFinding[];
  /** Number of findings before the cap. */
  totalFindings: number;
  /** Distinct host names of http(s) URLs in text files, sorted. */
  hosts: string[];
  /** Number of files read as UTF-8 text. */
  textFiles: number;
  /** Files that are not UTF-8 text. Only the archive check reads them. */
  binaryFiles: string[];
}

export interface StaticCheckFile {
  path: string;
  bytes: Uint8Array;
}

export const MAX_STATIC_CHECK_FINDINGS = 50;
const MAX_HOSTS = 50;

const SEVERITY_ORDER: Record<StaticCheckSeverity, number> = {
  medium: 0,
  low: 1,
  info: 2,
};

// ---------------------------------------------------------------------------
// Text decoding

// The decoder drops one leading byte order mark, so a file may start with it.
// Any other U+FEFF stays in the text and counts as a hidden character.
const utf8 = new TextDecoder("utf-8", { fatal: true });

function decodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return utf8.decode(bytes);
  } catch {
    return null;
  }
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Rule: Agent Skills frontmatter (https://agentskills.io/specification and the
// reference validator in agentskills/agentskills skills-ref, checked 2026-11-04)

const ALLOWED_FRONTMATTER_FIELDS = new Set([
  "name",
  "description",
  "license",
  "allowed-tools",
  "metadata",
  "compatibility",
]);
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_COMPATIBILITY_LENGTH = 500;

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function nameProblems(rawName: string): string[] {
  const name = rawName.normalize("NFKC");
  const problems: string[] = [];
  if (codePointLength(name) > MAX_NAME_LENGTH) {
    problems.push(`is longer than ${MAX_NAME_LENGTH} characters`);
  }
  if (name !== name.toLowerCase()) problems.push("must be lowercase");
  if (name.startsWith("-") || name.endsWith("-")) {
    problems.push("cannot start or end with a hyphen");
  }
  if (name.includes("--")) problems.push("cannot contain two hyphens in a row");
  if (!/^[\p{L}\p{N}-]+$/u.test(name)) {
    problems.push("may contain only letters, digits, and hyphens");
  }
  return problems;
}

function checkFrontmatter(path: string, text: string): StaticCheckFinding[] {
  const finding = (
    severity: StaticCheckSeverity,
    detail: string
  ): StaticCheckFinding => ({
    rule: "frontmatter",
    severity,
    path,
    line: 1,
    count: 1,
    detail,
  });

  const fields = parseFrontmatterFields(text);
  if (!fields) {
    return [
      finding(
        "low",
        "SKILL.md has no YAML frontmatter. Agent Skills clients read `name` and `description` from it to find the skill."
      ),
    ];
  }

  const findings: StaticCheckFinding[] = [];
  const name = fields.name ?? "";
  if (!name.trim()) {
    findings.push(finding("low", "The frontmatter has no `name`."));
  } else {
    const problems = nameProblems(name.trim());
    if (problems.length > 0) {
      findings.push(
        finding(
          "low",
          `The frontmatter \`name\` breaks the Agent Skills rules: it ${problems.join(
            "; it "
          )}.`
        )
      );
    }
  }

  const description = fields.description ?? "";
  if (!description.trim()) {
    findings.push(finding("low", "The frontmatter has no `description`."));
  } else if (codePointLength(description) > MAX_DESCRIPTION_LENGTH) {
    findings.push(
      finding(
        "low",
        `The frontmatter \`description\` is longer than ${MAX_DESCRIPTION_LENGTH} characters.`
      )
    );
  }

  if (
    fields.compatibility !== undefined &&
    codePointLength(fields.compatibility) > MAX_COMPATIBILITY_LENGTH
  ) {
    findings.push(
      finding(
        "low",
        `The frontmatter \`compatibility\` is longer than ${MAX_COMPATIBILITY_LENGTH} characters.`
      )
    );
  }

  const extra = Object.keys(fields)
    .filter((key) => !ALLOWED_FRONTMATTER_FIELDS.has(key))
    .sort();
  if (extra.length > 0) {
    findings.push(
      finding(
        "info",
        `The frontmatter has fields outside the Agent Skills spec (${extra.join(
          ", "
        )}). Most clients ignore them.`
      )
    );
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule: hidden Unicode

type HiddenKind = "bidi" | "zero_width" | "tag" | "variation_run";

const BIDI_CONTROLS = new Set([
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
]);
// Invisible characters with no normal use inside text.
const ZERO_WIDTH = new Set([
  0x200b, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0x180e, 0xfeff,
]);
// Joiners have real uses in emoji sequences and in scripts such as Persian and
// Hindi. They are flagged only between two ASCII characters.
const JOINERS = new Set([0x200c, 0x200d]);
const BLACK_FLAG = 0x1f3f4;
const CANCEL_TAG = 0xe007f;

const isTag = (cp: number) => cp >= 0xe0000 && cp <= 0xe007f;
// Tag digits and lowercase tag letters, as used in subdivision flags.
const isFlagTag = (cp: number) =>
  (cp >= 0xe0030 && cp <= 0xe0039) || (cp >= 0xe0061 && cp <= 0xe007a);
const isVariationSelector = (cp: number) =>
  (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);
const isAscii = (cp: number | undefined) =>
  cp !== undefined && cp >= 0x20 && cp < 0x7f;

const HIDDEN_DETAIL: Record<HiddenKind, (count: number) => string> = {
  bidi: (count) =>
    `Has ${plural(
      count,
      "bidirectional control character"
    )}. They can make text or code read differently from what it does.`,
  zero_width: (count) =>
    `Has ${plural(
      count,
      "invisible zero-width character"
    )}. They can hide text from a person who reads the file.`,
  tag: (count) =>
    `Has ${plural(
      count,
      "run"
    )} of invisible Unicode tag characters. They can carry hidden instructions.`,
  variation_run: (count) =>
    `Has ${plural(
      count,
      "run"
    )} of stacked variation selectors. They can carry hidden data.`,
};

function checkHiddenUnicode(path: string, text: string): StaticCheckFinding[] {
  const codePoints = Array.from(text, (char) => char.codePointAt(0) ?? 0);
  const seen = new Map<HiddenKind, { count: number; line: number }>();
  const record = (kind: HiddenKind, line: number) => {
    const entry = seen.get(kind);
    if (entry) entry.count += 1;
    else seen.set(kind, { count: 1, line });
  };

  let line = 1;
  for (let index = 0; index < codePoints.length; index += 1) {
    const cp = codePoints[index];
    if (cp === 10) {
      line += 1;
      continue;
    }
    if (BIDI_CONTROLS.has(cp)) {
      record("bidi", line);
    } else if (ZERO_WIDTH.has(cp)) {
      record("zero_width", line);
    } else if (JOINERS.has(cp)) {
      if (isAscii(codePoints[index - 1]) && isAscii(codePoints[index + 1])) {
        record("zero_width", line);
      }
    } else if (isTag(cp)) {
      let end = index;
      while (end + 1 < codePoints.length && isTag(codePoints[end + 1])) {
        end += 1;
      }
      // Emoji subdivision flags (for example Scotland) are U+1F3F4, 3 to 6 tag
      // letters or digits (an ISO 3166-2 code), then CANCEL TAG. A longer run
      // is hidden text, even after a flag.
      const codeLength = end - index;
      const isFlag =
        codePoints[index - 1] === BLACK_FLAG &&
        codePoints[end] === CANCEL_TAG &&
        codeLength >= 3 &&
        codeLength <= 6 &&
        codePoints.slice(index, end).every(isFlagTag);
      if (!isFlag) record("tag", line);
      index = end;
    } else if (isVariationSelector(cp)) {
      let end = index;
      while (
        end + 1 < codePoints.length &&
        isVariationSelector(codePoints[end + 1])
      ) {
        end += 1;
      }
      // One selector after a character is normal (for example ❤️).
      if (end > index) record("variation_run", line);
      index = end;
    }
  }

  return [...seen.entries()].map(([kind, entry]) => ({
    rule: "hidden_unicode",
    severity: "medium",
    path,
    line: entry.line,
    count: entry.count,
    detail: HIDDEN_DETAIL[kind](entry.count),
  }));
}

// ---------------------------------------------------------------------------
// Rule: download-and-run steps

const SHELL = "(?:ba|z|da|k|c|tc|fi)?sh";
const INTERPRETER = "(?:python[0-9.]*|perl|ruby|node|php)";
const FETCH = "(?:curl|wget)";
const SUDO = "(?:sudo\\s+(?:-\\S+\\s+)*)?";
// One pipe, not the `||` "or" operator.
const PIPE = "(?<!\\|)\\|(?!\\|)";

const REMOTE_EXEC_PATTERNS: RegExp[] = [
  // curl … | sh, wget -qO- … | sudo bash, curl … | python3 -
  new RegExp(
    `\\b${FETCH}\\b[^\\n]*?${PIPE}\\s*${SUDO}(?:env\\s+)?(?:${SHELL}|${INTERPRETER})\\b`,
    "i"
  ),
  // bash <(curl …), source <(curl …)
  new RegExp(`(?:\\b${SHELL}|\\bsource)\\s+<\\(\\s*${FETCH}\\b`, "i"),
  // sh -c "$(curl …)", eval "$(wget -O- …)"
  new RegExp(
    `(?:\\b${SHELL}\\s+-c|\\beval)\\s+["']?\\$\\(\\s*${FETCH}\\b`,
    "i"
  ),
  // PowerShell: iwr … | iex, irm … | Invoke-Expression (curl and wget are
  // PowerShell aliases of Invoke-WebRequest)
  new RegExp(
    `\\b(?:iwr|irm|invoke-webrequest|invoke-restmethod|curl|wget)\\b[^\\n]*?${PIPE}\\s*(?:iex|invoke-expression)\\b`,
    "i"
  ),
  // iex (New-Object Net.WebClient).DownloadString(…), iex (irm …)
  /\b(?:iex|invoke-expression)\b\s*\(\s*\(?\s*(?:new-object\s+(?:system\.)?net\.webclient|iwr\b|irm\b|invoke-webrequest|invoke-restmethod)/i,
];

function checkRemoteExec(path: string, text: string): StaticCheckFinding[] {
  let count = 0;
  let firstLine = 0;
  text.split("\n").forEach((lineText, index) => {
    if (REMOTE_EXEC_PATTERNS.some((pattern) => pattern.test(lineText))) {
      count += 1;
      if (!firstLine) firstLine = index + 1;
    }
  });
  if (count === 0) return [];
  return [
    {
      rule: "remote_exec",
      severity: "medium",
      path,
      line: firstLine,
      count,
      detail: `Has ${plural(
        count,
        "line"
      )} that download a script and run it at once (such as \`curl … | sh\`). Check each source before an agent runs it.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Rule: secrets

const SECRET_PATTERNS: Array<{ kind: string; pattern: RegExp }> = [
  {
    // The header alone is often used in docs, so require key data after it.
    kind: "private key",
    pattern:
      /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----\s*(?:[A-Za-z0-9+/=]{40,}|Proc-Type:|Version:|Comment:)/g,
  },
  { kind: "AWS access key ID", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  { kind: "GitHub token", pattern: /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/g },
  { kind: "Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: "Stripe live key", pattern: /\b[rs]k_live_[A-Za-z0-9]{16,}\b/g },
  { kind: "Anthropic API key", pattern: /\bsk-ant-[A-Za-z0-9_-]{32,}/g },
  {
    kind: "OpenAI API key",
    pattern: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g,
  },
  {
    kind: "Google API key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g,
  },
  {
    kind: "64-byte secret key array (Solana keypair format)",
    pattern: /\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/g,
  },
];

function isPlaceholder(value: string): boolean {
  if (
    /example|placeholder|dummy|redacted|your[_-]?(?:api[_-]?)?key/i.test(value)
  ) {
    return true;
  }
  if (/(?:x{6,}|X{6,}|\*{4,}|0{12,})/.test(value)) return true;
  // A byte array of one repeated value is a placeholder, not a key.
  if (value.startsWith("[")) {
    return new Set(value.match(/\d+/g) ?? []).size <= 1;
  }
  return false;
}

function checkSecrets(path: string, text: string): StaticCheckFinding[] {
  const byKind = new Map<string, { count: number; line: number }>();
  for (const { kind, pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (isPlaceholder(match[0])) continue;
      const entry = byKind.get(kind);
      if (entry) entry.count += 1;
      else byKind.set(kind, { count: 1, line: lineAt(text, match.index ?? 0) });
    }
  }
  return [...byKind.entries()].map(([kind, entry]) => ({
    rule: "secret",
    severity: "medium",
    path,
    line: entry.line,
    count: entry.count,
    detail: `Has ${
      entry.count === 1 ? "a value" : `${entry.count} values`
    } that look${
      entry.count === 1 ? "s" : ""
    } like a ${kind}. The value is not shown. Remove real secrets from the skill and rotate them.`,
  }));
}

// ---------------------------------------------------------------------------
// Rule: archives

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04];
const OTHER_ARCHIVES: Array<{ signature: number[]; offset?: number }> = [
  { signature: [0x50, 0x4b, 0x05, 0x06] }, // empty zip
  { signature: [0x1f, 0x8b] }, // gzip
  { signature: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] }, // 7z
  { signature: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07] }, // rar
  { signature: [0x42, 0x5a, 0x68] }, // bzip2
  { signature: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00] }, // xz
  { signature: [0x75, 0x73, 0x74, 0x61, 0x72], offset: 257 }, // tar (ustar)
];

/** True when any zip entry has the "encrypted" flag (general purpose bit 0). */
function zipHasEncryptedEntry(bytes: Uint8Array): boolean {
  for (let offset = 0; offset + 8 <= bytes.length; offset += 1) {
    if (
      startsWith(bytes, ZIP_LOCAL_HEADER, offset) &&
      (bytes[offset + 6] & 0x01) === 0x01
    ) {
      return true;
    }
  }
  return false;
}

function checkArchive(path: string, bytes: Uint8Array): StaticCheckFinding[] {
  const whole = (
    severity: StaticCheckSeverity,
    detail: string
  ): StaticCheckFinding[] => [
    { rule: "archive", severity, path, line: null, count: 1, detail },
  ];
  if (startsWith(bytes, ZIP_LOCAL_HEADER)) {
    return zipHasEncryptedEntry(bytes)
      ? whole(
          "medium",
          "Is a password-protected archive. Its files cannot be checked."
        )
      : whole("info", "Is an archive. Static checks do not look inside it.");
  }
  if (
    OTHER_ARCHIVES.some(({ signature, offset }) =>
      startsWith(bytes, signature, offset ?? 0)
    )
  ) {
    return whole("info", "Is an archive. Static checks do not look inside it.");
  }
  return [];
}

// ---------------------------------------------------------------------------
// URL inventory (host names only)

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`)\]]+/gi;

function collectHosts(text: string, hosts: Set<string>) {
  for (const match of text.matchAll(URL_PATTERN)) {
    try {
      const host = new URL(match[0]).hostname.toLowerCase();
      if (host) hosts.add(host);
    } catch {
      // Not a valid URL; skip it.
    }
  }
}

// ---------------------------------------------------------------------------

function compareFindings(a: StaticCheckFinding, b: StaticCheckFinding) {
  return (
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
    (a.line ?? 0) - (b.line ?? 0) ||
    (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0)
  );
}

export function runStaticChecks(
  files: ReadonlyArray<StaticCheckFile>
): StaticCheckReport {
  const findings: StaticCheckFinding[] = [];
  const hosts = new Set<string>();
  const binaryFiles: string[] = [];
  let textFiles = 0;

  for (const file of files) {
    const text = decodeText(file.bytes);
    if (text === null) {
      // Only files that are not text get the archive check. Text that starts
      // with archive-like bytes still gets every text check.
      binaryFiles.push(file.path);
      findings.push(...checkArchive(file.path, file.bytes));
      continue;
    }
    textFiles += 1;
    if (file.path === "SKILL.md") {
      findings.push(...checkFrontmatter(file.path, text));
    }
    findings.push(
      ...checkHiddenUnicode(file.path, text),
      ...checkRemoteExec(file.path, text),
      ...checkSecrets(file.path, text)
    );
    collectHosts(text, hosts);
  }

  findings.sort(compareFindings);
  return {
    version: STATIC_CHECKS_VERSION,
    findings: findings.slice(0, MAX_STATIC_CHECK_FINDINGS),
    totalFindings: findings.length,
    hosts: [...hosts].sort().slice(0, MAX_HOSTS),
    textFiles,
    binaryFiles: binaryFiles.sort(),
  };
}

export function countFindingsBySeverity(
  report: StaticCheckReport
): Record<StaticCheckSeverity, number> {
  const counts: Record<StaticCheckSeverity, number> = {
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const finding of report.findings) counts[finding.severity] += 1;
  return counts;
}

function isFinding(value: unknown): value is StaticCheckFinding {
  if (!value || typeof value !== "object") return false;
  const finding = value as Record<string, unknown>;
  return (
    typeof finding.rule === "string" &&
    (finding.severity === "info" ||
      finding.severity === "low" ||
      finding.severity === "medium") &&
    typeof finding.path === "string" &&
    (finding.line === null || typeof finding.line === "number") &&
    typeof finding.count === "number" &&
    typeof finding.detail === "string"
  );
}

/** Read a stored report (JSONB). Returns null for a malformed value. */
export function parseStaticCheckReport(
  value: unknown
): StaticCheckReport | null {
  const parsed =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return null;
          }
        })()
      : value;
  if (!parsed || typeof parsed !== "object") return null;
  const report = parsed as Record<string, unknown>;
  if (
    typeof report.version !== "string" ||
    !Array.isArray(report.findings) ||
    !report.findings.every(isFinding) ||
    typeof report.totalFindings !== "number" ||
    !Array.isArray(report.hosts) ||
    typeof report.textFiles !== "number" ||
    !Array.isArray(report.binaryFiles)
  ) {
    return null;
  }
  return report as unknown as StaticCheckReport;
}
