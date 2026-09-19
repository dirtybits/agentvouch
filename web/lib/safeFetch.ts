// Server-side guard for outbound fetches of URLs whose content the server does not
// control. Skill listings are permissionless: the listing author sets `skill_uri`
// on-chain, and the raw-download route historically did `fetch(skill_uri)` with no
// validation. That is a server-side request forgery (SSRF) — a listing could point
// at `http://169.254.169.254/...` (cloud metadata), `http://127.0.0.1:PORT/...`, or
// any other internal endpoint, and the server would return the body to the caller.
//
// `resolveSafeFetchUrl` normalizes the candidate through WHATWG URL (which collapses
// every numeric spelling of an address into its canonical host form) and only allows
// `http:` / `https:` targets whose normalized host is not a loopback, link-local,
// private, CGNAT, or otherwise reserved address. It is a host-based blocklist: it
// does NOT defend against DNS rebinding through attacker-controlled public domains —
// a resolution-time guard is a follow-up if that threat model becomes in scope.
//
// Pure and dependency-free so it stays usable in route handlers, tests, and any
// future fetch site.

export type SafeFetchUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: string };

const IPV4_BLOCKLIST_NOTE =
  "0/8, 10/8, 100.64/10 (CGNAT), 127/8, 169.254/16 (link-local + cloud metadata), " +
  "172.16/12, 192.0.0/24, 192.0.2/24 (TEST-NET), 192.88.99/24 (6to4 relay), 192.168/16, " +
  "198.18/15 (benchmarking), 224/4 (multicast) and 240/4 (reserved)";

export function resolveSafeFetchUrl(
  uri: string | null | undefined
): SafeFetchUrlResult {
  if (typeof uri !== "string") {
    return { ok: false, reason: "missing" };
  }
  const trimmed = uri.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty" };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "not a URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      reason: `protocol "${parsed.protocol.replace(
        ":",
        ""
      )}" is not allowed (only http/https)`,
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (!host) {
    return { ok: false, reason: "missing host" };
  }

  if (host === "localhost" || host.endsWith(".localhost")) {
    return { ok: false, reason: "loopback hostname" };
  }

  if (host.startsWith("[") && host.endsWith("]")) {
    if (ipv6IsBlocked(host.slice(1, -1))) {
      return { ok: false, reason: "private/reserved IPv6 address" };
    }
    return { ok: true, url: parsed.href };
  }

  if (ipv4LooksBlocked(host)) {
    return {
      ok: false,
      reason: `private/reserved IPv4 address (${IPV4_BLOCKLIST_NOTE})`,
    };
  }

  return { ok: true, url: parsed.href };
}

/**
 * True when `host` is a dotted-quad IPv4 literal in a blocked range.
 * `URL.hostname` already normalizes every numeric spelling (decimal, hex, octal,
 * shortened) to dotted decimal, so a regex on the literal is sufficient.
 */
function ipv4LooksBlocked(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    const value = Number(part);
    if (value > 255) return false;
    octets.push(value);
  }
  const [a, b, c] = octets;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // TEST-NET-1/2
  if (a === 192 && b === 88 && c === 99) return true; // 192.88.99.0/24 6to4 relay
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

/**
 * Expand a (bracket-stripped) IPv6 literal into 8 groups, or null when the
 * string is not a valid IPv6 literal.
 */
function expandIpv6(host: string): number[] | null {
  const addr = host.toLowerCase();
  if (addr.includes("%")) return null; // zone id is not a fetch target
  const doubleColonCount = (addr.match(/::/g) ?? []).length;
  if (doubleColonCount > 1) return null;

  let groups: string[];
  if (doubleColonCount === 1) {
    const [left, right] = addr.split("::");
    const leftGroups = left ? left.split(":") : [];
    const rightGroups = right ? right.split(":") : [];
    if (leftGroups.some((g) => !g) || rightGroups.some((g) => !g)) return null;
    if (leftGroups.length + rightGroups.length > 7) return null;
    const fillCount = 8 - leftGroups.length - rightGroups.length;
    groups = [
      ...leftGroups,
      ...Array<string>(fillCount).fill("0"),
      ...rightGroups,
    ];
  } else {
    groups = addr.split(":");
    if (groups.length !== 8) return null;
  }

  const expanded: number[] = [];
  for (const group of groups) {
    if (group.length === 0 || group.length > 4) return null;
    if (!/^[0-9a-f]+$/.test(group)) return null;
    expanded.push(Number.parseInt(group, 16));
  }
  if (expanded.length !== 8) return null;
  return expanded;
}

/**
 * True when the IPv6 literal is loopback, unspecified, link-local, unique-local,
 * multicast, documentation, NAT64, or maps to a blocked IPv4 address.
 * Fails closed: an unparseable host that a URL parser accepted is blocked.
 */
function ipv6IsBlocked(host: string): boolean {
  const groups = expandIpv6(host);
  if (!groups) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  if (groups.every((g) => g === 0)) return true; // :: unspecified
  if (
    g0 === 0 &&
    g1 === 0 &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0 &&
    g6 === 0 &&
    g7 === 1
  ) {
    return true; // ::1 loopback
  }
  // IPv4-mapped (::ffff:0:0/96) and legacy IPv4-compatible (::/96) forms —
  // both embed an IPv4 address in the last 32 bits.
  if (
    g0 === 0 &&
    g1 === 0 &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    (g5 === 0xffff || g5 === 0)
  ) {
    return ipv4LooksBlocked(`${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`);
  }
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0) {
    return true; // 64:ff9b::/96 NAT64 well-known prefix
  }
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // 2001:db8::/32 documentation
  return false;
}
