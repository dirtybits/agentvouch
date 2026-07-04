import Link from "next/link";
import { buildMetadata, buildDocJsonLd } from "@/lib/seo";

const TITLE = "Do You Need an Agent Reputation System?";
const DESCRIPTION =
  "If your AI agents install skills, delegate tasks, or move money on your behalf, you need an agent reputation system to check a counterparty's trust record before acting. Here are the signals and the risks of skipping it.";

export const metadata = buildMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: "/docs/do-you-need-an-agent-reputation-system",
  keywords: [
    "do you need an agent reputation system",
    "ai agent trust",
    "agent supply chain risk",
  ],
});

const jsonLd = buildDocJsonLd({
  title: TITLE,
  description: DESCRIPTION,
  path: "/docs/do-you-need-an-agent-reputation-system",
  published: "2026-07-03",
  faqs: [
    {
      q: "When do I need an agent reputation system?",
      a: "When your agents install third-party skills, delegate tasks to other agents, or authorize payments and access — anywhere an agent acts on a counterparty it cannot personally vouch for.",
    },
    {
      q: "What happens without one?",
      a: "Agents fall back to trusting names, repositories, or unsigned files, which are cheap to fake. A single malicious skill or unproven counterparty can exfiltrate data or drain funds before a human reviews it.",
    },
  ],
});

export default function DoYouNeedPage() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <article className="max-w-3xl mx-auto px-6 py-10 text-gray-700 dark:text-gray-300">
        <p className="text-sm uppercase tracking-[0.2em] text-[var(--lobster-accent)] mb-4">
          AgentVouch Docs
        </p>
        <h1 className="text-3xl md:text-4xl font-display text-gray-900 dark:text-white mb-4">
          Do you need an agent reputation system?
        </h1>
        <p className="text-base md:text-lg mb-6">
          Short answer: if your AI agents install skills, delegate tasks, or
          move money on your behalf, yes. An{" "}
          <Link href="/agent-reputation-system" className="underline">
            agent reputation system
          </Link>{" "}
          lets an agent check a counterparty&apos;s trust record before it acts,
          instead of trusting a label after the fact.
        </p>

        <h2 className="text-xl font-heading font-bold text-gray-900 dark:text-white mb-3">
          Signs you need one
        </h2>
        <ul className="list-disc pl-5 space-y-2 mb-6">
          <li>Your agents install third-party skills or packages.</li>
          <li>Your agents delegate tasks to other agents.</li>
          <li>Your agents authorize payments, access, or credentials.</li>
          <li>
            You cannot personally review every counterparty at agent speed.
          </li>
        </ul>

        <h2 className="text-xl font-heading font-bold text-gray-900 dark:text-white mb-3">
          The risk of skipping it
        </h2>
        <p className="mb-6">
          Without a trust record, agents fall back to names, repositories, and
          unsigned files — all cheap to fake. See{" "}
          <Link href="/docs/skill-md-security" className="underline">
            why skill.md is a supply-chain risk
          </Link>{" "}
          for the concrete failure mode.
        </p>

        <h2 className="text-xl font-heading font-bold text-gray-900 dark:text-white mb-3">
          How to add one
        </h2>
        <p className="mb-6">
          Query a stake-backed{" "}
          <Link href="/docs/ai-agent-reputation-score" className="underline">
            reputation score
          </Link>{" "}
          before acting, and follow the{" "}
          <Link href="/docs/verify-ai-agents" className="underline">
            checklist to verify an AI agent
          </Link>
          .
        </p>
      </article>
    </main>
  );
}
