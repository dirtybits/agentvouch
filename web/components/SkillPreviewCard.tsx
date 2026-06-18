"use client";

import Link from "next/link";
import {
  FiAlertTriangle,
  FiCheck,
  FiCheckCircle,
  FiDownload,
  FiGithub,
  FiInfo,
  FiShield,
  FiUsers,
} from "react-icons/fi";
import { UsdcIcon } from "@/components/UsdcIcon";
import { SkillIcon } from "@/components/SkillIcon";
import { getAuthorReportStatus, type TrustData } from "@/components/TrustBadge";
import { formatWalletAuthorLabel } from "@/lib/authorDisplay";
import { formatUsdcMicros } from "@/lib/pricing";
import type { PurchasePreflightStatus } from "@/lib/purchasePreflight";
import type { SkillSecurityScan } from "@/lib/securityScan";
import { RESERVED_SKILL_TAGS } from "@/lib/skillDraft";
import { getPublicSkillPath } from "@/lib/skillUrls";

interface SkillPreviewCardSkill {
  id: string;
  public_slug?: string | null;
  skill_id?: string | null;
  author_pubkey: string | null;
  author_kind?: string | null;
  author_handle?: string | null;
  author_display_name?: string | null;
  author_identity?: {
    username?: string | null;
    usernameSource?: string | null;
    githubProfile?: {
      login: string;
      url: string;
    } | null;
  } | null;
  publisher_identity_key?: string | null;
  publisher_tier?: string | null;
  mirror_source_key?: string | null;
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
  onPurchase?: () => void;
  onTagClick?: (tag: string) => void;
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

function getScanMeta(scan: SkillSecurityScan | null | undefined): {
  label: string;
  chip: string;
  title: string;
} | null {
  if (!scan) return null;
  if (scan.verdict === "avoid") {
    return {
      label: "Automated avoid",
      chip: "border-red-300 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
      title:
        "Automated advisory scan found concrete risk. This is not a staked vouch.",
    };
  }
  return {
    label: scan.truncated ? "Automated review*" : "Automated review",
    chip: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
    title: scan.truncated
      ? "Automated advisory scan was truncated; review before installing. This is not a staked vouch."
      : "Automated advisory scan did not find a concrete blocker. This is not a staked vouch.",
  };
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
  variant: "primary" | "price" | "installed" | "muted";
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
      variant: "price",
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
  price:
    "border border-[var(--sea-accent-border)] bg-[var(--sea-accent-soft)] text-[var(--sea-accent-strong)] hover:bg-[var(--sea-accent-soft-hover)]",
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
  onTagClick,
}: SkillPreviewCardProps) {
  // Author copy stays primary; AI summaries fill gaps for thin listings.
  const description =
    skill.description ?? skill.summary ?? descriptionFallback ?? "";
  const displayDescription = description
    ? truncateAtWord(description, 80)
    : null;
  const trust = skill.author_trust;
  const verdict = getVerdict(trust);
  const verdictMeta = getVerdictMeta(verdict);
  const scanMeta = getScanMeta(skill.security_scan);
  const authorSeed =
    skill.author_pubkey ??
    skill.publisher_identity_key ??
    skill.author_handle ??
    skill.id;
  const walletAuthorLabel = skill.author_pubkey
    ? formatWalletAuthorLabel(skill.author_pubkey, skill.author_identity)
    : null;
  const linkedGithubProfile = skill.author_pubkey
    ? skill.author_identity?.githubProfile
    : null;
  const isMirror = Boolean(skill.mirror_source_key);
  const authorLabel = walletAuthorLabel
    ? walletAuthorLabel
    : isMirror && skill.author_handle
    ? `Mirror · @${skill.author_handle}`
    : skill.author_handle
    ? `@${skill.author_handle}`
    : "Unverified publisher";
  const authorHref = skill.author_pubkey
    ? `/author/${skill.author_pubkey}`
    : skill.author_kind === "github" && skill.author_handle
    ? `https://github.com/${skill.author_handle}`
    : null;
  const authorTitle = skill.author_pubkey
    ? linkedGithubProfile
      ? `Author wallet linked to GitHub @${linkedGithubProfile.login}`
      : "Author wallet that published this skill"
    : isMirror
    ? "Community mirror of a public GitHub skill, published by AgentVouch — not posted here by the upstream author."
    : skill.author_kind === "github"
    ? "GitHub identity that published this unverified skill"
    : "Unverified publisher identity";
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
  const skillHref = getPublicSkillPath(skill);
  const visibleTags = skill.tags.filter((tag) => !RESERVED_SKILL_TAGS.has(tag));

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-sm border border-gray-200 bg-white transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--lobster-accent-border)] hover:shadow-[0_8px_30px_-12px_rgba(217,90,43,0.35)] dark:border-gray-800 dark:bg-gray-900 dark:hover:border-[var(--lobster-accent-border)]">
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        {/* Byline cluster (author icon + handle) + verdict chip */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href={skillHref}
              aria-label={skill.name}
              className="shrink-0 transition-transform duration-200 group-hover:scale-[1.03]"
            >
              <SkillIcon
                seed={authorSeed}
                size={30}
                ringClass={verdictMeta.ring}
                badge={<VerdictDot verdict={verdict} meta={verdictMeta} />}
              />
            </Link>
            {authorHref?.startsWith("http") ? (
              <a
                href={authorHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-w-0 items-center gap-1 truncate font-mono text-[11px] text-[var(--sea-accent)] transition hover:text-[var(--sea-accent-strong)] hover:underline"
                title={authorTitle}
              >
                <FiGithub className="h-3 w-3 shrink-0" />
                <span className="truncate">{authorLabel}</span>
              </a>
            ) : authorHref ? (
              <Link
                href={authorHref}
                className="truncate font-mono text-[11px] text-[var(--sea-accent)] transition hover:text-[var(--sea-accent-strong)] hover:underline"
                title={authorTitle}
              >
                {authorLabel}
              </Link>
            ) : (
              <span
                className="truncate font-mono text-[11px] text-gray-400 dark:text-gray-500"
                title={authorTitle}
              >
                {authorLabel}
              </span>
            )}
            {linkedGithubProfile && (
              <a
                href={linkedGithubProfile.url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-gray-400 transition hover:text-[var(--sea-accent)]"
                title={`Linked GitHub @${linkedGithubProfile.login}`}
              >
                <FiGithub className="h-3 w-3" />
              </a>
            )}
            {skill.source !== "chain" && (
              <span
                className="shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-500"
                title={`Current repo version: v${skill.current_version}`}
              >
                · v{skill.current_version}
              </span>
            )}
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${verdictMeta.chip}`}
            title={verdictMeta.title}
          >
            <verdictMeta.Icon className="h-3 w-3" />
            {verdictMeta.label}
          </span>
        </div>

        {/* Title — serif, unbolded */}
        <Link
          href={skillHref}
          className="block break-words font-display text-[20px] leading-snug text-gray-900 line-clamp-2 transition group-hover:text-[var(--lobster-accent)] dark:text-white"
          title={skill.name}
        >
          {skill.name}
        </Link>

        {/* Description — serif */}
        {displayDescription && (
          <p
            className="font-article line-clamp-2 min-h-[2.5rem] text-[14px] leading-snug text-gray-500 dark:text-gray-400"
            title={description}
          >
            {displayDescription}
          </p>
        )}

        {/* Signals + tags */}
        <div className="flex flex-wrap items-center gap-1.5">
          {isMirror && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-[var(--sea-accent-border)] bg-[var(--sea-accent-soft)] px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--sea-accent-strong)]"
              title="Community mirror of a public GitHub skill, published by AgentVouch — not posted here by the upstream author."
            >
              <FiGithub className="h-3 w-3" />
              Mirror
            </span>
          )}
          {scanMeta && (
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${scanMeta.chip}`}
              title={scanMeta.title}
            >
              <FiAlertTriangle className="h-3 w-3" />
              {scanMeta.label}
            </span>
          )}
          {skill.has_executable && !skill.security_scan && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
              title="This skill contains executable files and has not yet been security-scanned."
            >
              <FiAlertTriangle className="h-3 w-3" />
              Unscanned executable code
            </span>
          )}
          {hasDisputeFlag && authorReports && (
            <span
              className={`inline-flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-wider ${authorReports.color}`}
              title="Current or historical dispute status against this author."
            >
              <FiAlertTriangle className="h-3 w-3" />
              {authorReports.label}
            </span>
          )}
          {visibleTags.slice(0, 3).map((tag) =>
            onTagClick ? (
              <button
                key={tag}
                type="button"
                onClick={() => onTagClick(tag)}
                className="rounded-full border border-[var(--lobster-accent-border)] bg-[var(--lobster-accent-soft)] px-2 py-0.5 font-mono text-[10px] lowercase tracking-wide text-[var(--lobster-accent)] transition hover:border-[var(--lobster-accent)] hover:bg-white dark:hover:bg-gray-900"
                title={`Show all skills tagged ${tag}`}
              >
                {tag}
              </button>
            ) : (
              <span
                key={tag}
                className="rounded-full border border-[var(--lobster-accent-border)] bg-[var(--lobster-accent-soft)] px-2 py-0.5 font-mono text-[10px] lowercase tracking-wide text-[var(--lobster-accent)]"
                title="Tags summarize the skill's core capabilities."
              >
                {tag}
              </span>
            )
          )}
        </div>

        {/* Bottom stats — anchored: action/price · rep · vouches · downloads */}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
          <Link
            href={skillHref}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-sm px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-wider transition ${
              PILL_VARIANT[pill.variant]
            }`}
            title={
              isListingRequired ? "Paid skill setup is incomplete" : pill.label
            }
          >
            {PillIcon && <PillIcon className="h-3.5 w-3.5" />}
            {pill.label}
          </Link>
          <div className="flex items-center gap-3 font-mono text-[12px]">
            {registered && trust ? (
              <>
                <span
                  className="inline-flex items-center gap-1 font-normal text-emerald-600 dark:text-emerald-400"
                  title="Reputation — public backing, endorsements, and dispute history."
                >
                  <FiShield className="h-3.5 w-3.5" />
                  {trust.reputationScore.toLocaleString("en-US")}
                </span>
                <span
                  className="inline-flex items-center gap-1 text-gray-600 dark:text-gray-300"
                  title="Vouches — outside accounts staking USDC behind this author."
                >
                  <FiUsers className="h-3.5 w-3.5" />
                  {trust.totalVouchesReceived.toLocaleString("en-US")}
                </span>
                <span
                  className="inline-flex items-center gap-1 text-gray-600 dark:text-gray-300"
                  title="Successful installs and downloads."
                >
                  <FiDownload className="h-3.5 w-3.5" />
                  {downloads.toLocaleString("en-US")}
                </span>
              </>
            ) : (
              <span
                className="inline-flex items-center gap-1 text-gray-600 dark:text-gray-300"
                title="Successful installs and downloads."
              >
                <FiDownload className="h-3.5 w-3.5" />
                {downloads.toLocaleString("en-US")}
              </span>
            )}
          </div>
        </div>

        {skill.purchaseRiskWarning &&
          hasUsdcPrimary &&
          !isListingRequired &&
          !hasPurchased && (
            <div className="mt-3 flex items-start gap-2 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              <FiInfo className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{skill.purchaseRiskWarning}</span>
            </div>
          )}
      </div>
    </article>
  );
}
