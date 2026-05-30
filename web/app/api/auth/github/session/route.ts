import { NextRequest, NextResponse } from "next/server";
import { getGithubSessionFromRequest } from "@/lib/githubOAuth";
import { PRIVATE_NO_STORE_CACHE_CONTROL } from "@/lib/cachePolicy";

export async function GET(request: NextRequest) {
  const session = getGithubSessionFromRequest(request);
  return NextResponse.json(
    {
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

