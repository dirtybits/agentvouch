import { describe, expect, it, vi } from "vitest";
import {
  discoverGithubSkills,
  parseSkillFrontmatter,
} from "@/lib/githubSkillDiscovery";

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

describe("parseSkillFrontmatter", () => {
  it("extracts name, description, and compact tags", () => {
    const parsed = parseSkillFrontmatter(`---
name: web3-protocol-design
description: "Designs protocols: incentives, disputes, and launches."
tags: [web3, protocol, incentives]
---

# Body`);

    expect(parsed).toEqual({
      name: "web3-protocol-design",
      description: "Designs protocols: incentives, disputes, and launches.",
      tags: ["web3", "protocol", "incentives"],
    });
  });
});

describe("discoverGithubSkills", () => {
  it("discovers SKILL.md candidates from pinned GitHub blobs", async () => {
    const skill = `---
name: turn-closeout
description: End substantial turns with verification and suggested next steps.
tags: workflow, codex
---

# Turn Closeout`;

    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.startsWith("https://api.github.com/search/code")) {
        expect(url).toContain("filename%3ASKILL.md");
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer gh-test-token",
        });
        return jsonResponse(
          {
            total_count: 1,
            incomplete_results: false,
            items: [
              {
                name: "SKILL.md",
                path: "skills/turn-closeout/SKILL.md",
                sha: "blobsha111",
                git_url:
                  "https://api.github.com/repos/dirtybits/agent-skills/git/blobs/blobsha111",
                html_url:
                  "https://github.com/dirtybits/agent-skills/blob/main/skills/turn-closeout/SKILL.md",
                score: 3.4,
                repository: {
                  full_name: "dirtybits/agent-skills",
                  html_url: "https://github.com/dirtybits/agent-skills",
                  default_branch: "main",
                  stargazers_count: 17,
                  topics: ["skills", "agents"],
                  license: {
                    key: "mit",
                    name: "MIT License",
                    spdx_id: "MIT",
                  },
                  owner: { login: "dirtybits" },
                },
              },
            ],
          },
          {
            "x-ratelimit-remaining": "59",
            "x-ratelimit-reset": "1770000000",
          }
        );
      }

      expect(url).toBe(
        "https://api.github.com/repos/dirtybits/agent-skills/git/blobs/blobsha111"
      );
      return jsonResponse({
        sha: "blobsha111",
        encoding: "base64",
        content: Buffer.from(skill, "utf8").toString("base64"),
        size: Buffer.byteLength(skill, "utf8"),
      });
    });

    const result = await discoverGithubSkills({
      query: "filename:SKILL.md",
      maxResults: 3,
      token: "gh-test-token",
      fetcher,
    });

    expect(result.ok).toBe(true);
    expect(result.totalCount).toBe(1);
    expect(result.rateLimit.remaining).toBe("59");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      repoFullName: "dirtybits/agent-skills",
      repoOwner: "dirtybits",
      path: "skills/turn-closeout/SKILL.md",
      blobSha: "blobsha111",
      detectedSkillName: "turn-closeout",
      description:
        "End substantial turns with verification and suggested next steps.",
      tags: ["workflow", "codex"],
      warnings: [],
    });
    expect(result.candidates[0].contentSha256).toHaveLength(64);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("refuses to fetch blob URLs that are not on api.github.com", async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.startsWith("https://api.github.com/search/code")) {
        return jsonResponse({
          total_count: 1,
          incomplete_results: false,
          items: [
            {
              name: "SKILL.md",
              path: "SKILL.md",
              sha: "blobsha333",
              git_url: "https://evil.example.com/blob/333",
              repository: {
                full_name: "owner/repo",
                html_url: "https://github.com/owner/repo",
                owner: { login: "owner" },
              },
            },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await discoverGithubSkills({ token: "gh-secret", fetcher });

    expect(result.candidates[0]).toMatchObject({
      repoFullName: "owner/repo",
      detectedSkillName: null,
      contentSha256: null,
    });
    expect(result.candidates[0].warnings).toContain(
      "GitHub blob URL is not on api.github.com"
    );
    // The token must never be sent to a non-GitHub host: only the search
    // request fires, never the blob fetch.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps provenance with a warning when a blob cannot be parsed", async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.startsWith("https://api.github.com/search/code")) {
        return jsonResponse({
          total_count: 1,
          incomplete_results: false,
          items: [
            {
              name: "SKILL.md",
              path: "SKILL.md",
              sha: "blobsha222",
              git_url: "https://api.github.com/blob/222",
              repository: {
                full_name: "owner/repo",
                html_url: "https://github.com/owner/repo",
                owner: { login: "owner" },
              },
            },
          ],
        });
      }
      return jsonResponse({ sha: "blobsha222", encoding: "utf-8" });
    });

    const result = await discoverGithubSkills({ fetcher });

    expect(result.candidates[0]).toMatchObject({
      repoFullName: "owner/repo",
      blobSha: "blobsha222",
      detectedSkillName: null,
      contentSha256: null,
    });
    expect(result.candidates[0].warnings).toContain(
      "GitHub blob content was not returned as base64"
    );
  });
});
