import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import { getSkillMetadataSummary } from "@/lib/metadataData";
import { truncateDescription } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const skill = await getSkillMetadataSummary(id).catch(() => null);

  if (!skill) {
    return buildMetadata({
      title: "Skill Not Found",
      description: "Browse AI agent skills and trust records on AgentVouch.",
      path: `/skills/${id}`,
    });
  }

  return buildMetadata({
    title: `${skill.name} Trust Record`,
    description: truncateDescription(
      `${skill.description} Author recommendation: ${skill.trustSummary.recommended_action}. ${skill.trustSummary.totalStakedFor} USDC micros of trust capital behind this author.`
    ),
    path: `/skills/${id}`,
    keywords: [
      skill.name,
      "agent trust record",
      "agent reputation oracle",
      "ai agent skill",
    ],
  });
}

export default function SkillDetailLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
