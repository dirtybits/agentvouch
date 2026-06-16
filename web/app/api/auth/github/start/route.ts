import { NextRequest, NextResponse } from "next/server";
import {
  buildGithubAuthorizeUrl,
  createGithubOAuthState,
  getGithubOAuthConfig,
  setGithubOAuthStateCookie,
} from "@/lib/githubOAuth";

export async function GET(request: NextRequest) {
  const config = getGithubOAuthConfig(request);
  if (!config.configured) {
    return NextResponse.json(
      {
        error:
          "GitHub OAuth is not configured. Set GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET, and AGENTVOUCH_SESSION_SECRET.",
      },
      { status: 503 }
    );
  }

  const returnTo =
    request.nextUrl.searchParams.get("returnTo") ?? "/skills/publish";
  const state = createGithubOAuthState(returnTo, config.sessionSecret);
  const response = NextResponse.redirect(
    buildGithubAuthorizeUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state: state.state,
    })
  );
  setGithubOAuthStateCookie(response, state.cookieValue);
  return response;
}
