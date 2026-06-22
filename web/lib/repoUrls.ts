/**
 * Returns the URL only when it starts with the expected GitHub HTTPS prefix,
 * otherwise returns null. Never trust the stored DB value directly as an href.
 */
export function sanitizeSyncedRepoUrl(
  url: string | null | undefined
): string | null {
  if (!url) return null;
  return url.startsWith("https://github.com/") ? url : null;
}
