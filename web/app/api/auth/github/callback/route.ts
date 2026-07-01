import { NextRequest, NextResponse } from "next/server";
import {
  clearGithubOAuthStateCookie,
  exchangeGithubCodeForSession,
  getGithubOAuthConfig,
  readGithubOAuthState,
  setGithubSessionCookie,
} from "@/lib/githubOAuth";
import { getErrorMessage } from "@/lib/errors";

export async function GET(request: NextRequest) {
  const config = getGithubOAuthConfig(request);
  const fallback = new URL(
    "/skills/publish?github=error",
    request.nextUrl.origin
  );

  if (!config.configured) {
    return NextResponse.redirect(fallback);
  }

  const code = request.nextUrl.searchParams.get("code");
  const incomingState = request.nextUrl.searchParams.get("state");
  const storedState = readGithubOAuthState(request, config.sessionSecret);
  if (
    !code ||
    !incomingState ||
    !storedState ||
    storedState.state !== incomingState
  ) {
    return NextResponse.redirect(fallback);
  }

  try {
    const session = await exchangeGithubCodeForSession({
      code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
    });
    const redirectUrl = new URL(storedState.returnTo, request.nextUrl.origin);
    redirectUrl.searchParams.set("github", "connected");
    const response = NextResponse.redirect(redirectUrl);
    clearGithubOAuthStateCookie(response);
    setGithubSessionCookie(response, session, config.sessionSecret);
    return response;
  } catch (error: unknown) {
    console.error("GitHub OAuth callback failed:", getErrorMessage(error));
    return NextResponse.redirect(fallback);
  }
}
