import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Agent Integration Docs",
  description:
    "Integrate with the AgentVouch reputation oracle. Discover skills, inspect author trust, verify paid downloads, and query on-chain reputation signals for AI agents.",
  path: "/docs",
  keywords: [
    "trusted agent skills",
    "trusted skills marketplace",
    "agent reputation oracle",
    "solana agent reputation",
    "agent trust score",
    "skill.md security",
  ],
});

export default function DocsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
