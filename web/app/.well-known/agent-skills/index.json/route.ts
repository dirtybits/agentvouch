import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getCanonicalUrl } from "@/lib/site";
import { buildLlmsTxt } from "@/lib/llms";

export const dynamic = "force-static";

type SkillEntry = {
  name: string;
  type: string;
  description: string;
  url: string;
  sha256: string;
};

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function hashPublicFile(relPath: string): string {
  return sha256(readFileSync(path.join(process.cwd(), "public", relPath)));
}

export function GET() {
  const entries: Array<{
    name: string;
    type: string;
    description: string;
    publicPath: string;
    // Dynamic sources (served by an app route, not a public/ file) supply their
    // body here so the sha256 is computed from generated content, not disk.
    content?: () => string;
  }> = [
    {
      name: "skill.md",
      type: "text/markdown",
      description:
        "Agent-facing skill file describing AgentVouch discovery, trust, and paid-download flow.",
      publicPath: "skill.md",
    },
    {
      name: "llms.txt",
      type: "text/plain",
      description:
        "Concise index of AgentVouch docs, APIs, and discovery endpoints for LLMs.",
      publicPath: "llms.txt",
      content: buildLlmsTxt,
    },
    {
      name: "llms-full.txt",
      type: "text/plain",
      description:
        "Expanded index of AgentVouch docs and machine-readable endpoints for LLMs.",
      publicPath: "llms-full.txt",
    },
    {
      name: "openapi.json",
      type: "application/vnd.oai.openapi+json;version=3.1",
      description: "OpenAPI 3.1 specification for AgentVouch public APIs.",
      publicPath: "openapi.json",
    },
    {
      name: "agentvouch.json",
      type: "application/json",
      description:
        "AgentVouch service manifest: canonical URLs, discovery endpoints, and auth contract.",
      publicPath: ".well-known/agentvouch.json",
    },
  ];

  const skills: SkillEntry[] = entries.map((entry) => ({
    name: entry.name,
    type: entry.type,
    description: entry.description,
    url: getCanonicalUrl(`/${entry.publicPath}`),
    sha256: entry.content
      ? sha256(entry.content())
      : hashPublicFile(entry.publicPath),
  }));

  const body = {
    $schema:
      "https://raw.githubusercontent.com/cloudflare/agent-skills-discovery-rfc/main/schema/index-v0.2.0.json",
    version: "0.2.0",
    publisher: {
      name: "AgentVouch",
      url: getCanonicalUrl("/"),
    },
    skills,
  };

  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
