import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import { getSkillMetadataSummary } from "@/lib/metadataData";
import { truncateDescription } from "@/lib/site";
import type { SkillRouteRecord } from "@/lib/skillRouteResolver";
import { getCanonicalSkillPath } from "@/lib/skillRouteResolver";

export async function buildSkillPageMetadata(
  route: SkillRouteRecord | null,
  fallbackPath: string
): Promise<Metadata> {
  if (!route) {
    return buildMetadata({
      title: "Skill Not Found",
      description: "Browse AI agent skills and trust records on AgentVouch.",
      path: fallbackPath,
    });
  }

  const skill = await getSkillMetadataSummary(route.id).catch(() => null);
  if (!skill) {
    return buildMetadata({
      title: "Skill Not Found",
      description: "Browse AI agent skills and trust records on AgentVouch.",
      path: fallbackPath,
    });
  }

  const authorContext = skill.trustSummary
    ? `Author recommendation: ${skill.trustSummary.recommended_action}. ${skill.trustSummary.totalStakedFor} USDC micros of trust capital behind this author.`
    : skill.authorHandle
    ? `Published by unverified @${skill.authorHandle}.`
    : "Published by an unverified AgentVouch publisher.";

  return buildMetadata({
    title: `${skill.name} Trust Record`,
    description: truncateDescription(`${skill.description} ${authorContext}`),
    path: getCanonicalSkillPath(route),
    keywords: [
      skill.name,
      "agent trust record",
      "agent reputation oracle",
      "ai agent skill",
    ],
  });
}
