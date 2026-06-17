import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockDiscoverGithubSkills } = vi.hoisted(() => ({
  mockDiscoverGithubSkills: vi.fn(),
}));

vi.mock("@/lib/githubSkillDiscovery", () => ({
  discoverGithubSkills: mockDiscoverGithubSkills,
}));

import { GET, POST } from "@/app/api/github/skills/discover/route";

function request(url: string, init: RequestInit = {}): NextRequest {
  return new NextRequest(url, init);
}

describe("/api/github/skills/discover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscoverGithubSkills.mockResolvedValue({
      ok: true,
      query: "filename:SKILL.md",
      totalCount: 1,
      incompleteResults: false,
      candidates: [{ detectedSkillName: "turn-closeout" }],
      rateLimit: { remaining: "59", reset: "1770000000" },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed in production without a discovery secret", async () => {
    vi.stubEnv("GITHUB_SKILL_DISCOVERY_SECRET", "");
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("VERCEL_ENV", "production");

    const res = await GET(
      request("http://localhost/api/github/skills/discover?q=filename:SKILL.md")
    );

    expect(res.status).toBe(401);
    expect(mockDiscoverGithubSkills).not.toHaveBeenCalled();
  });

  it("fails closed in preview without a discovery secret", async () => {
    vi.stubEnv("GITHUB_SKILL_DISCOVERY_SECRET", "");
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("VERCEL_ENV", "preview");

    const res = await GET(
      request("http://localhost/api/github/skills/discover?q=filename:SKILL.md")
    );

    expect(res.status).toBe(401);
    expect(mockDiscoverGithubSkills).not.toHaveBeenCalled();
  });

  it("requires the configured bearer token", async () => {
    vi.stubEnv("GITHUB_SKILL_DISCOVERY_SECRET", "discover-secret");

    const res = await GET(
      request("http://localhost/api/github/skills/discover")
    );

    expect(res.status).toBe(401);
    expect(mockDiscoverGithubSkills).not.toHaveBeenCalled();
  });

  it("discovers GitHub skills with GET query params", async () => {
    vi.stubEnv("GITHUB_SKILL_DISCOVERY_SECRET", "discover-secret");
    vi.stubEnv("GITHUB_TOKEN", "gh-token");

    const res = await GET(
      request(
        "http://localhost/api/github/skills/discover?q=filename:SKILL.md+path:skills&limit=7",
        {
          headers: { authorization: "Bearer discover-secret" },
        }
      )
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(body.candidates[0].detectedSkillName).toBe("turn-closeout");
    expect(mockDiscoverGithubSkills).toHaveBeenCalledWith({
      query: "filename:SKILL.md path:skills",
      maxResults: 7,
      token: "gh-token",
    });
  });

  it("discovers GitHub skills with a POST body", async () => {
    vi.stubEnv("GITHUB_SKILL_DISCOVERY_SECRET", "discover-secret");

    const res = await POST(
      request("http://localhost/api/github/skills/discover", {
        method: "POST",
        headers: {
          authorization: "Bearer discover-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: "filename:SKILL.md org:dirtybits",
          maxResults: 3,
        }),
      })
    );

    expect(res.status).toBe(200);
    expect(mockDiscoverGithubSkills).toHaveBeenCalledWith({
      query: "filename:SKILL.md org:dirtybits",
      maxResults: 3,
      token: undefined,
    });
  });
});
