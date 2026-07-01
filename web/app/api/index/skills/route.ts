import { NextRequest, NextResponse } from "next/server";
import { fetchAllIndexedSkills } from "@/lib/indexFeeds";
import { AGENT_DISCOVERY_SCHEMA_VERSION } from "@/lib/agentDiscovery";
import { getErrorMessage } from "@/lib/errors";
import { getPublicSkillPath } from "@/lib/skillUrls";

export async function GET(request: NextRequest) {
  try {
    const baseUrl = request.nextUrl.origin;
    const skills = await fetchAllIndexedSkills(baseUrl);

    return NextResponse.json({
      schema_version: AGENT_DISCOVERY_SCHEMA_VERSION,
      generated_at: new Date().toISOString(),
      total: skills.length,
      skills: skills.map((skill) => ({
        id: skill.id,
        skill_id: skill.skill_id,
        public_url: `${baseUrl}${getPublicSkillPath(skill)}`,
        name: skill.name,
        description: skill.description,
        tags: skill.tags,
        source: skill.source ?? "repo",
        chain_context: skill.chain_context ?? null,
        on_chain_address: skill.on_chain_address ?? null,
        price_lamports: skill.price_lamports ?? null,
        price_usdc_micros: skill.price_usdc_micros ?? null,
        currency_mint: skill.currency_mint ?? null,
        payment_flow: skill.payment_flow ?? "free",
        total_installs: skill.total_installs,
        total_downloads: skill.total_downloads ?? 0,
        total_revenue: skill.total_revenue ?? 0,
        skill_uri: skill.skill_uri ?? null,
        created_at: skill.created_at,
        author_pubkey: skill.author_pubkey,
        author_kind: skill.author_kind ?? null,
        author_external_id: skill.author_external_id ?? null,
        author_handle: skill.author_handle ?? null,
        author_display_name: skill.author_display_name ?? null,
        publisher_identity_key: skill.publisher_identity_key ?? null,
        publisher_tier: skill.publisher_tier ?? null,
        mirror_source_key: skill.mirror_source_key ?? null,
        synced_repo_url: skill.synced_repo_url ?? null,
        mirrored_from: skill.mirror_source_key
          ? {
              source_key: skill.mirror_source_key,
              github_handle: skill.author_handle ?? null,
              github_url: skill.author_handle
                ? `https://github.com/${skill.author_handle}`
                : null,
            }
          : null,
        author_trust_summary: skill.author_trust_summary ?? null,
        author_identity: skill.author_identity ?? null,
      })),
    });
  } catch (error: unknown) {
    console.error("GET /api/index/skills error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
