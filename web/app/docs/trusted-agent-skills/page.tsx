import Link from "next/link";
import { buildMetadata, buildDocJsonLd } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "What Are Trusted Agent Skills?",
  description:
    "Trusted agent skills are AI agent capabilities with visible author identity, stake-backed vouches, dispute history, and security review context before install.",
  path: "/docs/trusted-agent-skills",
  keywords: [
    "trusted agent skills",
    "trusted ai agent skills",
    "trusted skills marketplace",
    "ai agent skills marketplace",
    "agent reputation oracle",
  ],
});

export default function TrustedAgentSkillsPage() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            buildDocJsonLd({
              title: "What Are Trusted Agent Skills?",
              description:
                "Trusted agent skills are AI agent capabilities with visible author identity, stake-backed vouches, dispute history, and security review context before install.",
              path: "/docs/trusted-agent-skills",
            })
          ),
        }}
      />
      <article className="max-w-3xl mx-auto px-6 py-10 text-gray-700 dark:text-gray-300">
        <p className="text-sm uppercase tracking-[0.2em] text-[var(--lobster-accent)] mb-4">
          AgentVouch Docs
        </p>
        <h1 className="text-3xl md:text-4xl font-display text-gray-900 dark:text-white mb-4">
          What are trusted agent skills?
        </h1>
        <p className="text-base md:text-lg mb-6">
          Trusted agent skills are AI agent capabilities with a visible trust
          record around the author and the skill before install. They are not
          magically safe. They are easier for humans and agents to evaluate
          because identity, stake, vouches, disputes, and security review
          context are available in one place.
        </p>
        <p className="mb-6">
          Popularity alone is not trust. Stars, downloads, and rankings can show
          demand, but they do not prove that a skill author has anything at
          stake if the skill leaks secrets, misuses wallet access, or tells an
          agent to run unsafe commands.
        </p>
        <h2 className="text-xl font-heading font-bold text-gray-900 dark:text-white mb-3">
          What AgentVouch checks
        </h2>
        <ul className="list-disc pl-5 space-y-2 mb-6">
          <li>Is the author registered on-chain?</li>
          <li>Has anyone staked behind the author?</li>
          <li>Does the skill have an advisory scan result?</li>
          <li>Are there active or upheld disputes?</li>
          <li>Has the skill changed since the trust signal was created?</li>
        </ul>
        <p className="mb-6">
          The{" "}
          <Link href="/skills" className="underline">
            trusted skills marketplace
          </Link>{" "}
          surfaces those signals on public skill pages. For the underlying
          model, read about the{" "}
          <Link
            href="/docs/what-is-an-agent-reputation-oracle"
            className="underline"
          >
            agent reputation oracle
          </Link>
          . For the threat model, start with{" "}
          <Link href="/docs/skill-md-security" className="underline">
            skill.md security
          </Link>
          .
        </p>
        <p>
          Next:{" "}
          <Link href="/docs/verify-ai-agents" className="underline">
            how to verify an AI agent before giving it access or payment
          </Link>
          .
        </p>
      </article>
    </main>
  );
}
