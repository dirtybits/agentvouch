"use client";

import Link from "next/link";
import {
  FiAlertTriangle,
  FiCheck,
  FiCheckCircle,
  FiDownload,
  FiInfo,
  FiShield,
  FiUsers,
} from "react-icons/fi";
import { LiaCoinsSolid } from "react-icons/lia";
import { UsdcIcon } from "@/components/UsdcIcon";
import { SkillIcon } from "@/components/SkillIcon";
import { getAuthorReportStatus, type TrustData } from "@/components/TrustBadge";
import { formatUsdcMicros } from "@/lib/pricing";
import type { PurchasePreflightStatus } from "@/lib/purchasePreflight";

interface SkillPreviewCardSkill {
  id: string;
  author_pubkey: string;
  name: string;
  description: string | null;
  tags: string[];
  current_version: number;
  source?: "repo" | "chain";
  author_trust: TrustData | null;
  price_usdc_micros?: string | null;
  payment_flow?:
    | "free"
    | "legacy-sol"
    | "listing-required"
    | "x402-usdc"
    | "direct-purchase-skill";
  purchasePreflightMessage?: string | null;
  purchaseRiskWarning?: string | null;
  purchaseBlockError?: {
    code:
      | "buyerInsufficientBalance"
      | "buyerMissingUsdcAccount"
      | "authorPayoutRentBlocked";
    message: string;
  } | null;
}

interface SkillPreviewCardProps {
  skill: SkillPreviewCardSkill;
  hasAccessPath: boolean;
  legacySolLamports: number;
  downloads: number;
  connected: boolean;
  isOwn: boolean;
  hasPurchased: boolean;
  isPurchasing: boolean;
  purchaseBlocked: boolean;
  purchasePreflightStatus?: PurchasePreflightStatus;
  descriptionFallback?: string | null;
  onPurchase: () => void;
}

type Verdict = "allow" | "review" | "avoid" | "unknown";

function truncateAtWord(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  const candidate = value.slice(0, maxChars + 1).trimEnd();
  const lastBoundary = candidate.lastIndexOf(" ");
  const trimmed =
    lastBoundary >= Math.floor(maxChars * 0.6)
      ? candidate.slice(0, lastBoundary)
      : candidate.slice(0, maxChars);

  return `${trimmed.trimEnd()}...`;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function formatUsdc(micros: number): string {
  return `${formatUsdcMicros(micros) ?? "0"} USDC`;
}

// Mirrors the server-side getRecommendedAction, with one intentional softening:
// an unregistered author is "unknown" (neutral) here rather than "avoid" — we don't
// scare-flag the open world before an automated scan has anything to say about it.
function getVerdict(trust: TrustData | null): Verdict {
  if (!trust || !trust.isRegistered) return "unknown";
  if (trust.disputesUpheldAgainstAuthor > 0) return "avoid";
  if (trust.activeDisputesAgainstAuthor > 0 || trust.totalStakedFor <= 0) {
    return "review";
  }
  return "allow";
}

interface VerdictMeta {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  chip: string;
  dot: string;
  ring: string;
  title: string;
}

function getVerdictMeta(verdict: Verdict): VerdictMeta {
  switch (verdict) {
    case "allow":
      return {
        label: "Trusted",
        Icon: FiCheck,
        chip: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
        dot: "bg-emerald-500",
        ring: "ring-emerald-400/60",
        title:
          "Registered author with live backing and no upheld or open disputes.",
      };
    case "review":
      return {
        label: "Review",
        Icon: FiAlertTriangle,
        chip: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
        dot: "bg-amber-500",
        ring: "ring-amber-400/60",
        title:
          "Registered, but has an open dispute or no outside backing yet — read before trusting.",
      };
    case "avoid":
      return {
        label: "Flagged",
        Icon: FiAlertTriangle,
        chip: "border-red-300 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
        dot: "bg-red-500",
        ring: "ring-red-400/70",
        title: "Has an upheld dispute against the author.",
      };
    default:
      return {
        label: "Unverified",
        Icon: FiShield,
        chip: "border-gray-300 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400",
        dot: "bg-gray-400",
        ring: "ring-gray-300/70 dark:ring-gray-600/60",
        title: "No registered on-chain trust profile yet.",
      };
  }
}

function VerdictDot({
  verdict,
  meta,
}: {
  verdict: Verdict;
  meta: VerdictMeta;
}) {
  return (
    <span
      className={`flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-white dark:ring-gray-900 ${meta.dot}`}
      title={meta.title}
    >
      {verdict === "allow" ? (
        <FiCheck className="h-2.5 w-2.5 text-white" />
      ) : verdict === "unknown" ? (
        <FiShield className="h-2 w-2 text-white" />
      ) : (
        <FiAlertTriangle className="h-2 w-2 text-white" />
      )}
    </span>
  );
}

interface ActionPill {
  label: string;
  Icon?: React.ComponentType<{ className?: string }>;
  variant: "primary" | "installed" | "muted";
}

function getActionPill(params: {
  isOwn: boolean;
  hasPurchased: boolean;
  isListingRequired: boolean;
  hasUsdcPrimary: boolean;
  hasAccessPath: boolean;
  legacySolLamports: number;
  primaryUsdcPrice: string | null;
}): ActionPill {
  if (params.isOwn) return { label: "Yours", variant: "muted" };
  if (params.hasPurchased) {
    return { label: "Installed", Icon: FiCheckCircle, variant: "installed" };
  }
  if (params.isListingRequired) {
    return { label: "Setup", Icon: FiInfo, variant: "muted" };
  }
  if (params.hasUsdcPrimary) {
    return {
      label: params.primaryUsdcPrice
        ? `${params.primaryUsdcPrice} USDC`
        : "USDC",
      Icon: UsdcIcon,
      variant: "primary",
    };
  }
  if (params.hasAccessPath && params.legacySolLamports === 0) {
    return { label: "Get", Icon: FiDownload, variant: "primary" };
  }
  if (params.legacySolLamports > 0) {
    return { label: "Legacy SOL", variant: "muted" };
  }
  return { label: "View", variant: "muted" };
}

const PILL_VARIANT: Record<ActionPill["variant"], string> = {
  primary:
    "bg-[var(--lobster-accent)] text-white shadow-sm hover:bg-[var(--lobster-accent-strong)]",
  installed:
    "border border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  muted:
    "border border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-400 dark:hover:text-gray-200",
};

export default function SkillPreviewCard({
  skill,
  hasAccessPath,
  legacySolLamports,
  downloads,
  hasPurchased,
  isOwn,
  descriptionFallback,
}: SkillPreviewCardProps) {
  const description = skill.description ?? descriptionFallback ?? "";
  const displayDescription = description
    ? truncateAtWord(description, 80)
    : null;
  const trust = skill.author_trust;
  const verdict = getVerdict(trust);
  const verdictMeta = getVerdictMeta(verdict);
  const primaryUsdcPrice = formatUsdcMicros(skill.price_usdc_micros);
  const isListingRequired = skill.payment_flow === "listing-required";
  const hasUsdcPrimary =
    Boolean(primaryUsdcPrice) ||
    isListingRequired ||
    skill.payment_flow === "x402-usdc" ||
    skill.payment_flow === "direct-purchase-skill";
  const authorReports = trust
    ? getAuthorReportStatus(
        trust.disputesAgainstAuthor,
        trust.disputesUpheldAgainstAuthor,
        trust.activeDisputesAgainstAuthor
      )
    : null;
  const hasDisputeFlag = Boolean(
    authorReports && authorReports.label !== "Clean"
  );

  const pill = getActionPill({
    isOwn,
    hasPurchased,
    isListingRequired,
    hasUsdcPrimary,
    hasAccessPath,
    legacySolLamports,
    primaryUsdcPrice,
  });
  const PillIcon = pill.Icon;
  const registered = Boolean(trust && trust.isRegistered);

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--lobster-accent-border)] hover:shadow-[0_8px_30px_-12px_rgba(217,90,43,0.35)] dark:border-gray-800 dark:bg-gray-900 dark:hover:border-[var(--lobster-accent-border)]">
      {/* verdict accent rail */}
      <span
        className={`absolute inset-y-0 left-0 w-1 ${verdictMeta.dot} opacity-0 transition-opacity duration-200 group-hover:opacity-100`}
        aria-hidden
      />

      <div className="flex flex-1 flex-col p-4">
        {/* Top strip: app icon + action pill */}
        <div className="flex items-start justify-between gap-3">
          <Link
            href={`/skills/${skill.id}`}
            className="transition-transform duration-200 group-hover:scale-[1.03]"
            aria-label={skill.name}
          >
            <SkillIcon
              seed={skill.author_pubkey}
              size={40}
              ringClass={verdictMeta.ring}
              badge={<VerdictDot verdict={verdict} meta={verdictMeta} />}
            />
          </Link>

          <Link
            href={`/skills/${skill.id}`}
            className={`mt-0.5 shrink-0 inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider transition ${
              PILL_VARIANT[pill.variant]
            }`}
            title={
              isListingRequired ? "Paid skill setup is incomplete" : pill.label
            }
          >
            {PillIcon && <PillIcon className="h-3.5 w-3.5" />}
            {pill.label}
          </Link>
        </div>

        {/* Title (hero — full width, up to two lines) + author */}
        <div className="mt-3">
          <Link
            href={`/skills/${skill.id}`}
            className="block font-heading text-[18px] font-bold leading-snug text-gray-900 line-clamp-2 break-words transition group-hover:text-[var(--lobster-accent)] dark:text-white"
            title={skill.name}
          >
            {skill.name}
          </Link>
          <div className="mt-1 flex items-center gap-1.5">
            <Link
              href={`/author/${skill.author_pubkey}`}
              className="truncate font-mono text-[11px] text-[var(--sea-accent)] transition hover:text-[var(--sea-accent-strong)] hover:underline"
              title="Author wallet that published this skill"
            >
              {shortAddr(skill.author_pubkey)}
            </Link>
            {skill.source !== "chain" && (
              <span
                className="shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-500"
                title={`Current repo version: v${skill.current_version}`}
              >
                · v{skill.current_version}
              </span>
            )}
          </div>
        </div>

        {/* Description */}
        {displayDescription && (
          <p
            className="mt-3 line-clamp-2 min-h-[2.5rem] text-[13px] leading-5 text-gray-500 dark:text-gray-400"
            title={description}
          >
            {displayDescription}
          </p>
        )}

        {/* One trust line — the App Store rating, translated to skin-in-the-game.
            Full backing/self/aggregate breakdown lives on the skill detail page. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${verdictMeta.chip}`}
            title={verdictMeta.title}
          >
            <verdictMeta.Icon className="h-3 w-3" />
            {verdictMeta.label}
          </span>
          {registered && trust ? (
            <>
              <span
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-600 dark:text-emerald-400"
                title="Reputation combines public backing, endorsements, and dispute history."
              >
                <FiShield className="h-3.5 w-3.5" />
                {trust.reputationScore.toLocaleString("en-US")}
              </span>
              <span
                className="inline-flex items-center gap-1 text-[12px] text-gray-500 dark:text-gray-400"
                title="Total stake at risk — outside backing plus the author's own first-loss bond."
              >
                <LiaCoinsSolid className="h-3.5 w-3.5" />
                {formatUsdc(trust.totalStakeAtRisk)}
              </span>
              <span
                className="inline-flex items-center gap-1 text-[12px] text-gray-500 dark:text-gray-400"
                title="Vouches are outside endorsements staked behind the author."
              >
                <FiUsers className="h-3.5 w-3.5" />
                {trust.totalVouchesReceived.toLocaleString("en-US")}
              </span>
              {hasDisputeFlag && authorReports && (
                <span
                  className={`inline-flex items-center gap-1 text-[12px] font-medium ${authorReports.color}`}
                  title="Current or historical dispute status against this author."
                >
                  <FiAlertTriangle className="h-3.5 w-3.5" />
                  {authorReports.label}
                </span>
              )}
            </>
          ) : (
            <span className="text-[12px] text-gray-400 dark:text-gray-500">
              No trust profile yet
            </span>
          )}
        </div>

        {/* Footer: tags · installs, bottom-aligned across the grid */}
        <div className="mt-auto flex items-end justify-between gap-3 pt-3">
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {skill.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-[10px] lowercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                title="Tags summarize the skill's core capabilities."
              >
                {tag}
              </span>
            ))}
          </div>
          <span
            className="shrink-0 inline-flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500"
            title="Successful installs and raw downloads."
          >
            <FiDownload className="h-3 w-3" />
            {downloads.toLocaleString("en-US")}
          </span>
        </div>

        {/* Purchase risk warning */}
        {skill.purchaseRiskWarning &&
          hasUsdcPrimary &&
          !isListingRequired &&
          !hasPurchased && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              <FiInfo className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{skill.purchaseRiskWarning}</span>
            </div>
          )}
      </div>
    </article>
  );
}
