"use client";

import Link from "next/link";
import {
  FiAlertTriangle,
  FiCheckCircle,
  FiDownload,
  FiExternalLink,
  FiInfo,
  FiShield,
  FiTag,
  FiUser,
  FiUsers,
} from "react-icons/fi";
import { LiaCoinsSolid } from "react-icons/lia";
import { UsdcIcon } from "@/components/UsdcIcon";
import { getAuthorReportStatus, type TrustData } from "@/components/TrustBadge";
import { navButtonFlexClass, navButtonSizeClass } from "@/lib/buttonStyles";
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
  payment_flow?: "free" | "legacy-sol" | "x402-usdc" | "direct-purchase-skill";
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

interface MetricCellProps {
  label: string;
  value: string;
  title: string;
  tone?: "default" | "positive" | "warning" | "danger" | "accent";
  icon: React.ComponentType<{ className?: string }>;
}

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

function getToneClass(tone: MetricCellProps["tone"] = "default"): string {
  switch (tone) {
    case "positive":
      return "text-green-700 dark:text-green-400";
    case "warning":
      return "text-amber-700 dark:text-amber-300";
    case "danger":
      return "text-red-700 dark:text-red-400";
    case "accent":
      return "text-[var(--lobster-accent-strong)]";
    default:
      return "text-gray-900 dark:text-white";
  }
}

function MetricCell({
  label,
  value,
  title,
  tone = "default",
  icon: Icon,
}: MetricCellProps) {
  return (
    <div
      className="flex items-center justify-between gap-3 px-3 py-2"
      title={title}
    >
      <div className="flex min-w-0 items-center gap-2 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <div className={`shrink-0 text-[11px] ${getToneClass(tone)}`}>
        {value}
      </div>
    </div>
  );
}

function AuthorMetricRow({ authorPubkey }: { authorPubkey: string }) {
  return (
    <div
      className="flex items-center justify-between gap-3 px-3 py-2"
      title="Author wallet that published this skill and receives creator proceeds."
    >
      <div className="flex min-w-0 items-center gap-2 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
        <FiUser className="h-3.5 w-3.5" />
        <span>Author</span>
      </div>
      <Link
        href={`/author/${authorPubkey}`}
        className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--sea-accent)] transition hover:text-[var(--sea-accent-strong)] hover:underline"
        title="Author wallet that published this skill and receives creator proceeds."
      >
        <span className="font-mono">{shortAddr(authorPubkey)}</span>
        <FiExternalLink className="h-3 w-3" />
      </Link>
    </div>
  );
}

export default function SkillPreviewCard({
  skill,
  hasAccessPath,
  legacySolLamports,
  downloads,
  connected,
  isOwn,
  hasPurchased,
  descriptionFallback,
}: SkillPreviewCardProps) {
  const displayTitle = truncateAtWord(skill.name, 32);
  const description = skill.description ?? descriptionFallback ?? "";
  const displayDescription = description
    ? truncateAtWord(description, 64)
    : null;
  const trust = skill.author_trust;
  const primaryUsdcPrice = formatUsdcMicros(skill.price_usdc_micros);
  const hasUsdcPrimary =
    Boolean(primaryUsdcPrice) ||
    skill.payment_flow === "x402-usdc" ||
    skill.payment_flow === "direct-purchase-skill";
  const authorReports = trust
    ? getAuthorReportStatus(
        trust.disputesAgainstAuthor,
        trust.disputesUpheldAgainstAuthor,
        trust.activeDisputesAgainstAuthor
      )
    : null;
  const priceTooltip = hasUsdcPrimary
    ? primaryUsdcPrice
      ? `Primary price: ${primaryUsdcPrice} USDC via x402.`
      : "Primary price is settled in USDC via x402."
    : legacySolLamports > 0
    ? "Legacy SOL pricing is no longer a primary purchase path."
    : "No on-chain purchase required.";

  return (
    <div className="group flex flex-col rounded-sm border border-gray-200 bg-white p-4 transition hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700">
      <div className="flex-1">
        <div className="mb-2 flex items-start justify-between gap-3">
          <Link
            href={`/skills/${skill.id}`}
            className="block min-w-0 flex-1 font-heading text-base font-bold text-gray-900 transition group-hover:text-[var(--lobster-accent)] hover:underline dark:text-white"
            title={skill.name}
          >
            {displayTitle}
          </Link>
          {skill.source !== "chain" && (
            <span
              className="shrink-0 rounded-sm border border-[var(--sea-accent-border)] bg-[var(--sea-accent-soft)] px-2 py-0.5 font-mono text-[11px] text-[var(--sea-accent-strong)]"
              title={`Current repo version: v${skill.current_version}`}
            >
              v{skill.current_version}
            </span>
          )}
        </div>

        {displayDescription && (
          <p
            className="mb-3 min-h-[2.5rem] line-clamp-2 text-[13px] leading-5 text-gray-500 dark:text-gray-400"
            title={description}
          >
            {displayDescription}
          </p>
        )}

        {trust && trust.isRegistered ? (
          <div className="divide-y divide-gray-200 dark:divide-gray-800">
            <AuthorMetricRow authorPubkey={skill.author_pubkey} />
            <MetricCell
              label="Reputation"
              value={trust.reputationScore.toLocaleString("en-US")}
              title="Reputation combines public backing, endorsements, and dispute history for the author."
              tone="positive"
              icon={FiShield}
            />
            <MetricCell
              label="Vouches"
              value={trust.totalVouchesReceived.toLocaleString("en-US")}
              title="Vouches are outside endorsements staked behind the author."
              tone="accent"
              icon={FiUsers}
            />
            <MetricCell
              label="Disputes"
              value={authorReports?.label ?? "Clean"}
              title="Disputes show the author's current and historical challenge status."
              tone={
                trust.activeDisputesAgainstAuthor > 0
                  ? "danger"
                  : trust.disputesUpheldAgainstAuthor > 0
                  ? "warning"
                  : "positive"
              }
              icon={FiAlertTriangle}
            />
            <MetricCell
              label="Backing"
              value={formatUsdc(trust.totalStakedFor)}
              title="Backing is the total outside stake currently supporting this author."
              icon={LiaCoinsSolid}
            />
            <MetricCell
              label="Self stake"
              value={formatUsdc(trust.authorBondUsdcMicros)}
              title="Self stake is the author's own first-loss capital."
              icon={FiUser}
            />
            <MetricCell
              label="Downloads"
              value={downloads.toLocaleString("en-US")}
              title="Downloads include successful installs and raw file downloads."
              icon={FiDownload}
            />
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-800">
            <AuthorMetricRow authorPubkey={skill.author_pubkey} />
            <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
              <div className="flex items-center gap-2">
                <FiShield className="h-3.5 w-3.5" />
                <span title="This author has no registered on-chain trust profile yet.">
                  Unregistered author
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2 font-medium text-gray-700 dark:text-gray-300">
                <FiDownload className="h-3.5 w-3.5" />
                <span>{downloads.toLocaleString("en-US")} downloads</span>
              </div>
            </div>
          </div>
        )}

        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {skill.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                title="Tags summarize the skill's core capabilities."
              >
                <FiTag className="h-3 w-3" />
                {tag}
              </span>
            ))}
          </div>
          {hasUsdcPrimary ? (
            <span
              className="shrink-0 inline-flex items-center gap-1.5 rounded-sm border border-[var(--lobster-accent-border)] bg-[var(--lobster-accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--lobster-accent-strong)]"
              title={priceTooltip}
            >
              <UsdcIcon className="h-3.5 w-3.5" />
              {primaryUsdcPrice ? `${primaryUsdcPrice} USDC` : "USDC"}
            </span>
          ) : legacySolLamports > 0 ? (
            <span
              className="shrink-0 rounded-sm border border-gray-200 bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-300"
              title={priceTooltip}
            >
              Legacy SOL
            </span>
          ) : hasAccessPath ? (
            <span
              className="shrink-0 rounded-full bg-[var(--sea-accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--sea-accent-strong)]"
              title={priceTooltip}
            >
              Free
            </span>
          ) : null}
        </div>
        {skill.purchaseRiskWarning && hasUsdcPrimary && !hasPurchased && (
          <div className="mt-3 flex items-start gap-2 rounded-sm border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300">
            <FiInfo className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{skill.purchaseRiskWarning}</span>
          </div>
        )}
      </div>

      {hasAccessPath && (
        <div className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-800">
          {isOwn ? (
            <div
              className={`w-full border border-gray-200 bg-gray-50 text-center font-medium text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500 ${navButtonSizeClass}`}
            >
              Your Skill
            </div>
          ) : hasPurchased ? (
            <div
              className={`w-full border border-green-200 bg-green-50 text-center font-medium text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400 ${navButtonSizeClass}`}
            >
              <span className="inline-flex items-center gap-1">
                <FiCheckCircle className="h-3 w-3" />
                Purchased
              </span>
            </div>
          ) : hasUsdcPrimary ? (
            <Link
              href={`/skills/${skill.id}`}
              className={`w-full border border-[var(--lobster-accent-border)] bg-[var(--lobster-accent-soft)] text-center font-medium text-[var(--lobster-accent-strong)] transition hover:bg-[var(--lobster-accent-soft-hover)] ${navButtonFlexClass}`}
            >
              <UsdcIcon className="h-3.5 w-3.5" />
              {connected ? "Pay with USDC" : "Connect Wallet to Pay"}
            </Link>
          ) : legacySolLamports === 0 ? (
            <Link
              href={`/skills/${skill.id}`}
              className={`w-full border border-[var(--sea-accent-border)] bg-[var(--sea-accent-soft)] text-center font-medium text-[var(--sea-accent-strong)] transition hover:bg-[var(--sea-accent-soft-hover)] ${navButtonFlexClass}`}
            >
              <FiDownload className="h-3 w-3" />
              Free - View & Install
            </Link>
          ) : (
            <Link
              href={`/skills/${skill.id}`}
              className={`w-full border border-gray-200 bg-gray-50 text-center font-medium text-gray-500 transition hover:border-gray-300 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:border-gray-700 ${navButtonFlexClass}`}
            >
              View Details
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
