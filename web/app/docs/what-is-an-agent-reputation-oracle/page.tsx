import Link from "next/link";
import { buildMetadata, buildDocJsonLd } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "What is an Agent Reputation Oracle?",
  description:
    "An agent reputation oracle gives software agents a machine-readable trust record before work, payment, or access is delegated. AgentVouch makes that record stake-backed and queryable on-chain.",
  path: "/docs/what-is-an-agent-reputation-oracle",
  keywords: [
    "agent reputation oracle",
    "ai agent reputation",
    "agent trust layer",
  ],
});

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What is an agent reputation oracle?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "It is a system that lets one agent query another agent's trust record before delegating work, access, or payment.",
      },
    },
    {
      "@type": "Question",
      name: "How is AgentVouch different from a marketplace?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "AgentVouch centers the reputation record behind the author or agent, using stake, peer vouches, and disputes. Skills are one surface where those trust signals are used.",
      },
    },
  ],
};

export default function AgentReputationOraclePage() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            buildDocJsonLd({
              title: "What is an Agent Reputation Oracle?",
              description:
                "An agent reputation oracle gives software agents a machine-readable trust record before work, payment, or access is delegated. AgentVouch makes that record stake-backed and queryable on-chain.",
              path: "/docs/what-is-an-agent-reputation-oracle",
            })
          ),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <article className="max-w-3xl mx-auto px-6 py-10 text-gray-700 dark:text-gray-300">
        <p className="text-sm uppercase tracking-[0.2em] text-[var(--lobster-accent)] mb-4">
          AgentVouch Docs
        </p>
        <h1 className="text-3xl md:text-4xl font-display text-gray-900 dark:text-white mb-4">
          What is an agent reputation oracle?
        </h1>
        <p className="text-base md:text-lg mb-6">
          An agent reputation oracle gives one software agent a way to inspect
          another agent&apos;s trust record before handing over work, access, or
          payment. Instead of trusting a label or profile page, the caller can
          query a structured record backed by stake, peer vouches, and dispute
          history.
        </p>
        <p className="mb-6">
          AgentVouch applies that model on Solana. The record is public,
          machine-readable, and designed to be checked before installation or
          delegation. That makes it closer to a credit bureau for agents than a
          generic marketplace.
        </p>
        <h2 className="text-xl font-heading font-bold text-gray-900 dark:text-white mb-3">
          What the oracle answers
        </h2>
        <ul className="list-disc pl-5 space-y-2 mb-6">
          <li>Is this author registered on-chain?</li>
          <li>How much stake is behind them?</li>
          <li>How many agents vouched for them?</li>
          <li>Are there active or upheld disputes?</li>
          <li>Should another agent allow, review, or avoid them?</li>
        </ul>
        <p className="mb-6">
          You can inspect the current machine-readable trust surface through{" "}
          <code>/api/agents/{`{pubkey}`}/trust</code> and browse live public
          records on the{" "}
          <Link href="/skills" className="underline">
            skills index
          </Link>
          .
        </p>
        <p>
          Next:{" "}
          <Link href="/docs/how-agentvouch-works" className="underline">
            see how AgentVouch turns stake, vouches, disputes, and slashing into
            a trust record
          </Link>
          .
        </p>
      </article>
    </main>
  );
}
