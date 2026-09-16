import Link from "next/link";
import { FeaturedSkillsCarousel } from "@/components/FeaturedSkillsCarousel";
import TypewriterText from "@/components/TypewriterText";
import { HomeInstallCard } from "@/components/HomeInstallCard";
import SkillPreviewCard from "@/components/SkillPreviewCard";
import SkillSearchBar from "@/components/SkillSearchBar";
import {
  navButtonPrimaryInlineClass,
  navButtonSecondaryInlineClass,
} from "@/lib/buttonStyles";
import { loadLandingPayload } from "@/lib/landingPayload";
import { loadMarketplaceBrowseSnapshot } from "@/lib/marketplaceBrowse";
import { formatUsdcMicros } from "@/lib/pricing";
import {
  FiArrowRight,
  FiCheckCircle,
  FiExternalLink,
  FiTrendingUp,
  FiZap,
} from "react-icons/fi";
import { HOME_FAQS, homepageJsonLd } from "@/lib/homeSeo";

// Static so `/` is CDN-cached and revalidated in the background, like
// `/skills` (see perf/fix-marketplace-evm-hydration). Keep data loading on
// shared server loaders instead of `headers()` or same-origin HTTP fetches,
// which would force dynamic rendering or depend on deployment URL resolution.
export const revalidate = 30;

function formatUsdcMetric(micros: number | bigint | string | null | undefined) {
  return formatUsdcMicros(micros) ?? "0";
}

export default async function Home() {
  const [landingMetrics, skillsSnapshot] = await Promise.all([
    loadLandingPayload()
      .then(({ payload }) => payload.metrics)
      .catch((error) => {
        console.error("Failed to load homepage metrics:", error);
        return null;
      }),
    loadMarketplaceBrowseSnapshot({ pageSize: 3 }),
  ]);
  const featuredSkills = skillsSnapshot?.skills ?? [];

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(homepageJsonLd) }}
      />

      <section className="px-6 pt-12 pb-10 md:pt-16 md:pb-12">
        <div className="mx-auto grid w-full min-w-0 grid-cols-1 max-w-6xl gap-10 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center">
          <div className="flex min-w-0 w-full flex-col items-start gap-3">
            <span className="inline-block rounded-full border border-[var(--lobster-accent-border)] bg-[var(--lobster-accent-soft)] px-4 py-1.5 text-xs font-normal uppercase tracking-widest text-[var(--lobster-accent)]">
              Agent Reputation Oracle
            </span>

            <h1 className="home-hero-title font-display text-5xl leading-none text-gray-900 dark:text-white md:text-[68px] md:leading-[0.98]">
              AgentVouch
            </h1>

            <h2 className="min-h-[2rem] break-words font-body text-xl leading-tight text-gray-500 dark:text-gray-300 md:text-2xl">
              <TypewriterText text="Trusted Skills for AI Agents" />
            </h2>

            <p className="max-w-[52ch] text-xs leading-5 text-gray-500 dark:text-gray-400 md:text-sm">
              AgentVouch is an{" "}
              <Link
                href="/agent-reputation-system"
                className="underline decoration-dotted underline-offset-2 hover:text-[var(--lobster-accent)]"
              >
                agent reputation system
              </Link>{" "}
              and AI skills marketplace. Stake USDC to vouch for authors,
              inspect their reputation and dispute history, and find skills for
              your agents.
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
            <div className="mb-6">
              <SkillSearchBar />
            </div>
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-display text-2xl text-gray-900 dark:text-white md:text-[28px]">
                Featured skills
              </h2>
              <Link
                href="/skills"
                className="font-body text-[15px] text-[var(--lobster-accent)] transition hover:text-[var(--lobster-accent-strong)] md:text-[17px]"
              >
                See all →
              </Link>
            </div>
            <FeaturedSkillsCarousel>
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
                    hasPurchased={false}
                    isPurchasing={false}
                    purchaseBlocked={false}
                  />
                );
              })}
            </FeaturedSkillsCarousel>
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
                    className={`mb-1 font-body text-3xl leading-none ${
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
            <span className="mb-1 block font-body text-base text-gray-900 dark:text-white">
              What are trusted agent skills?
            </span>
            How skills carry install-time trust context.
          </Link>
          <Link
            href="/docs/what-is-an-agent-reputation-oracle"
            className="rounded-sm border border-gray-200 bg-white px-4 py-3 text-xs text-gray-600 transition hover:border-[var(--lobster-accent-border)] dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
          >
            <span className="mb-1 block font-body text-base text-gray-900 dark:text-white">
              What is an agent reputation oracle?
            </span>
            How agents query trust before delegation.
          </Link>
          <Link
            href="/docs/skill-md-security"
            className="rounded-sm border border-gray-200 bg-white px-4 py-3 text-xs text-gray-600 transition hover:border-[var(--lobster-accent-border)] dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
          >
            <span className="mb-1 block font-body text-base text-gray-900 dark:text-white">
              Why skill.md security matters
            </span>
            Why unsigned skill files create a supply-chain problem.
          </Link>
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
                desc: "Stake USDC behind authors you trust. Inspect their vouches and dispute history before installing a skill.",
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

      <section className="px-6 py-8" aria-labelledby="home-faq-heading">
        <div className="mx-auto max-w-6xl">
          <h2
            id="home-faq-heading"
            className="mb-6 font-display text-2xl text-gray-900 dark:text-white md:text-3xl"
          >
            About AgentVouch
          </h2>
          <div className="grid gap-6 md:grid-cols-3">
            {HOME_FAQS.map(({ question, answer }) => (
              <div key={question}>
                <h3 className="mb-2 font-display text-lg text-gray-900 dark:text-white">
                  {question}
                </h3>
                <p className="text-sm leading-6 text-gray-600 dark:text-gray-400">
                  {answer}
                </p>
              </div>
            ))}
          </div>
          <Link
            href="/docs/how-agentvouch-works"
            className="mt-6 inline-block text-sm text-[var(--lobster-accent)] hover:underline"
          >
            Learn how USDC-backed reputation works →
          </Link>
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
              href="https://github.com/dirtybits/agentvouch"
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
