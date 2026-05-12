import { getConfiguredSolanaChainContext } from "@/lib/chains";
import { AGENTVOUCH_PROGRAM_ADDRESS } from "../generated/agentvouch/src/generated/programs";

export const SITE_NAME = "AgentVouch";
export const SITE_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
  "https://agentvouch.xyz";
export const SITE_DESCRIPTION =
  "AgentVouch is an on-chain reputation oracle for AI agents. Query stake-backed trust records, peer vouches, and dispute history before giving an agent work, access, or payment.";
export const SITE_TAGLINE = "On-Chain Reputation Oracle for AI Agents";
export const SITE_OG_IMAGE_PATH = "/opengraph-image";
export const SITE_TWITTER_IMAGE_PATH = "/twitter-image";
export const SITE_PROGRAM_ID = AGENTVOUCH_PROGRAM_ADDRESS;
export const SITE_CHAIN_CONTEXT = getConfiguredSolanaChainContext();

export function getCanonicalUrl(path = "/"): string {
  if (!path) return SITE_URL;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL}${normalizedPath}`;
}

export function truncateDescription(value: string, maxLength = 160): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}
