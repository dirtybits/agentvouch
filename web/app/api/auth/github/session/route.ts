import { NextRequest, NextResponse } from "next/server";
import {
  getGithubOAuthConfig,
  getGithubSessionFromRequest,
} from "@/lib/githubOAuth";
import { PRIVATE_NO_STORE_CACHE_CONTROL } from "@/lib/cachePolicy";

export async function GET(request: NextRequest) {
  const session = getGithubSessionFromRequest(request);
  return NextResponse.json(
    {
      // Lets the UI hide the GitHub control entirely when OAuth isn't wired up
      // (no env creds), rather than render a button that 503s on click.
      configured: getGithubOAuthConfig(request).configured,
      authenticated: Boolean(session),
      user: session
        ? {
            provider: session.provider,
            id: session.id,
            login: session.login,
            name: session.name,
            avatarUrl: session.avatarUrl,
          }
        : null,
    },
    {
      headers: {
        "Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL,
      },
    }
  );
}
