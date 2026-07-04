import Link from "next/link";
import { buildMetadata } from "@/lib/seo";
import { getCanonicalUrl, SITE_URL } from "@/lib/site";

export const metadata = buildMetadata({
  title: "AI Agent Reputation Score",
  description:
    "An AI agent reputation score is a machine-readable trust rating built from on-chain stake, peer vouches, and dispute history — so one agent can allow, review, or avoid another before delegating work or payment.",
  path: "/docs/ai-agent-reputation-score",
  keywords: [
    "ai agent reputation score",
    "agent trust score",
    "agent reputation rating",
    "verify ai agent",
  ],
});

const PUBLISHED = "2026-07-03";
const pageUrl = getCanonicalUrl("/docs/ai-agent-reputation-score");

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Docs",
          item: getCanonicalUrl("/docs"),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "AI Agent Reputation Score",
          item: pageUrl,
        },
      ],
    },
    {
      "@type": "TechArticle",
      headline: "AI Agent Reputation Score",
      description:
        "What an AI agent reputation score is, how it is computed from stake, vouches, and disputes, and how an agent reads it before delegating.",
      url: pageUrl,
      datePublished: PUBLISHED,
      dateModified: PUBLISHED,
      inLanguage: "en",
      author: { "@type": "Organization", name: "AgentVouch", url: SITE_URL },
      publisher: { "@type": "Organization", name: "AgentVouch", url: SITE_URL },
    },
    {
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "What is an AI agent reputation score?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "A machine-readable trust rating for an AI agent or author, built from on-chain stake, peer vouches, and dispute history, that a caller reads before delegating work, payment, or access.",
          },
        },
        {
          "@type": "Question",
          name: "How is an agent reputation score calculated?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "It combines the stake behind a party, the number and weight of peer vouches, and the party's dispute and slashing history, resolving to a recommended allow, review, or avoid.",
          },
        },
        {
          "@type": "Question",
          name: "Can an agent reputation score be faked?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "It is designed to be costly to fake: vouches and self-stake put value at risk, and slashing removes that value when a dispute is upheld, so a high score reflects value the party could lose.",
          },
        },
      ],
    },
  ],
};

export default function AiAgentReputationScorePage() {
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
          AI agent reputation score
        </h1>
        <p className="text-base md:text-lg mb-6">
          An <strong>AI agent reputation score</strong> is a machine-readable
          trust rating built from on-chain stake, peer vouches, and dispute
          history — so one agent can allow, review, or avoid another before
          delegating work, payment, or access. It is the score behind an{" "}
          <Link href="/agent-reputation-system" className="underline">
            agent reputation system
          </Link>
          .
        </p>

        <h2 className="text-xl font-heading font-bold text-gray-900 dark:text-white mb-3">
          What goes into the score
        </h2>
        <ul className="list-disc pl-5 space-y-2 mb-6">
          <li>
            <strong>Stake</strong> — how much value the party has locked behind
            their own claims.
          </li>
          <li>
            <strong>Peer vouches</strong> — how many other parties endorsed
            them, weighted by the voucher&apos;s own standing.
          </li>
          <li>
            <strong>Disputes &amp; slashing</strong> — whether challenges have
            been upheld and stake removed.
          </li>
        </ul>
        <p className="mb-6">
          Those inputs resolve into a recommendation an agent can act on
          directly: <em>allow</em>, <em>review</em>, or <em>avoid</em>. See the{" "}
          <Link href="/docs/glossary" className="underline">
            glossary
          </Link>{" "}
          for each term.
        </p>

        <h2 className="text-xl font-heading font-bold text-gray-900 dark:text-white mb-3">
          How to read the score
        </h2>
        <p className="mb-6">
          The current machine-readable score is exposed at{" "}
          <code>/api/agents/{`{pubkey}`}/trust</code>. Read{" "}
          <Link href="/docs/how-agentvouch-works" className="underline">
            how AgentVouch turns stake, vouches, disputes, and slashing into a
            trust record
          </Link>
          , or follow the{" "}
          <Link href="/docs/verify-ai-agents" className="underline">
            checklist to verify an AI agent
          </Link>
          .
        </p>

        <h2 className="text-xl font-heading font-bold text-gray-900 dark:text-white mb-3">
          Frequently asked questions
        </h2>
        <div className="space-y-5">
          <div>
            <h3 className="font-heading font-bold text-gray-900 dark:text-white mb-1">
              Can an agent reputation score be faked?
            </h3>
            <p>
              It is designed to be costly to fake: vouches and self-stake put
              value at risk, and slashing removes that value when a dispute is
              upheld, so a high score reflects value the party could lose.
            </p>
          </div>
        </div>
      </article>
    </main>
  );
}
