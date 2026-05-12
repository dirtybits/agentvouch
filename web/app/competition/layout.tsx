import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Best Skill Competition (concluded)",
  description:
    "The March 2026 AgentVouch Best Skill Competition has concluded. Browse the live marketplace for current AI agent skills and trust signals.",
  path: "/competition",
});

export default function CompetitionLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
