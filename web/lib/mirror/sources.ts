// Registry of external GitHub skill repositories that AgentVouch mirrors as free,
// repo-backed listings. Each source attributes listings to the upstream GitHub
// org's identity (publisher_identity_key = `github:<githubId>`), mirroring the
// shape produced by the GitHub OAuth publish path in app/api/skills/route.ts.
//
// Only permissively-licensed skills are mirrored — see classifyLicense() in
// ./github.ts. The path filter additionally scopes which directories of a repo
// are eligible (e.g. OpenAI keeps Codex's internal `.system/*` skills private).

export type MirrorSource = {
  /** Stable key used for CLI filtering and logs. */
  key: string;
  /** GitHub owner/org login. */
  owner: string;
  /** Repository name. */
  repo: string;
  /** Branch to mirror. */
  branch: string;
  /** GitHub org numeric id → author_external_id and publisher_identity_key. */
  githubId: string;
  /** GitHub login → author_handle. */
  handle: string;
  /** Display name → author_display_name. */
  displayName: string;
  /**
   * Only directories whose repo-relative path begins with one of these prefixes
   * are eligible. A skill directory is any directory that directly contains a
   * top-level SKILL.md.
   */
  includePathPrefixes: string[];
  /** Normal searchable tags applied to every listing from this source. */
  tags: string[];
};

export const MIRROR_SOURCES: MirrorSource[] = [
  {
    key: "anthropic",
    owner: "anthropics",
    repo: "skills",
    branch: "main",
    githubId: "76263028",
    handle: "anthropics",
    displayName: "Anthropic",
    includePathPrefixes: ["skills/"],
    tags: ["anthropic"],
  },
  {
    key: "openai",
    owner: "openai",
    repo: "skills",
    branch: "main",
    githubId: "14957082",
    handle: "openai",
    displayName: "OpenAI",
    // Codex's public catalog only. `skills/.system/*` are runtime-internal.
    includePathPrefixes: ["skills/.curated/"],
    tags: ["openai", "codex"],
  },
];

export function publisherIdentityKey(source: MirrorSource): string {
  return `github:${source.githubId}`;
}

export function sourceRepoUrl(source: MirrorSource): string {
  return `https://github.com/${source.owner}/${source.repo}`;
}

export function getMirrorSourceByKey(key?: string | null): MirrorSource | null {
  if (!key) return null;
  return (
    MIRROR_SOURCES.find(
      (source) => source.key.toLowerCase() === key.toLowerCase()
    ) ?? null
  );
}

export function getMirrorSources(keys?: string[]): MirrorSource[] {
  if (!keys || keys.length === 0) return MIRROR_SOURCES;
  const want = new Set(keys.map((k) => k.toLowerCase()));
  const sources = MIRROR_SOURCES.filter((s) => want.has(s.key.toLowerCase()));
  const known = new Set(sources.map((s) => s.key.toLowerCase()));
  const unknown = [...want].filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new Error(`Unknown mirror source(s): ${unknown.join(", ")}`);
  }
  return sources;
}
