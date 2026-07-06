import { NextResponse } from "next/server";
import { getCanonicalUrl } from "@/lib/site";

export const dynamic = "force-static";

export function GET() {
  const body = [
    "User-agent: *",
    "Allow: /",
    "Allow: /agent-reputation-system",
    "Allow: /docs",
    "Allow: /skills",
    "Allow: /author",
    "Allow: /skill.md",
    "Allow: /llms.txt",
    "Allow: /llms-full.txt",
    "Allow: /openapi.json",
    "Allow: /.well-known/",
    "Disallow: /api/",
    "Disallow: /dashboard",
    "Disallow: /settings",
    "",
    "# Content Signals (https://contentsignals.org/)",
    "# AgentVouch content is published for agent discovery and use.",
    "Content-Signal: search=yes, ai-input=yes, ai-train=yes",
    "",
    `Sitemap: ${getCanonicalUrl("/sitemap.xml")}`,
    `Host: ${getCanonicalUrl("/")}`,
    "",
  ].join("\n");

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
