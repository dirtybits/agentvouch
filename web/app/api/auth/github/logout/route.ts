import { NextResponse } from "next/server";
import { clearGithubSessionCookie } from "@/lib/githubOAuth";

export async function POST() {
  const response = NextResponse.json({ success: true });
  clearGithubSessionCookie(response);
  return response;
}
