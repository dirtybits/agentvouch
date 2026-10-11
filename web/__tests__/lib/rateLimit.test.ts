import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, clientIpFromRequest } from "@/lib/rateLimit";

const TEST_KEY_PREFIX = "rate-limit-test";
let keyIndex = 0;

function nextKey() {
  keyIndex += 1;
  return `${TEST_KEY_PREFIX}:${keyIndex}`;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("checkRateLimit", () => {
  it("allows requests up to the configured limit within one window", () => {
    vi.useFakeTimers();
    const key = nextKey();

    expect(checkRateLimit(key, { limit: 3, windowMs: 10_000 })).toEqual({
      ok: true,
      remaining: 2,
      retryAfterSeconds: 0,
    });
    expect(checkRateLimit(key, { limit: 3, windowMs: 10_000 })).toEqual({
      ok: true,
      remaining: 1,
      retryAfterSeconds: 0,
    });
    expect(checkRateLimit(key, { limit: 3, windowMs: 10_000 })).toEqual({
      ok: true,
      remaining: 0,
      retryAfterSeconds: 0,
    });
    expect(checkRateLimit(key, { limit: 3, windowMs: 10_000 })).toEqual({
      ok: false,
      remaining: 0,
      retryAfterSeconds: 10,
    });
  });

  it("rejects the next request when the limit is exactly reached", () => {
    vi.useFakeTimers();
    const key = nextKey();
    for (let i = 0; i < 2; i += 1) {
      expect(checkRateLimit(key, { limit: 2, windowMs: 60_000 }).ok).toBe(true);
    }
    const rejected = checkRateLimit(key, { limit: 2, windowMs: 60_000 });
    expect(rejected).toEqual({
      ok: false,
      remaining: 0,
      retryAfterSeconds: 60,
    });
  });

  it("reports retryAfterSeconds clamped to at least one second", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-20T00:00:00.000Z"));
    const key = nextKey();

    checkRateLimit(key, { limit: 1, windowMs: 200 });
    vi.advanceTimersByTime(100);

    const rejected = checkRateLimit(key, { limit: 1, windowMs: 200 });
    expect(rejected.ok).toBe(false);
    expect(rejected.retryAfterSeconds).toBe(1);
  });

  it("reopens the window after the window elapses", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-20T00:00:00.000Z"));
    const key = nextKey();

    expect(checkRateLimit(key, { limit: 1, windowMs: 5_000 }).ok).toBe(true);
    expect(checkRateLimit(key, { limit: 1, windowMs: 5_000 }).ok).toBe(false);

    vi.advanceTimersByTime(5_001);
    expect(checkRateLimit(key, { limit: 1, windowMs: 5_000 })).toEqual({
      ok: true,
      remaining: 0,
      retryAfterSeconds: 0,
    });
  });

  it("keeps counters isolated per key", () => {
    vi.useFakeTimers();
    const first = nextKey();
    const second = nextKey();

    expect(checkRateLimit(first, { limit: 1, windowMs: 10_000 }).ok).toBe(true);
    expect(checkRateLimit(first, { limit: 1, windowMs: 10_000 }).ok).toBe(
      false
    );
    expect(checkRateLimit(second, { limit: 1, windowMs: 10_000 })).toEqual({
      ok: true,
      remaining: 0,
      retryAfterSeconds: 0,
    });
  });
});

describe("clientIpFromRequest", () => {
  it("prefers the unspoofable x-real-ip over x-forwarded-for", () => {
    const request = new Request("https://agentvouch.xyz/api/keys", {
      headers: {
        // Leftmost hop is client-prepended (spoofable); x-real-ip wins.
        "x-forwarded-for": "203.0.113.7, 10.0.0.1",
        "x-real-ip": "198.51.100.9",
      },
    });
    expect(clientIpFromRequest(request)).toBe("198.51.100.9");
  });

  it("uses the rightmost x-forwarded-for hop when x-real-ip is absent", () => {
    const request = new Request("https://agentvouch.xyz/api/keys", {
      headers: {
        // 10.0.0.1 is the client's own IP that a flooder prepends as "real";
        // we key on the rightmost hop instead so one attacker cannot seed a
        // fresh unique bucket per request.
        "x-forwarded-for": "203.0.113.7, 10.0.0.1",
      },
    });
    expect(clientIpFromRequest(request)).toBe("10.0.0.1");
  });

  it("returns x-real-ip when it is present alone", () => {
    const request = new Request("https://agentvouch.xyz/api/keys", {
      headers: { "x-real-ip": "198.51.100.9" },
    });
    expect(clientIpFromRequest(request)).toBe("198.51.100.9");
  });

  it("falls back to x-vercel-forwarded-for when proxy headers are absent", () => {
    const request = new Request("https://agentvouch.xyz/api/keys", {
      headers: { "x-vercel-forwarded-for": "192.0.2.4" },
    });
    expect(clientIpFromRequest(request)).toBe("192.0.2.4");
  });

  it("returns unknown when no client IP headers are present", () => {
    const request = new Request("https://agentvouch.xyz/api/keys");
    expect(clientIpFromRequest(request)).toBe("unknown");
  });

  it("ignores a blank x-forwarded-for value", () => {
    const request = new Request("https://agentvouch.xyz/api/keys", {
      headers: {
        "x-forwarded-for": "   ",
        "x-real-ip": "198.51.100.9",
      },
    });
    expect(clientIpFromRequest(request)).toBe("198.51.100.9");
  });
});
