"use client";

import { FiGithub, FiLink2, FiShield, FiUser, FiZap } from "react-icons/fi";
import type { AgentIdentitySummary } from "@/lib/agentIdentity";
import { getChainDisplayLabel } from "@/lib/chains";

function shortValue(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 12)}...${value.slice(-6)}`;
}

function IdentityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-t border-gray-100 dark:border-gray-800 first:border-t-0 first:pt-0 last:pb-0">
      <span className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500 shrink-0">
        {label}
      </span>
      <span className="font-mono text-xs text-right text-gray-600 dark:text-gray-300 break-all">
        {shortValue(value)}
      </span>
    </div>
  );
}

export function AgentIdentityPanel({
  identity,
  title = "Identity",
}: {
  identity: AgentIdentitySummary | null;
  title?: string;
}) {
  if (!identity) {
    return null;
  }

  const sourceLabel =
    identity.identitySource === "erc8004"
      ? "Registry linked"
      : "Local wallet identity";
  const chainLabel = identity.homeChainContext
    ? getChainDisplayLabel(identity.homeChainContext)
    : "Unknown chain";

  return (
    <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <FiLink2 className="w-4 h-4 text-[var(--sea-accent)]" />
          <div>
            <h2 className="text-sm font-normal text-gray-900 dark:text-white">
              {title}
            </h2>
            {identity.displayName && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {identity.displayName}
              </p>
            )}
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 dark:border-gray-700 px-2 py-0.5 text-[11px] text-gray-500 dark:text-gray-400">
          {identity.identitySource === "erc8004" ? (
            <FiZap className="w-3 h-3" />
          ) : (
            <FiUser className="w-3 h-3" />
          )}
          {sourceLabel}
        </span>
      </div>

      <div className="space-y-0">
        <IdentityRow label="Canonical ID" value={identity.canonicalAgentId} />
        {identity.homeChainContext ? (
          <IdentityRow
            label="Chain"
            value={`${chainLabel} (${identity.homeChainContext})`}
          />
        ) : null}
        {identity.registryAsset ? (
          <IdentityRow label="Registry Asset" value={identity.registryAsset} />
        ) : null}
        {identity.username ? (
          <IdentityRow
            label={
              identity.usernameSource === "fallback"
                ? "Username"
                : "Chosen Username"
            }
            value={`@${identity.username}`}
          />
        ) : null}
        {identity.githubProfile ? (
          <div className="flex items-start justify-between gap-3 py-2 border-t border-gray-100 dark:border-gray-800 first:border-t-0 first:pt-0 last:pb-0">
            <span className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500 shrink-0">
              GitHub
            </span>
            <a
              href={identity.githubProfile.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-w-0 items-center gap-1 font-mono text-xs text-right text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline"
            >
              <FiGithub className="h-3 w-3 shrink-0" />
              <span className="truncate">@{identity.githubProfile.login}</span>
            </a>
          </div>
        ) : null}
        {identity.ownerWallet ? (
          <IdentityRow label="Owner Wallet" value={identity.ownerWallet} />
        ) : null}
        {identity.operationalWallet ? (
          <IdentityRow
            label="Operational Wallet"
            value={identity.operationalWallet}
          />
        ) : null}
        {identity.agentProfilePda ? (
          <IdentityRow
            label="AgentProfile PDA"
            value={identity.agentProfilePda}
          />
        ) : null}
      </div>

      {identity.registryAsset ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <FiShield className="w-3.5 h-3.5" />
          Registry identity is shown alongside AgentProfile economics and
          authorization.
        </p>
      ) : (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <FiShield className="w-3.5 h-3.5" />
          Settlement and authorization still resolve through the current wallet
          and AgentProfile.
        </p>
      )}
    </div>
  );
}
