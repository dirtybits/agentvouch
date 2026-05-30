import { NextRequest, NextResponse } from "next/server";
import { fetchAllIndexedSkills } from "@/lib/indexFeeds";
import { AGENT_DISCOVERY_SCHEMA_VERSION } from "@/lib/agentDiscovery";
import { getErrorMessage } from "@/lib/errors";

export async function GET(request: NextRequest) {
  try {
    const baseUrl = request.nextUrl.origin;
    const skills = await fetchAllIndexedSkills(baseUrl);
    const walletBackedSkills = skills.filter(
      (skill): skill is (typeof skills)[number] & { author_pubkey: string } =>
        Boolean(skill.author_pubkey)
    );
    const authors = [
      ...new Map(
        walletBackedSkills.map((skill) => [
          skill.author_pubkey,
          {
            pubkey: skill.author_pubkey,
            canonical_agent_id:
              skill.author_trust_summary?.canonical_agent_id ?? null,
            chain_context: skill.author_trust_summary?.chain_context ?? null,
            recommended_action:
              skill.author_trust_summary?.recommended_action ?? null,
            author_trust_summary: skill.author_trust_summary ?? null,
            author_identity: skill.author_identity ?? null,
            skill_count: walletBackedSkills.filter(
              (candidate) => candidate.author_pubkey === skill.author_pubkey
            ).length,
          },
        ])
      ).values(),
    ];

    return NextResponse.json({
      schema_version: AGENT_DISCOVERY_SCHEMA_VERSION,
      generated_at: new Date().toISOString(),
      total: authors.length,
      authors,
    });
  } catch (error: unknown) {
    console.error("GET /api/index/authors error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
