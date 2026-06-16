import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { NextRequest, NextResponse } from "next/server";

export const GITHUB_SESSION_COOKIE = "agentvouch_github_session";
export const GITHUB_OAUTH_STATE_COOKIE = "agentvouch_github_oauth_state";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const STATE_MAX_AGE_SECONDS = 60 * 10;

export type GithubSession = {
  provider: "github";
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: number;
};

type SignedState = {
  state: string;
  returnTo: string;
  createdAt: number;
};

type GithubUserResponse = {
  id?: number | string;
  login?: string;
  name?: string | null;
  avatar_url?: string | null;
};

function getSessionSecret() {
  return (
    process.env.AGENTVOUCH_SESSION_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    ""
  );
}

export function getGithubOAuthConfig(request: NextRequest) {
  const clientId =
    process.env.GITHUB_OAUTH_CLIENT_ID || process.env.GITHUB_CLIENT_ID || "";
  const clientSecret =
    process.env.GITHUB_OAUTH_CLIENT_SECRET ||
    process.env.GITHUB_CLIENT_SECRET ||
    "";
  const redirectUri =
    process.env.GITHUB_OAUTH_REDIRECT_URI ||
    new URL("/api/auth/github/callback", request.nextUrl.origin).toString();
  const sessionSecret = getSessionSecret();

  return {
    configured: Boolean(clientId && clientSecret && sessionSecret),
    clientId,
    clientSecret,
    redirectUri,
    sessionSecret,
  };
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function encodeSignedPayload(payload: unknown, secret: string) {
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, secret)}`;
}

function decodeSignedPayload<T>(
  value: string | undefined,
  secret: string
): T | null {
  if (!value || !secret) return null;
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    return JSON.parse(base64UrlDecode(encoded)) as T;
  } catch {
    return null;
  }
}

function sanitizeReturnTo(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/skills/publish";
  }
  return value;
}

export function createGithubOAuthState(returnTo: string, secret: string) {
  const payload: SignedState = {
    state: randomBytes(24).toString("base64url"),
    returnTo: sanitizeReturnTo(returnTo),
    createdAt: Date.now(),
  };

  return {
    state: payload.state,
    cookieValue: encodeSignedPayload(payload, secret),
  };
}

export function readGithubOAuthState(request: NextRequest, secret: string) {
  return decodeSignedPayload<SignedState>(
    request.cookies.get(GITHUB_OAUTH_STATE_COOKIE)?.value,
    secret
  );
}

export function buildGithubAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}) {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", input.state);
  return url;
}

export function setGithubOAuthStateCookie(
  response: NextResponse,
  cookieValue: string
) {
  response.cookies.set(GITHUB_OAUTH_STATE_COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STATE_MAX_AGE_SECONDS,
  });
}

export function clearGithubOAuthStateCookie(response: NextResponse) {
  response.cookies.set(GITHUB_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export function setGithubSessionCookie(
  response: NextResponse,
  session: GithubSession,
  secret: string
) {
  response.cookies.set(
    GITHUB_SESSION_COOKIE,
    encodeSignedPayload(session, secret),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    }
  );
}

export function clearGithubSessionCookie(response: NextResponse) {
  response.cookies.set(GITHUB_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export function getGithubSessionFromRequest(
  request: NextRequest
): GithubSession | null {
  const session = decodeSignedPayload<GithubSession>(
    request.cookies.get(GITHUB_SESSION_COOKIE)?.value,
    getSessionSecret()
  );
  if (!session) return null;
  // Enforce expiry server-side: the HMAC signature never expires on its own, so a
  // leaked/exported cookie value would otherwise be valid forever (the cookie's
  // maxAge only bounds a normal browser). Reject sessions older than the max age.
  if (
    typeof session.createdAt !== "number" ||
    Date.now() - session.createdAt > SESSION_MAX_AGE_SECONDS * 1000
  ) {
    return null;
  }
  return session;
}

export async function exchangeGithubCodeForSession(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<GithubSession> {
  const tokenResponse = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
      }),
    }
  );

  if (!tokenResponse.ok) {
    throw new Error("GitHub OAuth token exchange failed");
  }

  const tokenBody = (await tokenResponse.json()) as {
    access_token?: string;
    error_description?: string;
  };
  if (!tokenBody.access_token) {
    throw new Error(
      tokenBody.error_description || "GitHub OAuth returned no token"
    );
  }

  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${tokenBody.access_token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!userResponse.ok) {
    throw new Error("GitHub user lookup failed");
  }

  const user = (await userResponse.json()) as GithubUserResponse;
  if (!user.id || !user.login) {
    throw new Error("GitHub user profile is missing id or login");
  }

  return {
    provider: "github",
    id: String(user.id),
    login: user.login,
    name: user.name ?? null,
    avatarUrl: user.avatar_url ?? null,
    createdAt: Date.now(),
  };
}
