import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/indexFeeds", () => ({
  fetchAllIndexedSkills: vi.fn(),
}));

import { fetchAllIndexedSkills } from "@/lib/indexFeeds";
import { GET as getSkillsIndex } from "@/app/api/index/skills/route";
import { GET as getAuthorsIndex } from "@/app/api/index/authors/route";
import { GET as getTrustedAuthorsIndex } from "@/app/api/index/trusted-authors/route";

const mockFetchAllIndexedSkills =
  fetchAllIndexedSkills as unknown as ReturnType<typeof vi.fn>;

const skill = {
  id: "skill-db-id",
  skill_id: "example-skill",
  public_slug: "example-skill",
  public_author_slug: "example-author",
  author_pubkey: "Author111",
  name: "Example skill",
  description: "A test skill",
  tags: ["test"],
  current_version: 1,
  ipfs_cid: null,
  total_installs: 0,
  created_at: "2026-10-02T00:00:00.000Z",
  author_trust: null,
};

function hostileRequest(path: string) {
  return new NextRequest(`https://attacker.invalid${path}`);
}

async function invokeWithHostileOrigin(
  handler: () => Promise<Response>,
  path: string
) {
  return (handler as unknown as (request: NextRequest) => Promise<Response>)(
    hostileRequest(path)
  );
}

describe("public discovery index origins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchAllIndexedSkills.mockResolvedValue([skill]);
  });

  it("pins the skills index fetch and public URLs to the configured origin", async () => {
    const response = await invokeWithHostileOrigin(
      getSkillsIndex,
      "/api/index/skills"
    );

    expect(mockFetchAllIndexedSkills).toHaveBeenCalledWith(
      "https://agentvouch.xyz"
    );
    await expect(response.json()).resolves.toMatchObject({
      skills: [
        {
          public_url:
            "https://agentvouch.xyz/skills/example-author/example-skill",
        },
      ],
    });
  });

  it.each([
    ["authors", getAuthorsIndex, "/api/index/authors"],
    ["trusted authors", getTrustedAuthorsIndex, "/api/index/trusted-authors"],
  ])(
    "pins the %s index fetch despite a hostile request origin",
    async (_name, GET, path) => {
      await invokeWithHostileOrigin(GET, path);

      expect(mockFetchAllIndexedSkills).toHaveBeenCalledWith(
        "https://agentvouch.xyz"
      );
    }
  );
});
