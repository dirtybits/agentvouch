import { createHash } from "crypto";

const DEFAULT_QUERY = 'filename:SKILL.md "description:"';
const DEFAULT_MAX_RESULTS = 10;
const MAX_RESULTS = 25;
const MAX_SKILL_BYTES = 256 * 1024;

type GithubFetch = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

type GithubCodeSearchItem = {
  name?: string;
  path?: string;
  sha?: string;
  url?: string;
  git_url?: string;
  html_url?: string;
  score?: number;
  repository?: {
    full_name?: string;
    html_url?: string;
    name?: string;
    default_branch?: string;
    stargazers_count?: number;
    topics?: string[];
    license?: {
      key?: string | null;
      name?: string | null;
      spdx_id?: string | null;
    } | null;
    owner?: {
      login?: string;
      html_url?: string;
    };
  };
};

type GithubCodeSearchResponse = {
  total_count?: number;
  incomplete_results?: boolean;
  items?: GithubCodeSearchItem[];
};

type GithubBlobResponse = {
  sha?: string;
  encoding?: string;
  content?: string;
  size?: number;
};

export type GithubSkillFrontmatter = {
  name: string | null;
  description: string | null;
  tags: string[];
};

export type GithubSkillCandidate = {
  source: "github";
  repoFullName: string;
  repoUrl: string | null;
  repoOwner: string | null;
  path: string;
  htmlUrl: string | null;
  gitUrl: string | null;
  blobSha: string | null;
  defaultBranch: string | null;
  detectedSkillName: string | null;
  description: string | null;
  tags: string[];
  license: {
    key: string | null;
    name: string | null;
    spdxId: string | null;
  } | null;
  topics: string[];
  stars: number | null;
  score: number | null;
  sizeBytes: number | null;
  contentSha256: string | null;
  warnings: string[];
};

export type GithubSkillDiscoveryResult = {
  ok: true;
  query: string;
  totalCount: number | null;
  incompleteResults: boolean;
  candidates: GithubSkillCandidate[];
  rateLimit: {
    remaining: string | null;
    reset: string | null;
  };
};

export type DiscoverGithubSkillsOptions = {
  query?: string;
  maxResults?: number;
  token?: string;
  fetcher?: GithubFetch;
  userAgent?: string;
};

function clampMaxResults(input: number | undefined): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    return DEFAULT_MAX_RESULTS;
  }
  return Math.max(1, Math.min(MAX_RESULTS, Math.floor(input)));
}

function isGithubApiUrl(value: string): boolean {
  try {
    return new URL(value).host === "api.github.com";
  } catch {
    return false;
  }
}

function githubHeaders(token?: string, userAgent?: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": userAgent ?? "agentvouch-skill-discovery",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function stripYamlQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseTags(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  const trimmed = stripYamlQuotes(value);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((tag) => stripYamlQuotes(tag))
      .filter(Boolean);
  }
  return trimmed
    .split(",")
    .map((tag) => stripYamlQuotes(tag))
    .filter(Boolean);
}

export function parseSkillFrontmatter(content: string): GithubSkillFrontmatter {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { name: null, description: null, tags: [] };
  }

  const endIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---"
  );
  if (endIndex <= 0) {
    return { name: null, description: null, tags: [] };
  }

  const values = new Map<string, string>();
  for (const line of lines.slice(1, endIndex)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    values.set(match[1], stripYamlQuotes(match[2] ?? ""));
  }

  return {
    name: values.get("name") || null,
    description: values.get("description") || null,
    tags: parseTags(values.get("tags")),
  };
}

function decodeGithubBlob(blob: GithubBlobResponse): {
  content: string | null;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (blob.size != null && blob.size > MAX_SKILL_BYTES) {
    warnings.push(`SKILL.md blob is larger than ${MAX_SKILL_BYTES} bytes`);
    return { content: null, warnings };
  }
  if (blob.encoding !== "base64" || !blob.content) {
    warnings.push("GitHub blob content was not returned as base64");
    return { content: null, warnings };
  }

  const rawBytes = Buffer.from(blob.content.replace(/\s/g, ""), "base64");
  if (rawBytes.byteLength > MAX_SKILL_BYTES) {
    warnings.push(`SKILL.md blob is larger than ${MAX_SKILL_BYTES} bytes`);
    return { content: null, warnings };
  }

  return { content: rawBytes.toString("utf8"), warnings };
}

async function readGithubJson<T>(
  response: Response,
  context: string
): Promise<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const detail = text ? `: ${text.slice(0, 240)}` : "";
    throw new Error(`${context} failed with ${response.status}${detail}`);
  }
  return (await response.json()) as T;
}

function emptyCandidate(
  item: GithubCodeSearchItem,
  warnings: string[]
): GithubSkillCandidate {
  const repo = item.repository;
  return {
    source: "github",
    repoFullName: repo?.full_name ?? "unknown/unknown",
    repoUrl: repo?.html_url ?? null,
    repoOwner: repo?.owner?.login ?? null,
    path: item.path ?? item.name ?? "SKILL.md",
    htmlUrl: item.html_url ?? null,
    gitUrl: item.git_url ?? null,
    blobSha: item.sha ?? null,
    defaultBranch: repo?.default_branch ?? null,
    detectedSkillName: null,
    description: null,
    tags: [],
    license: repo?.license
      ? {
          key: repo.license.key ?? null,
          name: repo.license.name ?? null,
          spdxId: repo.license.spdx_id ?? null,
        }
      : null,
    topics: Array.isArray(repo?.topics) ? repo.topics : [],
    stars:
      typeof repo?.stargazers_count === "number" ? repo.stargazers_count : null,
    score: typeof item.score === "number" ? item.score : null,
    sizeBytes: null,
    contentSha256: null,
    warnings,
  };
}

async function candidateFromSearchItem(
  item: GithubCodeSearchItem,
  fetcher: GithubFetch,
  headers: HeadersInit
): Promise<GithubSkillCandidate> {
  const warnings: string[] = [];
  if (!item.git_url) {
    return emptyCandidate(item, ["Missing GitHub blob URL"]);
  }
  if (!isGithubApiUrl(item.git_url)) {
    // Defense in depth: never attach the Authorization token to a host other
    // than the GitHub API, even if the upstream search response is malformed.
    return emptyCandidate(item, ["GitHub blob URL is not on api.github.com"]);
  }

  let blob: GithubBlobResponse;
  try {
    const response = await fetcher(item.git_url, { headers });
    blob = await readGithubJson<GithubBlobResponse>(
      response,
      `Fetch GitHub blob ${item.git_url}`
    );
  } catch (error) {
    return emptyCandidate(item, [
      error instanceof Error ? error.message : "Failed to fetch GitHub blob",
    ]);
  }

  const decoded = decodeGithubBlob(blob);
  warnings.push(...decoded.warnings);
  const candidate = emptyCandidate(item, warnings);
  candidate.blobSha = blob.sha ?? item.sha ?? null;
  candidate.sizeBytes = blob.size ?? null;

  if (!decoded.content) {
    return candidate;
  }

  const frontmatter = parseSkillFrontmatter(decoded.content);
  candidate.detectedSkillName = frontmatter.name;
  candidate.description = frontmatter.description;
  candidate.tags = frontmatter.tags;
  candidate.contentSha256 = createHash("sha256")
    .update(decoded.content)
    .digest("hex");

  if (!frontmatter.name) {
    candidate.warnings.push("Missing skill name in frontmatter");
  }
  if (!frontmatter.description) {
    candidate.warnings.push("Missing skill description in frontmatter");
  }

  return candidate;
}

export async function discoverGithubSkills(
  options: DiscoverGithubSkillsOptions = {}
): Promise<GithubSkillDiscoveryResult> {
  const fetcher = options.fetcher ?? fetch;
  const query = options.query?.trim() || DEFAULT_QUERY;
  const maxResults = clampMaxResults(options.maxResults);
  const headers = githubHeaders(options.token, options.userAgent);

  const searchUrl = new URL("https://api.github.com/search/code");
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("per_page", String(maxResults));

  const response = await fetcher(searchUrl, { headers });
  const body = await readGithubJson<GithubCodeSearchResponse>(
    response,
    "GitHub code search"
  );
  const items = Array.isArray(body.items)
    ? body.items.slice(0, maxResults)
    : [];
  const candidates = await Promise.all(
    items.map((item) => candidateFromSearchItem(item, fetcher, headers))
  );

  return {
    ok: true,
    query,
    totalCount: typeof body.total_count === "number" ? body.total_count : null,
    incompleteResults: Boolean(body.incomplete_results),
    candidates,
    rateLimit: {
      remaining: response.headers.get("x-ratelimit-remaining"),
      reset: response.headers.get("x-ratelimit-reset"),
    },
  };
}
