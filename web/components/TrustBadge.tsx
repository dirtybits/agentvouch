"use client";

import { FiShield, FiUsers, FiAlertTriangle, FiUser } from "react-icons/fi";
import { LiaCoinsSolid } from "react-icons/lia";
import { formatUsdcMicros } from "@/lib/pricing";

export interface TrustData {
  reputationScore: number;
  totalVouchesReceived: number;
  totalStakedFor: number;
  authorBondLamports: number;
  totalStakeAtRisk: number;
  disputesAgainstAuthor: number;
  disputesUpheldAgainstAuthor: number;
  activeDisputesAgainstAuthor: number;
  registeredAt: number;
  isRegistered: boolean;
}

interface TrustBadgeProps {
  trust: TrustData | null;
  compact?: boolean;
}

function formatUsdc(micros: number): string {
  return formatUsdcMicros(micros) ?? "0";
}

export function getAuthorReportStatus(
  total: number,
  upheld: number,
  active: number
): { label: string; color: string } {
  if (total === 0)
    return { label: "Clean", color: "text-green-600 dark:text-green-400" };
  if (active > 0)
    return { label: `${active} open`, color: "text-red-600 dark:text-red-400" };
  if (upheld > 0)
    return {
      label: `${upheld} upheld`,
      color: "text-yellow-600 dark:text-yellow-400",
    };
  return {
    label: `${total} resolved`,
    color: "text-gray-600 dark:text-gray-300",
  };
}

export default function TrustBadge({
  trust,
  compact = false,
}: TrustBadgeProps) {
  if (!trust || !trust.isRegistered) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
        <FiShield className="w-3 h-3" />
        Unregistered
      </span>
    );
  }

  const authorReports = getAuthorReportStatus(
    trust.disputesAgainstAuthor,
    trust.disputesUpheldAgainstAuthor,
    trust.activeDisputesAgainstAuthor
  );

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="flex items-center gap-1 text-green-600 dark:text-green-400 font-semibold">
          <FiShield className="w-3.5 h-3.5" />
          {trust.reputationScore}
        </span>
        <span className="flex items-center gap-1 text-[var(--lobster-accent)]">
          <FiUsers className="w-3.5 h-3.5" />
          {trust.totalVouchesReceived}
        </span>
        <span className="text-gray-500 dark:text-gray-400">
          Backing {formatUsdc(trust.totalStakedFor)} USDC
        </span>
        <span className="text-gray-500 dark:text-gray-400">
          Self {formatUsdc(trust.authorBondLamports)} USDC
        </span>
        <span className={`flex items-center gap-1 ${authorReports.color}`}>
          <FiAlertTriangle className="w-3.5 h-3.5" />
          {authorReports.label}
        </span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      <div className="rounded-sm border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-3 text-center">
        <div className="flex items-center justify-center gap-1 text-green-600 dark:text-green-400 mb-1">
          <FiShield className="w-4 h-4" />
        </div>
        <div className="text-lg font-bold">{trust.reputationScore}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          Reputation
        </div>
      </div>

      <div className="rounded-sm border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-3 text-center">
        <div className="flex items-center justify-center gap-1 text-[var(--lobster-accent)] mb-1">
          <FiUsers className="w-4 h-4" />
        </div>
        <div className="text-lg font-bold">{trust.totalVouchesReceived}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">Vouches</div>
      </div>

      <div className="rounded-sm border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-3 text-center">
        <div className="flex items-center justify-center gap-1 text-[var(--lobster-accent)] mb-1">
          <LiaCoinsSolid className="w-4 h-4" />
        </div>
        <div className="text-lg font-bold">
          {formatUsdc(trust.totalStakedFor)}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">Backing</div>
      </div>

      <div className="rounded-sm border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-3 text-center">
        <div className="flex items-center justify-center gap-1 text-[var(--sea-accent)] mb-1">
          <FiUser className="w-4 h-4" />
        </div>
        <div className="text-lg font-bold">
          {formatUsdc(trust.authorBondLamports)}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          Self Stake
        </div>
        <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
          Aggregate stake: {formatUsdc(trust.totalStakeAtRisk)} USDC
        </div>
      </div>

      <div className="rounded-sm border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-3 text-center">
        <div
          className={`flex items-center justify-center gap-1 ${authorReports.color} mb-1`}
        >
          <FiAlertTriangle className="w-4 h-4" />
        </div>
        <div className="text-sm font-bold">{authorReports.label}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          Author Reports
        </div>
      </div>
    </div>
  );
}
