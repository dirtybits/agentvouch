import { NextResponse, type NextRequest } from "next/server";

const SUBSTACK_NEWSLETTER_URL = "https://agentvouch.substack.com/";

export function GET(request: NextRequest) {
  const target = new URL(SUBSTACK_NEWSLETTER_URL);
  request.nextUrl.searchParams.forEach((value, key) => {
    target.searchParams.append(key, value);
  });

  return NextResponse.redirect(target, 307);
}
