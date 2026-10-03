import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  createGithubOAuthState,
  GITHUB_OAUTH_STATE_COOKIE,
  readGithubOAuthState,
} from "@/lib/githubOAuth";

const SECRET = "test-session-secret";
const APP_ORIGIN = "https://agentvouch.example";

function readCreatedState(returnTo: string) {
  const created = createGithubOAuthState(returnTo, SECRET);
  return readGithubOAuthState(
    new NextRequest(`${APP_ORIGIN}/api/auth/github/callback`, {
      headers: {
        Cookie: `${GITHUB_OAUTH_STATE_COOKIE}=${created.cookieValue}`,
      },
    }),
    SECRET
  );
}

describe("GitHub OAuth return target", () => {
  it("preserves a same-origin relative path", () => {
    expect(readCreatedState("/settings?tab=github")).toEqual(
      expect.objectContaining({ returnTo: "/settings?tab=github" })
    );
  });

  it.each(["/\\attacker.example", "/\\\\attacker.example"])(
    "does not sign a backslash path that URL resolution treats as an external host: %s",
    (returnTo) => {
      const state = readCreatedState(returnTo);

      expect(state).toEqual(
        expect.objectContaining({ returnTo: "/skills/publish" })
      );
      expect(new URL(state!.returnTo, APP_ORIGIN).origin).toBe(APP_ORIGIN);
    }
  );
});
