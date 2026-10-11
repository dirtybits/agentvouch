// Best-effort, in-memory fixed-window rate limiter.
//
// NOTE: this is PER-INSTANCE only. On serverless / Fluid Compute each instance
// keeps its own counters, so a distributed flood can still get (instances *
// limit) requests through. It raises the bar against trivial single-source
// abuse but is NOT a substitute for an edge rate limit (Vercel Firewall / WAF)
// or a shared store (Upstash / Vercel KV). Track the shared-store/edge limit as
// the real fix before enabling sponsored checkout broadly in production.
// See AGENTS.md "Security invariants (server-signed / sponsored transactions)".

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_TRACKED_KEYS = 5_000;

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

function sweepExpired(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function checkRateLimit(
  key: string,
  options: { limit: number; windowMs: number }
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    if (buckets.size > MAX_TRACKED_KEYS) sweepExpired(now);
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return { ok: true, remaining: options.limit - 1, retryAfterSeconds: 0 };
  }
  if (existing.count >= options.limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((existing.resetAt - now) / 1000)
      ),
    };
  }
  existing.count += 1;
  return {
    ok: true,
    remaining: options.limit - existing.count,
    retryAfterSeconds: 0,
  };
}

// Best-effort client IP for rate-limit keying (proxy headers are spoofable).
//
// On Vercel, x-real-ip is set by the platform from the true client connection
// and cannot be spoofed by the caller, so it is checked first. Only when that
// is absent (local dev / non-Vercel) do we fall back to the rightmost
// x-forwarded-for hop — the leftmost entries are client-prepended and
// attacker-controlled, so taking them as "the client IP" lets a flooder seed a
// fresh, unique bucket per request and dodge per-IP limits. This mirrors the
// in-repo clientIp() pattern used by /api/check.
export function clientIpFromRequest(request: Request): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const hops = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (hops && hops.length > 0) return hops[hops.length - 1];

  return request.headers.get("x-vercel-forwarded-for")?.trim() ?? "unknown";
}
