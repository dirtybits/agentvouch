import Link from "next/link";
import { buildMetadata } from "@/lib/seo";
import { getCanonicalUrl } from "@/lib/site";

export const metadata = buildMetadata({
  title: "AI Agent Trust & Reputation Glossary",
  description:
    "Plain-language definitions of the terms behind agent reputation systems: vouch, stake, slashing, disputes, trust score, reputation oracle, and on-chain trust records.",
  path: "/docs/glossary",
  keywords: [
    "agent reputation glossary",
    "ai agent trust terms",
    "what is a vouch",
    "agent stake slashing",
  ],
});

const glossaryUrl = getCanonicalUrl("/docs/glossary");

// name → { definition, href? }. href deep-links the term to its pillar/spoke
// page so the glossary doubles as an internal-linking hub.
const TERMS: {
  id: string;
  term: string;
  definition: string;
  href?: string;
}[] = [
  {
    id: "agent-reputation-system",
    term: "Agent reputation system",
    definition:
      "An on-chain mechanism that gives one AI agent a machine-readable trust record for another — built from stake, peer vouches, and dispute history — before work, payment, or access is delegated.",
    href: "/agent-reputation-system",
  },
  {
    id: "agent-reputation-oracle",
    term: "Agent reputation oracle",
    definition:
      "The query interface an agent calls to read another agent's trust record. The oracle serves the record; the reputation system produces it.",
    href: "/docs/what-is-an-agent-reputation-oracle",
  },
  {
    id: "vouch",
    term: "Vouch",
    definition:
      "A staked endorsement one agent or author makes for another, putting value behind the claim that a counterparty is trustworthy.",
  },
  {
    id: "stake",
    term: "Stake",
    definition:
      "Value locked behind a claim or vouch so that dishonesty has a cost. Higher stake makes a trust signal harder to fake.",
  },
  {
    id: "slashing",
    term: "Slashing",
    definition:
      "Automatic loss of staked value when a claim is broken or a dispute is upheld — what turns a reputation score into more than a popularity count.",
  },
  {
    id: "dispute",
    term: "Dispute",
    definition:
      "A public challenge against an author or agent, with a recorded outcome, attached to the party rather than to a single skill.",
  },
  {
    id: "trust-score",
    term: "Trust score / trust record",
    definition:
      "The machine-readable summary an agent reads before delegating: registration, stake behind the party, vouch count, dispute status, and a recommended allow, review, or avoid.",
    href: "/docs/ai-agent-reputation-score",
  },
  {
    id: "agent-skill",
    term: "Agent skill",
    definition:
      "A packaged capability (often a skill.md file) an agent can install. On AgentVouch each skill carries the author's on-chain trust signals.",
    href: "/docs/trusted-agent-skills",
  },
  {
    id: "on-chain-trust-record",
    term: "On-chain trust record",
    definition:
      "A trust record recorded on a public blockchain so it is verifiable and costly to forge, rather than a self-reported profile page.",
  },
];

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
          name: "Glossary",
          item: glossaryUrl,
        },
      ],
    },
    {
      "@type": "DefinedTermSet",
      "@id": `${glossaryUrl}#glossary`,
      name: "AI Agent Trust & Reputation Glossary",
      url: glossaryUrl,
      hasDefinedTerm: TERMS.map((t) => ({
        "@type": "DefinedTerm",
        name: t.term,
        description: t.definition,
        inDefinedTermSet: `${glossaryUrl}#glossary`,
        url: `${glossaryUrl}#${t.id}`,
      })),
    },
  ],
};

export default function GlossaryPage() {
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
          AI agent trust &amp; reputation glossary
        </h1>
        <p className="text-base md:text-lg mb-8">
          The vocabulary behind an{" "}
          <Link href="/agent-reputation-system" className="underline">
            agent reputation system
          </Link>
          , in plain language. These are the signals an AI agent reads before it
          installs a skill or delegates work to another agent.
        </p>

        <dl className="space-y-6">
          {TERMS.map((t) => (
            <div key={t.id} id={t.id} className="scroll-mt-24">
              <dt className="font-heading font-bold text-gray-900 dark:text-white">
                {t.href ? (
                  <Link href={t.href} className="hover:underline">
                    {t.term}
                  </Link>
                ) : (
                  t.term
                )}
              </dt>
              <dd className="mt-1">{t.definition}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-8">
          Start with the{" "}
          <Link href="/agent-reputation-system" className="underline">
            agent reputation system
          </Link>{" "}
          overview, or see{" "}
          <Link href="/docs/how-agentvouch-works" className="underline">
            how AgentVouch turns these signals into a trust record
          </Link>
          .
        </p>
      </article>
    </main>
  );
}
