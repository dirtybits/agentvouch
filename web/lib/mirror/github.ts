// GitHub fetch + skill discovery + license classification for the mirror engine.
// Uses the git/trees API once per repo (cheap, optionally authenticated via
// GITHUB_TOKEN) for the file list, then raw.githubusercontent.com for content
// (CDN-served, unauthenticated, no API rate limit). Works in both Node scripts
// and the Vercel Function runtime.

import path from "path";
import type { SkillTreeInputFile } from "@/lib/skillStorage";
import type { MirrorSource } from "@/lib/mirror/sources";

const USER_AGENT = "agentvouch-mirror";

export type RepoTreeEntry = {
  path: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
};

export type DiscoveredSkill = {
  skillId: string;
  /** Repo-relative directory containing SKILL.md. */
  dir: string;
  /** Repo-relative paths of every file under the skill directory. */
  filePaths: string[];
};

export type LicenseClassification = {
  /** SPDX-ish tag when recognized, else null. */
  tag: string | null;
  /** True only for recognized permissive open-source licenses. */
  permissive: boolean;
  /** The matched license filename (for diagnostics), if any. */
  file: string | null;
};

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": USER_AGENT,
  };
  const token =
    process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_PAT;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function fetchRepoTree(
  source: MirrorSource
): Promise<RepoTreeEntry[]> {
  const url = `https://api.github.com/repos/${source.owner}/${source.repo}/git/trees/${source.branch}?recursive=1`;
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) {
    throw new Error(
      `GitHub tree fetch failed for ${source.owner}/${source.repo}@${source.branch}: ${res.status} ${res.statusText}`
    );
  }
  const body = (await res.json()) as {
    tree?: RepoTreeEntry[];
    truncated?: boolean;
  };
  if (body.truncated) {
    console.warn(
      `[mirror] tree for ${source.owner}/${source.repo} is truncated; some skills may be missed`
    );
  }
  return body.tree ?? [];
}

export function discoverSkills(
  tree: RepoTreeEntry[],
  source: MirrorSource
): DiscoveredSkill[] {
  const dirs: DiscoveredSkill[] = [];
  const blobs = tree.filter((e) => e.type === "blob");
  for (const entry of blobs) {
    if (!entry.path.endsWith("/SKILL.md")) continue;
    const dir = entry.path.slice(0, -"/SKILL.md".length);
    if (!source.includePathPrefixes.some((p) => dir.startsWith(p))) {
      continue;
    }
    // Trailing slash so e.g. `skills/figma/` does not capture `skills/figma-use/`.
    const filePaths = blobs
      .filter((b) => b.path.startsWith(`${dir}/`))
      .map((b) => b.path);
    dirs.push({ skillId: path.posix.basename(dir), dir, filePaths });
  }
  // Stable order for deterministic logs/runs.
  return dirs.sort((a, b) => a.dir.localeCompare(b.dir));
}

export async function fetchRaw(
  source: MirrorSource,
  repoPath: string
): Promise<Buffer> {
  const url = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${source.branch}/${repoPath}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`raw fetch failed (${res.status}) for ${repoPath}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) break;
        results[i] = await fn(items[i], i);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

/** Download every file in a skill directory, keyed by path relative to that dir. */
export async function fetchSkillFiles(
  source: MirrorSource,
  skill: DiscoveredSkill
): Promise<SkillTreeInputFile[]> {
  return mapWithConcurrency(skill.filePaths, 8, async (repoPath) => ({
    path: repoPath.slice(skill.dir.length + 1),
    content: await fetchRaw(source, repoPath),
  }));
}

const LICENSE_NAMES = new Set([
  "license",
  "license.txt",
  "license.md",
  "licence",
  "licence.txt",
]);

/**
 * Recognize permissive open-source licenses by their canonical text. Anything
 * unrecognized — proprietary terms (e.g. "Figma Developer Terms"), "all rights
 * reserved", or a missing license — is denied. Default-deny is intentional: we
 * only redistribute skills whose license clearly permits it.
 */
export function classifyLicense(
  files: SkillTreeInputFile[]
): LicenseClassification {
  const licenseFile = files.find((f) =>
    LICENSE_NAMES.has(path.posix.basename(f.path).toLowerCase())
  );
  if (!licenseFile) return { tag: null, permissive: false, file: null };

  const text = Buffer.isBuffer(licenseFile.content)
    ? licenseFile.content.toString("utf8")
    : String(licenseFile.content);
  const file = licenseFile.path;

  if (/all rights reserved/i.test(text) && !/apache|MIT|BSD/i.test(text)) {
    return { tag: "all-rights-reserved", permissive: false, file };
  }
  if (/apache license/i.test(text) && /version 2/i.test(text)) {
    return { tag: "apache-2.0", permissive: true, file };
  }
  if (
    /\bMIT License\b/i.test(text) ||
    /permission is hereby granted, free of charge/i.test(text)
  ) {
    return { tag: "mit", permissive: true, file };
  }
  if (/mozilla public license/i.test(text) && /version 2/i.test(text)) {
    return { tag: "mpl-2.0", permissive: true, file };
  }
  if (/redistribution and use in source and binary forms/i.test(text)) {
    return { tag: "bsd", permissive: true, file };
  }
  if (/permission to use, copy, modify, and\/or distribute/i.test(text)) {
    return { tag: "isc", permissive: true, file };
  }
  return { tag: "unknown", permissive: false, file };
}

// Minimal YAML frontmatter reader: handles `key: value`, quoted scalars, and
// block scalars (`|`, `>`, with `+`/`-` chomping) as used by these SKILL.md
// files (e.g. claude-api's multi-line `description: |-`).
export function parseFrontmatter(md: string): {
  name: string;
  description: string;
} {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { name: "", description: "" };
  const lines = m[1].split(/\r?\n/);
  const fields: Record<string, string> = {};

  for (let i = 0; i < lines.length; i++) {
    const km = lines[i].match(/^([A-Za-z0-9_-]+):[ \t]*(.*)$/);
    if (!km) continue;
    const key = km[1];
    let val = km[2];

    const blockMatch = val.match(/^([|>])[+-]?\s*$/);
    if (blockMatch) {
      const collected: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (lines[j].trim() === "") {
          collected.push("");
          continue;
        }
        if (/^[ \t]/.test(lines[j])) {
          collected.push(lines[j].replace(/^[ \t]+/, ""));
        } else break;
      }
      i = j - 1;
      val = blockMatch[1] === ">" ? collected.join(" ") : collected.join("\n");
    } else if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    fields[key] = val.trim();
  }

  return {
    name: (fields.name || "").trim(),
    description: (fields.description || "").replace(/\s+/g, " ").trim(),
  };
}

// Upstream skill `name` fields are slugs (e.g. `gh-fix-ci`). Turn them into
// readable display titles (`GitHub Fix CI`) with acronym-aware casing, keeping
// minor connector words lowercase. The slug remains the stable skill_id.
const NAME_ACRONYMS: Record<string, string> = {
  api: "API",
  cli: "CLI",
  ci: "CI",
  cd: "CD",
  ui: "UI",
  ux: "UX",
  ai: "AI",
  sdk: "SDK",
  mcp: "MCP",
  pdf: "PDF",
  html: "HTML",
  css: "CSS",
  js: "JS",
  ts: "TS",
  sql: "SQL",
  url: "URL",
  http: "HTTP",
  json: "JSON",
  gh: "GitHub",
  aspnet: "ASP.NET",
  chatgpt: "ChatGPT",
  openai: "OpenAI",
  winui: "WinUI",
  gif: "GIF",
};

const NAME_MINOR_WORDS = new Set([
  "to",
  "and",
  "or",
  "of",
  "the",
  "a",
  "for",
  "in",
  "on",
  "with",
]);

export function humanizeSkillName(slug: string): string {
  const tokens = slug.split(/[-_\s]+/).filter(Boolean);
  return tokens
    .map((token, i) => {
      const lower = token.toLowerCase();
      if (NAME_ACRONYMS[lower]) return NAME_ACRONYMS[lower];
      if (i > 0 && NAME_MINOR_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}
