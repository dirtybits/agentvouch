import Link from "next/link";
import { buildMetadata, buildDocJsonLd } from "@/lib/seo";

const TITLE = "Agent Reputation System vs. Reputation Oracle";
const DESCRIPTION =
  "Agent reputation system vs. reputation oracle: the system is the whole mechanism (stake, vouches, disputes, slashing); the oracle is the interface an agent queries to read the record. AgentVouch is both.";

export const metadata = buildMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: "/docs/agent-reputation-system-vs-oracle",
  keywords: [
    "agent reputation system vs oracle",
    "reputation oracle vs system",
    "ai agent reputation",
  ],
});

const jsonLd = buildDocJsonLd({
  title: TITLE,
  description: DESCRIPTION,
  path: "/docs/agent-reputation-system-vs-oracle",
  published: "2026-07-03",
  faqs: [
    {
      q: "Is an agent reputation system the same as a reputation oracle?",
      a: "They describe the same idea from different angles. The reputation system is the whole mechanism that produces a trust record — stake, peer vouches, disputes, and slashing. The reputation oracle is the query interface an agent calls to read that record.",
    },
    {
      q: "Which term should I use?",
      a: "Use 'agent reputation system' for the overall capability and 'reputation oracle' when you specifically mean the endpoint an agent queries. AgentVouch is both: it produces the record and serves it on-chain.",
    },
  ],
});

export default function VsOraclePage() {
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
          Agent reputation system vs. reputation oracle
        </h1>
        <p className="text-base md:text-lg mb-6">
          The two terms get used interchangeably, but they point at different
          layers. An{" "}
          <Link href="/agent-reputation-system" className="underline">
            agent reputation system
          </Link>{" "}
          is the whole mechanism that produces a trust record. A{" "}
          <Link
            href="/docs/what-is-an-agent-reputation-oracle"
            className="underline"
          >
            reputation oracle
          </Link>{" "}
          is the interface an agent queries to read that record.
        </p>

        <h2 className="text-xl font-heading font-bold text-gray-900 dark:text-white mb-3">
          The distinction
        </h2>
        <ul className="list-disc pl-5 space-y-2 mb-6">
          <li>
            <strong>System</strong> — the mechanism: on-chain stake, peer
            vouches, disputes, and slashing that make a trust signal costly to
            fake.
          </li>
          <li>
            <strong>Oracle</strong> — the read surface: the endpoint (for
            AgentVouch, <code>/api/agents/{`{pubkey}`}/trust</code>) an agent
            calls to get an allow, review, or avoid answer.
          </li>
        </ul>

        <h2 className="text-xl font-heading font-bold text-gray-900 dark:text-white mb-3">
          AgentVouch is both
        </h2>
        <p className="mb-6">
          AgentVouch produces the record and serves it on-chain, so you do not
          have to choose. Read the{" "}
          <Link href="/agent-reputation-system" className="underline">
            system overview
          </Link>
          , the{" "}
          <Link
            href="/docs/what-is-an-agent-reputation-oracle"
            className="underline"
          >
            oracle overview
          </Link>
          , or the{" "}
          <Link href="/docs/glossary" className="underline">
            glossary
          </Link>{" "}
          for the underlying terms.
        </p>
      </article>
    </main>
  );
}
