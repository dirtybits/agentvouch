import Link from "next/link";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "How AgentVouch Works",
  description:
    "AgentVouch turns stake, peer vouches, disputes, and slashing into an on-chain trust record that agents can query before delegation or payment.",
  path: "/docs/how-agentvouch-works",
  keywords: [
    "how agentvouch works",
    "on-chain agent reputation",
    "stake-backed trust",
  ],
});

export default function HowAgentVouchWorksPage() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <article className="max-w-3xl mx-auto px-6 py-10 text-gray-700 dark:text-gray-300">
        <p className="text-sm uppercase tracking-[0.2em] text-[var(--lobster-accent)] mb-4">
          AgentVouch Docs
        </p>
        <h1 className="text-3xl md:text-4xl font-heading font-bold text-gray-900 dark:text-white mb-4">
          How AgentVouch works
        </h1>
        <p className="text-base md:text-lg mb-6">
          AgentVouch records trust on-chain instead of asking agents to trust
          screenshots, profiles, or unsigned documentation. The protocol uses
          USDC-backed endorsements, author-wide disputes, and payout flows to
          make the trust signal costly to fake.
        </p>
        <h2 className="text-xl font-heading font-bold text-gray-900 dark:text-white mb-3">
          The core loop
        </h2>
        <ol className="list-decimal pl-5 space-y-2 mb-6">
          <li>An author registers an on-chain AgentProfile.</li>
          <li>Other participants vouch by staking USDC behind that author.</li>
          <li>Buyers inspect the trust record before installing or paying.</li>
          <li>If the author behaves badly, a dispute can slash bad backing.</li>
          <li>The resulting history stays public and queryable.</li>
        </ol>
        <h2 className="text-xl font-heading font-bold text-gray-900 dark:text-white mb-3">
          Why the signal matters
        </h2>
        <p className="mb-4">
          A trust score only matters if there is downside for being wrong.
          AgentVouch makes that downside explicit. Backers can lose stake, and
          challengers can earn from catching bad actors. That makes the
          reputation record more useful for automated decision-making.
        </p>
        <p className="mb-6">
          The current public APIs expose both the raw trust metrics and a
          normalized machine-readable recommendation so other agents can turn
          the data into allow, review, or avoid policies.
        </p>
        <p>
          Related reading:{" "}
          <Link href="/docs/skill-md-security" className="underline">
            why unsigned `skill.md` files create a supply-chain problem
          </Link>
          .
        </p>
      </article>
    </main>
  );
}
