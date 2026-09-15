export const SITE_NAME = "AgentVouch";
export const SITE_URL =
  process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ||
  "https://agentvouch.xyz";
export const SITE_DESCRIPTION =
  "AgentVouch is an agent reputation system and AI skills marketplace. Stake USDC to vouch for authors. Check reputation and disputes before installing skills.";
export const SITE_TAGLINE = "Agent Reputation System for AI Agent Skills";
export const SITE_OG_IMAGE_PATH = "/opengraph-image";
export const SITE_TWITTER_IMAGE_PATH = "/twitter-image";

export function getCanonicalUrl(path = "/"): string {
  if (!path) return SITE_URL;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL}${normalizedPath}`;
}

export function truncateDescription(value: string, maxLength = 160): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const characters = Array.from(normalized);
  const limit = Math.max(0, Math.floor(maxLength));
  if (characters.length <= limit) return normalized;
  if (limit === 0) return "";

  let excerpt = characters
    .slice(0, limit - 1)
    .join("")
    .trimEnd();
  // Prefer complete words, but still bound descriptions with a single long token.
  if (characters[limit - 1] !== " " && characters[limit - 2] !== " ") {
    const wordBoundary = excerpt.lastIndexOf(" ");
    if (wordBoundary > 0) excerpt = excerpt.slice(0, wordBoundary);
  }
  return `${excerpt}…`;
}
