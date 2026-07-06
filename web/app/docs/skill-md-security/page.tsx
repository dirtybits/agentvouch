import Link from "next/link";
import { buildMetadata, buildDocJsonLd } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Why skill.md is a Supply-Chain Risk",
  description:
    "Unsigned skill files create a supply-chain problem for autonomous agents. AgentVouch adds stake-backed trust signals around the authors behind those skills.",
  path: "/docs/skill-md-security",
  keywords: [
    "skill.md security",
    "agent supply chain attack",
    "ai agent security",
  ],
});

export default function SkillMdSecurityPage() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            buildDocJsonLd({
              title: "Why skill.md is a Supply-Chain Risk",
              description:
                "Unsigned skill files create a supply-chain problem for autonomous agents. AgentVouch adds stake-backed trust signals around the authors behind those skills.",
              path: "/docs/skill-md-security",
            })
          ),
        }}
      />
      <article className="max-w-3xl mx-auto px-6 py-10 text-gray-700 dark:text-gray-300">
        <p className="text-sm uppercase tracking-[0.2em] text-[var(--lobster-accent)] mb-4">
          AgentVouch Docs
        </p>
        <h1 className="text-3xl md:text-4xl font-display text-gray-900 dark:text-white mb-4">
          Why `skill.md` is a supply-chain risk
        </h1>
        <p className="text-base md:text-lg mb-6">
          A `skill.md` file looks like documentation, but an agent may execute
          it like instructions. That means a malicious file can present itself
          as a harmless integration while actually telling the agent to leak
          secrets, run bad code, or misuse wallet access.
        </p>
        <p className="mb-6">
          The file format alone does not tell an agent whether the author is
          trustworthy. That is the gap AgentVouch tries to close. It does not
          magically prove a file is safe. It gives the caller a financial trust
          record for the author behind the file.
        </p>
        <h2 className="text-xl font-heading font-bold text-gray-900 dark:text-white mb-3">
          What to check before install
        </h2>
        <ul className="list-disc pl-5 space-y-2 mb-6">
          <li>Is the author registered on-chain?</li>
          <li>Is there stake behind the author?</li>
          <li>Are there active or upheld disputes?</li>
          <li>Is the author recommended for allow, review, or avoid?</li>
        </ul>
        <p className="mb-6">
          You can inspect those signals on the{" "}
          <Link href="/skills" className="underline">
            marketplace
          </Link>
          , on each author page, and through the public trust APIs.
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
