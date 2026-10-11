import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  createGithubOAuthState,
  GITHUB_OAUTH_STATE_COOKIE,
  readGithubOAuthState,
} from "@/lib/githubOAuth";

const SECRET = "test-session-secret";
const CREATED_AT = 1_700_000_000_000;

function requestWithState(cookieValue: string) {
  return new NextRequest(
    "https://agentvouch.example/api/auth/github/callback",
    {
      headers: { Cookie: `${GITHUB_OAUTH_STATE_COOKIE}=${cookieValue}` },
    }
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GitHub OAuth state", () => {
  it("accepts a fresh signed state and preserves a safe return path", () => {
    vi.spyOn(Date, "now").mockReturnValue(CREATED_AT);
    const created = createGithubOAuthState("/settings", SECRET);

    expect(
      readGithubOAuthState(requestWithState(created.cookieValue), SECRET)
    ).toEqual({
      state: created.state,
      returnTo: "/settings",
      createdAt: CREATED_AT,
    });
  });

  it("rejects a signed state after its ten-minute lifetime", () => {
    vi.spyOn(Date, "now").mockReturnValue(CREATED_AT);
    const created = createGithubOAuthState("/skills/publish", SECRET);
    vi.spyOn(Date, "now").mockReturnValue(CREATED_AT + 10 * 60_000 + 1);

    expect(
      readGithubOAuthState(requestWithState(created.cookieValue), SECRET)
    ).toBeNull();
  });

  it("rejects a tampered state cookie", () => {
    vi.spyOn(Date, "now").mockReturnValue(CREATED_AT);
    const created = createGithubOAuthState("/skills/publish", SECRET);

    expect(
      readGithubOAuthState(
        requestWithState(`${created.cookieValue}tampered`),
        SECRET
      )
    ).toBeNull();
  });

  it("does not sign an external OAuth return target", () => {
    vi.spyOn(Date, "now").mockReturnValue(CREATED_AT);
    const created = createGithubOAuthState("//attacker.example", SECRET);

    expect(
      readGithubOAuthState(requestWithState(created.cookieValue), SECRET)
    ).toEqual(expect.objectContaining({ returnTo: "/skills/publish" }));
  });
});
