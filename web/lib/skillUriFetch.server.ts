import { fetchPublicUrl } from "@/lib/publicUrlFetch.server";
import { resolveSafeFetchUrl } from "@/lib/safeFetch";

/**
 * Fetch author-controlled chain skill content through the public-address-pinned
 * transport. Every redirect target is independently URL- and DNS-validated.
 */
export async function fetchSkillUriText(skillUri: string): Promise<string> {
  let target = skillUri;
  for (let redirects = 0; ; redirects += 1) {
    if (redirects > 5) {
      throw new Error("Skill URI fetch rejected: too many redirects");
    }
    const safe = resolveSafeFetchUrl(target);
    if (!safe.ok) {
      throw new Error(`Skill URI fetch rejected: ${safe.reason}`);
    }
    const res = await fetchPublicUrl(safe.url);
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (!location) {
        throw new Error("Skill URI fetch rejected: redirect has no location");
      }
      target = new URL(location, safe.url).href;
      continue;
    }
    if (!res.ok) {
      throw new Error(`Skill URI fetch failed with status ${res.status}`);
    }
    return res.text();
  }
}
