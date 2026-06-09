import { headers } from "next/headers";
import Link from "next/link";
import TypewriterText from "@/components/TypewriterText";
import { HomeInstallCard } from "@/components/HomeInstallCard";
import SkillPreviewCard from "@/components/SkillPreviewCard";
import type { TrustData } from "@/components/TrustBadge";
import {
  navButtonPrimaryInlineClass,
  navButtonSecondaryInlineClass,
} from "@/lib/buttonStyles";
import { formatUsdcMicros } from "@/lib/pricing";
import {
  FiArrowRight,
  FiCheckCircle,
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
import type { SkillSecurityScan } from "@/lib/securityScan";

type FeaturedSkill = {
  id: string;
  public_slug?: string | null;
  skill_id?: string | null;
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
  security_scan?: SkillSecurityScan | null;
  price_usdc_micros?: string | null;
  payment_flow?:
    | "free"
    | "legacy-sol"
    | "listing-required"
    | "x402-usdc"
    | "direct-purchase-skill";
  on_chain_address?: string | null;
  price_lamports?: number | null;
  total_installs?: number | null;
  total_downloads?: number | null;
  purchaseRiskWarning?: string | null;
  buyerHasPurchased?: boolean;
};

type LandingMetrics = {
  agents: number;
  authors: number;
  skills: number;
  revenue: number;
  staked: number;
  onChainDownloads: number;
  downloads: number;
};

type LandingResponse = {
  metrics: LandingMetrics;
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

function formatUsdcMetric(micros: number | bigint | string | null | undefined) {
  return formatUsdcMicros(micros) ?? "0";
}

async function getRequestOrigin() {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const host = forwardedHost ?? requestHeaders.get("host");

  if (!host) {
    return SITE_URL;
  }

  const forwardedProto = requestHeaders.get("x-forwarded-proto");
  const proto =
    forwardedProto ??
    (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");

  return `${proto}://${host}`;
}

async function fetchHomepageJson<T>(
  origin: string,
  path: string
): Promise<T | null> {
  try {
    const response = await fetch(`${origin}${path}`, {
      next: { revalidate: 30 },
    });
    return response.ok ? ((await response.json()) as T) : null;
  } catch (error) {
    console.error(`Failed to load homepage data from ${path}:`, error);
    return null;
  }
}

export default async function Home() {
  const origin = await getRequestOrigin();
  const [landingRes, skillsRes] = await Promise.all([
    fetchHomepageJson<LandingResponse>(origin, "/api/landing"),
    fetchHomepageJson<SkillsListResponse>(
      origin,
      "/api/skills?sort=trusted&mode=fast&pageSize=3"
    ),
  ]);
  const landingMetrics = landingRes?.metrics ?? null;
  const featuredSkills = skillsRes?.skills?.slice(0, 3) ?? [];

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(homepageJsonLd) }}
      />

      <section className="px-6 pt-12 pb-10 md:pt-16 md:pb-12">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center">
          <div className="flex min-w-0 flex-col items-start gap-3">
            <span className="inline-block rounded-full border border-[var(--lobster-accent-border)] bg-[var(--lobster-accent-soft)] px-4 py-1.5 text-xs font-normal uppercase tracking-widest text-[var(--lobster-accent)]">
              Agent Reputation Oracle
            </span>

            <h1 className="font-display text-5xl leading-none text-gray-900 dark:text-white md:text-[68px] md:leading-[0.98]">
              AgentVouch
            </h1>

            <h2 className="min-h-[2rem] break-words font-display text-xl leading-tight text-gray-500 dark:text-gray-300 md:text-2xl">
              <TypewriterText text="Trusted Skills for AI Agents" />
            </h2>

            <p className="max-w-[52ch] text-xs leading-5 text-gray-500 dark:text-gray-400 md:text-sm">
              Buy and sell reputation-backed skills for AI agents. Inspect
              Author trust scores. Put your cash where your claw is.
            </p>

            <div className="mt-1 flex flex-wrap gap-3">
              <Link href="/skills" className={navButtonPrimaryInlineClass}>
                Browse Skills <FiArrowRight />
              </Link>
              <Link href="/docs" className={navButtonSecondaryInlineClass}>
                Agent Integration
              </Link>
            </div>
          </div>

          <HomeInstallCard />
        </div>
      </section>

      {featuredSkills.length > 0 && (
        <section className="px-6 pb-10">
          <div className="mx-auto max-w-6xl">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-display text-2xl text-gray-900 dark:text-white md:text-[28px]">
                Featured skills
              </h2>
              <Link
                href="/skills"
                className="font-display text-[15px] text-[var(--lobster-accent)] transition hover:text-[var(--lobster-accent-strong)] md:text-[17px]"
              >
                See all →
              </Link>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
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
                  />
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section className="px-6 pb-10">
        <div className="mx-auto max-w-6xl">
          <div className="rounded-sm border border-gray-200 bg-white px-4 py-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="grid grid-cols-2 gap-y-6 md:grid-cols-3 lg:grid-cols-6">
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
                  label: "Skills",
                  value: landingMetrics?.skills,
                  format: (v: number) => v.toLocaleString(),
                },
                {
                  label: "USDC Revenue",
                  value: landingMetrics?.revenue,
                  format: (v: number) => formatUsdcMetric(v),
                  accent: true,
                },
                {
                  label: "USDC Staked",
                  value: landingMetrics?.staked,
                  format: (v: number) => formatUsdcMetric(v),
                  accent: true,
                },
                {
                  label: "Downloads",
                  value: landingMetrics?.downloads,
                  format: (v: number) => v.toLocaleString(),
                },
              ].map((m) => (
                <div key={m.label} className="px-3 text-center">
                  <div
                    className={`mb-1 font-display text-3xl leading-none ${
                      m.accent
                        ? "text-[var(--lobster-accent)]"
                        : "text-gray-900 dark:text-white"
                    }`}
                  >
                    {landingMetrics && m.value !== undefined
                      ? m.format(m.value)
                      : "—"}
                  </div>
                  <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-gray-400 dark:text-gray-500">
                    {m.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 pb-8">
        <div className="mx-auto grid max-w-6xl gap-3 md:grid-cols-3">
          <Link
            href="/docs/trusted-agent-skills"
            className="rounded-sm border border-gray-200 bg-white px-4 py-3 text-xs text-gray-600 transition hover:border-[var(--lobster-accent-border)] dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
          >
            <span className="mb-1 block font-display text-base text-gray-900 dark:text-white">
              What are trusted agent skills?
            </span>
            How skills carry install-time trust context.
          </Link>
          <Link
            href="/docs/what-is-an-agent-reputation-oracle"
            className="rounded-sm border border-gray-200 bg-white px-4 py-3 text-xs text-gray-600 transition hover:border-[var(--lobster-accent-border)] dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
          >
            <span className="mb-1 block font-display text-base text-gray-900 dark:text-white">
              What is an agent reputation oracle?
            </span>
            How agents query trust before delegation.
          </Link>
          <Link
            href="/docs/skill-md-security"
            className="rounded-sm border border-gray-200 bg-white px-4 py-3 text-xs text-gray-600 transition hover:border-[var(--lobster-accent-border)] dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
          >
            <span className="mb-1 block font-display text-base text-gray-900 dark:text-white">
              Why skill.md security matters
            </span>
            Why unsigned skill files create a supply-chain problem.
          </Link>
        </div>
      </section>

      <section className="px-6 pb-10">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-3 md:grid-cols-3">
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
              className="rounded-sm border border-gray-200 bg-white p-4 transition hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
            >
              <div className="mb-1 flex items-center gap-2 font-display text-[15px] text-gray-900 dark:text-white">
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

      <section className="px-6 pb-8">
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-2 font-display text-2xl text-gray-900 dark:text-white md:text-3xl">
            How it works
          </h2>
          <p className="mb-8 text-gray-500 dark:text-gray-400">
            Three steps to get started.
          </p>

          <div className="grid gap-4 md:grid-cols-3">
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
                className="rounded-sm border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
              >
                <div className="mb-3 flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-sm font-bold text-gray-900 dark:bg-gray-800 dark:text-white">
                    {s.step}
                  </span>
                  <span className="text-[var(--lobster-accent)]">{s.icon}</span>
                </div>
                <h3 className="mb-2 font-display text-lg text-gray-900 dark:text-white">
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
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col justify-between gap-3 rounded-sm border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 sm:flex-row sm:items-center">
            <div className="flex min-w-0 items-center gap-3">
              <span className="shrink-0 rounded bg-green-100 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-green-700 dark:bg-green-900/40 dark:text-green-400">
                Devnet
              </span>
              <code className="truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg
              </code>
            </div>
            <a
              href="https://github.com/dirtybits/agent-reputation-oracle"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-[var(--sea-accent)] transition hover:text-[var(--sea-accent-strong)]"
            >
              <FiExternalLink className="h-3.5 w-3.5" /> GitHub
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
