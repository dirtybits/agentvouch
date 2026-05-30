import { NextRequest, NextResponse } from "next/server";
import { fetchAllIndexedSkills } from "@/lib/indexFeeds";
import { AGENT_DISCOVERY_SCHEMA_VERSION } from "@/lib/agentDiscovery";
import { getErrorMessage } from "@/lib/errors";

export async function GET(request: NextRequest) {
  try {
    const baseUrl = request.nextUrl.origin;
    const skills = await fetchAllIndexedSkills(baseUrl);
    const trustedAuthors = [
      ...new Map(
        skills
          .filter(
            (skill): skill is (typeof skills)[number] & { author_pubkey: string } =>
              Boolean(skill.author_pubkey) &&
              skill.author_trust_summary?.recommended_action === "allow"
          )
          .map((skill) => [
            skill.author_pubkey,
            {
              pubkey: skill.author_pubkey,
              canonical_agent_id:
                skill.author_trust_summary?.canonical_agent_id ?? null,
              author_trust_summary: skill.author_trust_summary ?? null,
              author_identity: skill.author_identity ?? null,
              trusted_skill_count: skills.filter(
                (candidate) =>
                  candidate.author_pubkey === skill.author_pubkey &&
                  candidate.author_trust_summary?.recommended_action === "allow"
              ).length,
            },
          ])
      ).values(),
    ];

    return NextResponse.json({
      schema_version: AGENT_DISCOVERY_SCHEMA_VERSION,
      generated_at: new Date().toISOString(),
      total: trustedAuthors.length,
      authors: trustedAuthors,
    });
  } catch (error: unknown) {
    console.error("GET /api/index/trusted-authors error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
