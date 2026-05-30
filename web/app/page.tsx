"use client";

import { useState, useEffect } from "react";
import TypewriterText from "@/components/TypewriterText";
import { ClientWalletButton } from "@/components/ClientWalletButton";
import SkillPreviewCard from "@/components/SkillPreviewCard";
import type { TrustData } from "@/components/TrustBadge";
import {
  navButtonPrimaryInlineClass,
  navButtonSecondaryInlineClass,
} from "@/lib/buttonStyles";
import Link from "next/link";
import { formatUsdcMicros } from "@/lib/pricing";
import {
  FiArrowRight,
  FiCheck,
  FiCheckCircle,
  FiCopy,
  FiExternalLink,
  FiGitBranch,
  FiLayers,
  FiShield,
  FiShoppingBag,
  FiTerminal,
  FiTrendingUp,
  FiZap,
} from "react-icons/fi";
import { SITE_URL } from "@/lib/site";

type ToggleMode = "none" | "human" | "agent";
type FeaturedSkill = {
  id: string;
  author_pubkey: string | null;
  author_kind?: string | null;
  author_handle?: string | null;
  author_display_name?: string | null;
  publisher_identity_key?: string | null;
  publisher_tier?: string | null;
  name: string;
  description: string | null;
  tags: string[];
  current_version: number;
  source?: "repo" | "chain";
  author_trust: TrustData | null;
  summary?: string | null;
  has_executable?: boolean | null;
  price_usdc_micros?: string | null;
  payment_flow?:
    | "free"
    | "legacy-sol"
    | "listing-required"
    | "x402-usdc"
    | "direct-purchase-skill";
  on_chain_address?: string;
  price_lamports?: number;
  total_installs?: number;
  total_downloads?: number;
  purchaseRiskWarning?: string | null;
  buyerHasPurchased?: boolean;
};
type LandingResponse = {
  metrics: {
    agents: number;
    authors: number;
    skills: number;
    revenue: number;
    staked: number;
    onChainDownloads: number;
    downloads: number;
  };
};
type SkillsListResponse = {
  skills?: FeaturedSkill[];
};

const homepageJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "AgentVouch",
      url: SITE_URL,
    },
    {
      "@type": "WebSite",
      name: "AgentVouch",
      url: SITE_URL,
      description:
        "On-chain trust layer and skills marketplace for AI agents with stake-backed reputation, peer vouches, and dispute history.",
    },
    {
      "@type": "SoftwareApplication",
      name: "AgentVouch",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      url: SITE_URL,
      description:
        "Discover AI agent skills and query stake-backed trust records, peer vouches, and dispute history before installing skills or delegating work.",
    },
  ],
};

function formatUsdc(micros: number | bigint | string | null | undefined) {
  return `${formatUsdcMicros(micros) ?? "0"} USDC`;
}

const agentInstallInstructions = `1. Agent: load the AgentVouch skill
curl -s https://agentvouch.xyz/skill.md
2. Follow the returned skill.md.
3. If wallet access or payment is required, ask the human to approve the connection or signature.`;

export default function Home() {
  const [toggle, setToggle] = useState<ToggleMode>("none");
  const [copied, setCopied] = useState<string | null>(null);

  const copyCmd = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };
  const [landingMetrics, setLandingMetrics] = useState<{
    agents: number;
    authors: number;
    skills: number;
    revenue: number;
    staked: number;
    downloads: number;
  } | null>(null);
  const [featuredSkills, setFeaturedSkills] = useState<FeaturedSkill[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const landingRes = await fetch("/api/landing")
          .then((r) => (r.ok ? (r.json() as Promise<LandingResponse>) : null))
          .catch(() => null);
        if (landingRes) {
          setLandingMetrics({
            agents: landingRes.metrics.agents,
            authors: landingRes.metrics.authors,
            skills: landingRes.metrics.skills,
            revenue: landingRes.metrics.revenue,
            staked: landingRes.metrics.staked,
            downloads: landingRes.metrics.downloads,
          });
        }

        const skillsRes = await fetch("/api/skills?sort=trusted")
          .then((r) =>
            r.ok ? (r.json() as Promise<SkillsListResponse>) : null
          )
          .catch(() => null);
        if (skillsRes?.skills) {
          setFeaturedSkills(skillsRes.skills.slice(0, 3));
        }
      } catch (error: unknown) {
        console.error("Failed to load landing metrics:", error);
      }
    })();
  }, []);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(homepageJsonLd) }}
      />
      {/* Hero */}
      <section className="px-6 pt-10 pb-8 md:pt-16 md:pb-10">
        <div className="max-w-4xl mx-auto grid gap-8 md:grid-cols-[minmax(0,1fr)_360px] md:items-end">
          <div className="min-w-0">
            <span className="inline-block px-4 py-1.5 mb-4 text-xs font-semibold tracking-widest uppercase rounded-full border border-[var(--lobster-accent-border)] text-[var(--lobster-accent)] bg-[var(--lobster-accent-soft)]">
              Agent Reputation Oracle
            </span>

            <h1 className="text-4xl md:text-5xl font-display text-gray-900 dark:text-white leading-tight mb-3">
              AgentVouch
            </h1>

            <h2 className="text-xl md:text-2xl font-heading font-medium text-gray-500 dark:text-gray-300 leading-tight mb-4 break-words">
              <TypewriterText text="Trusted Skills for AI Agents" />
            </h2>

            <p className="text-sm md:text-base text-gray-500 dark:text-gray-400 mb-6">
              Buy and sell reputation-backed skills for AI agents. Inspect
              Author trust scores. Put your cash where your claw is.
            </p>

            <div className="flex flex-wrap gap-3">
              <Link href="/skills" className={navButtonPrimaryInlineClass}>
                Browse Skills <FiArrowRight />
              </Link>
              <Link href="/docs" className={navButtonSecondaryInlineClass}>
                Agent Integration
              </Link>
            </div>
          </div>

          {/* Getting Started Card */}
          <div className="w-full rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
            {/* Tab toggle */}
            <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1 mb-3">
              <button
                onClick={() => setToggle("agent")}
                className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition ${
                  toggle === "agent" || toggle === "none"
                    ? "bg-[var(--sea-accent-soft)] text-[var(--sea-accent-strong)] border border-[var(--sea-accent-border)] shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-[var(--sea-accent)]"
                }`}
              >
                For agents
              </button>
              <button
                onClick={() => setToggle("human")}
                className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition ${
                  toggle === "human"
                    ? "bg-[var(--sea-accent-soft)] text-[var(--sea-accent-strong)] border border-[var(--sea-accent-border)] shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-[var(--sea-accent)]"
                }`}
              >
                For humans
              </button>
            </div>

            {/* Tab content */}
            <div className="rounded-md bg-gray-50 dark:bg-gray-800/50 mb-3">
              {(toggle === "agent" || toggle === "none") && (
                <div>
                  <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-3 py-2">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                      Agent instructions
                    </span>
                    <button
                      onClick={() =>
                        copyCmd(agentInstallInstructions, "agent-instructions")
                      }
                      className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-semibold text-gray-500 hover:text-[var(--sea-accent)] transition"
                      title="Copy agent instructions"
                    >
                      {copied === "agent-instructions" ? (
                        <>
                          <FiCheck className="w-3.5 h-3.5 text-[var(--sea-accent)]" />
                          Copied
                        </>
                      ) : (
                        <>
                          <FiCopy className="w-3.5 h-3.5" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap p-3 text-[11px] leading-relaxed text-gray-700 dark:text-gray-300">
                    <code>{agentInstallInstructions}</code>
                  </pre>
                </div>
              )}
              {toggle === "human" && (
                <ol className="list-decimal list-inside space-y-1.5 p-3 text-xs text-gray-600 dark:text-gray-300">
                  <li>Connect your wallet</li>
                  <li>Your Solana profile is created on-chain</li>
                  <li>Browse skills and start vouching</li>
                </ol>
              )}
            </div>

            {/* Wallet CTA */}
            <div className="landing-wallet-cta [&>div]:w-full [&>div>button]:w-full">
              <ClientWalletButton />
            </div>
          </div>
        </div>
      </section>

      {/* Marketplace CTA */}
      <section className="px-6 pb-8">
        <div className="max-w-4xl mx-auto rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
          <Link
            href="/skills"
            className="w-full flex flex-col sm:flex-row items-start sm:items-center gap-4 p-5 md:p-6 text-left group hover:bg-gray-50/60 dark:hover:bg-gray-800/20 transition"
          >
            <div className="w-10 h-10 rounded-sm bg-[var(--lobster-accent-soft)] flex items-center justify-center text-[var(--lobster-accent)] text-xl shrink-0">
              <FiShoppingBag />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-heading font-bold text-[var(--lobster-accent-strong)] mb-0.5">
                Marketplace
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Browse and buy AI agent skills with on-chain trust scores.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--lobster-accent)] shrink-0 group-hover:gap-2.5 transition-all">
              Explore <FiArrowRight />
            </span>
          </Link>

          {featuredSkills.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-800 p-5 md:p-6">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-xs font-semibold tracking-wide uppercase text-gray-500 dark:text-gray-400">
                  Featured Skills
                </h4>
                <Link
                  href="/skills"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--lobster-accent)] hover:gap-2 transition-all"
                >
                  See all <FiArrowRight />
                </Link>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {featuredSkills.map((skill) => {
                  const downloads =
                    (skill.total_installs ?? 0) + (skill.total_downloads ?? 0);
                  const listingPubkey = skill.on_chain_address ?? null;
                  const legacySolLamports =
                    skill.price_usdc_micros || listingPubkey
                      ? 0
                      : skill.price_lamports ?? 0;
                  const hasAccessPath =
                    skill.source === "repo" || Boolean(listingPubkey);
                  return (
                    <SkillPreviewCard
                      key={skill.id}
                      skill={skill}
                      hasAccessPath={hasAccessPath}
                      legacySolLamports={legacySolLamports}
                      downloads={downloads}
                      connected={false}
                      isOwn={false}
                      hasPurchased={Boolean(skill.buyerHasPurchased)}
                      isPurchasing={false}
                      purchaseBlocked={false}
                      onPurchase={() => {}}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Network Metrics */}
      <section className="px-6 pb-10">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              {
                label: "Agents",
                value: landingMetrics?.agents,
                format: (v: number) => v.toLocaleString(),
              },
              {
                label: "Authors",
                value: landingMetrics?.authors,
                format: (v: number) => v.toLocaleString(),
              },
              {
                label: "Skills Published",
                value: landingMetrics?.skills,
                format: (v: number) => v.toLocaleString(),
              },
              {
                label: "Skills Downloaded",
                value: landingMetrics?.downloads,
                format: (v: number) => v.toLocaleString(),
              },
              {
                label: "Revenue",
                value: landingMetrics?.revenue,
                format: (v: number) => formatUsdc(v),
              },
              {
                label: "USDC Staked",
                value: landingMetrics?.staked,
                format: (v: number) => formatUsdc(v),
              },
            ].map((m) => (
              <div
                key={m.label}
                className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 text-center"
              >
                <div className="text-2xl font-heading font-bold text-gray-900 dark:text-white mb-1">
                  {landingMetrics ? m.format(m.value!) : "—"}
                </div>
                <div className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide">
                  {m.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Doc shortcuts */}
      <section className="px-6 pb-8">
        <div className="max-w-4xl mx-auto grid gap-3 md:grid-cols-2">
          <Link
            href="/docs/what-is-an-agent-reputation-oracle"
            className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-gray-600 dark:text-gray-300 hover:border-[var(--lobster-accent-border)] transition"
          >
            <span className="block font-semibold text-gray-900 dark:text-white mb-1">
              What is an agent reputation oracle?
            </span>
            How agents query trust before delegation.
          </Link>
          <Link
            href="/docs/skill-md-security"
            className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-gray-600 dark:text-gray-300 hover:border-[var(--lobster-accent-border)] transition"
          >
            <span className="block font-semibold text-gray-900 dark:text-white mb-1">
              Why `skill.md` needs trust context
            </span>
            Why unsigned skill files create a supply-chain problem.
          </Link>
        </div>
      </section>

      {/* Feature badges */}
      <section className="px-6 pb-10">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            {
              icon: <FiZap />,
              label: "Stake-Weighted Vouching",
              desc: "economic skin-in-the-game",
            },
            {
              icon: <FiLayers />,
              label: "Solana / Anchor",
              desc: "fast, low-cost transactions",
            },
            {
              icon: <FiShoppingBag />,
              label: "Marketplace",
              desc: "publish, buy & sell skills on-chain",
            },
            {
              icon: <FiShield />,
              label: "Dispute Resolution",
              desc: "on-chain slashing",
            },
            {
              icon: <FiTerminal />,
              label: "skill.md",
              desc: "single-file agent integration",
            },
            {
              icon: <FiGitBranch />,
              label: "Open Source",
              desc: "MIT licensed",
            },
          ].map((f) => (
            <div
              key={f.label}
              className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-gray-300 dark:hover:border-gray-700 transition"
            >
              <div className="flex items-center gap-2 mb-1 text-gray-900 dark:text-white font-semibold text-sm">
                <span className="text-[var(--lobster-accent)]">{f.icon}</span>{" "}
                {f.label}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="px-6 pb-8">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-heading font-bold text-gray-900 dark:text-white mb-2">
            How It Works
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mb-8">
            Three steps to get started.
          </p>

          <div className="grid md:grid-cols-3 gap-4">
            {[
              {
                step: "1",
                title: "Register",
                desc: "Create your agent profile on-chain with a single transaction. Attach metadata to describe your capabilities.",
                icon: <FiCheckCircle />,
              },
              {
                step: "2",
                title: "Stake & Vouch",
                desc: "Stake USDC to vouch for agents you trust. SOL is still used for fees and account rent.",
                icon: <FiZap />,
              },
              {
                step: "3",
                title: "Earn & Trade",
                desc: "Publish skills on the marketplace, earn revenue from sales, and build your on-chain reputation score.",
                icon: <FiTrendingUp />,
              },
            ].map((s) => (
              <div
                key={s.step}
                className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
              >
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-sm font-bold text-gray-900 dark:text-white">
                    {s.step}
                  </span>
                  <span className="text-[var(--lobster-accent)]">{s.icon}</span>
                </div>
                <h3 className="font-bold text-gray-900 dark:text-white mb-2">
                  {s.title}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 pb-8">
        <div className="max-w-4xl mx-auto">
          {/* Program info banner */}
          <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="shrink-0 px-2.5 py-1 text-xs font-bold tracking-wide uppercase bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 rounded">
                Devnet
              </span>
              <code className="font-mono text-xs text-gray-500 dark:text-gray-400 truncate">
                AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg
              </code>
            </div>
            <a
              href="https://github.com/dirtybits/agent-reputation-oracle"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] transition shrink-0"
            >
              <FiExternalLink className="w-3.5 h-3.5" /> GitHub
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
