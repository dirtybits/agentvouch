import { afterEach, describe, expect, it, vi } from "vitest";

import { getOrPopulateMemoryCache } from "@/lib/serverCache";

type MemoryCacheEntry<T> = {
  value: T;
  expiresAt: number;
};

function setSystemTime(iso: string) {
  vi.setSystemTime(new Date(iso));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("getOrPopulateMemoryCache", () => {
  it("calls load once on a cold cache, returns its value, and stores it with a ttl-bound expiry", async () => {
    vi.useFakeTimers();
    setSystemTime("2026-01-01T00:00:00.000Z");

    const cache = new Map<string, MemoryCacheEntry<string>>();
    let calls = 0;

    const value = await getOrPopulateMemoryCache(
      cache,
      "k",
      1_000,
      async () => {
        calls += 1;
        return "loaded";
      }
    );

    expect(value).toBe("loaded");
    expect(calls).toBe(1);
    const entry = cache.get("k");
    expect(entry?.value).toBe("loaded");
    expect(entry?.expiresAt).toBe(Number(new Date("2026-01-01T00:00:01.000Z")));
  });

  it("returns a fresh cached value without calling load while the entry is live", async () => {
    vi.useFakeTimers();
    setSystemTime("2026-01-01T00:00:00.000Z");

    const cache = new Map<string, MemoryCacheEntry<string>>();
    cache.set("k", {
      value: "cached",
      expiresAt: Number(new Date("2026-01-01T00:01:00.000Z")),
    });
    let calls = 0;

    const value = await getOrPopulateMemoryCache(
      cache,
      "k",
      1_000,
      async () => {
        calls += 1;
        throw new Error("load should not run");
      }
    );

    expect(value).toBe("cached");
    expect(calls).toBe(0);
    const entry = cache.get("k");
    expect(entry?.value).toBe("cached");
    expect(entry?.expiresAt).toBe(Number(new Date("2026-01-01T00:01:00.000Z")));
  });

  it("does not call load when several keys are fresh", async () => {
    vi.useFakeTimers();
    setSystemTime("2026-01-01T00:00:00.000Z");

    const cache = new Map<string, MemoryCacheEntry<string>>();
    for (const key of ["a", "b", "c"]) {
      cache.set(key, {
        value: key,
        expiresAt: Number(new Date("2026-01-01T00:01:00.000Z")),
      });
    }
    let calls = 0;

    expect(
      await getOrPopulateMemoryCache(cache, "a", 1_000, async () => {
        calls += 1;
        return "nope";
      })
    ).toBe("a");
    expect(
      await getOrPopulateMemoryCache(cache, "b", 1_000, async () => {
        calls += 1;
        return "nope";
      })
    ).toBe("b");

    expect(calls).toBe(0);
  });

  it("reloads and replaces an expired entry", async () => {
    vi.useFakeTimers();
    setSystemTime("2026-01-01T00:00:05.000Z");

    const cache = new Map<string, MemoryCacheEntry<string>>();
    cache.set("k", {
      value: "stale",
      expiresAt: Number(new Date("2026-01-01T00:00:04.000Z")),
    });
    let calls = 0;

    const value = await getOrPopulateMemoryCache(
      cache,
      "k",
      1_000,
      async () => {
        calls += 1;
        return "fresh";
      }
    );

    expect(value).toBe("fresh");
    expect(calls).toBe(1);
    const entry = cache.get("k");
    expect(entry?.value).toBe("fresh");
    expect(entry?.expiresAt).toBe(Number(new Date("2026-01-01T00:00:06.000Z")));
  });

  it("treats an entry whose expiry instant equals now as expired", async () => {
    vi.useFakeTimers();
    setSystemTime("2026-01-01T00:00:00.000Z");

    const cache = new Map<string, MemoryCacheEntry<string>>();
    cache.set("k", {
      value: "boundary",
      expiresAt: Number(new Date("2026-01-01T00:00:00.000Z")),
    });
    let calls = 0;

    const value = await getOrPopulateMemoryCache(
      cache,
      "k",
      1_000,
      async () => {
        calls += 1;
        return "after-boundary";
      }
    );

    expect(value).toBe("after-boundary");
    expect(calls).toBe(1);
    expect(cache.get("k")?.value).toBe("after-boundary");
  });

  it("rolls an entry from fresh to expired and reloads after the window elapses", async () => {
    vi.useFakeTimers();
    setSystemTime("2026-01-01T00:00:00.000Z");

    const cache = new Map<string, MemoryCacheEntry<string>>();
    let calls = 0;

    const first = await getOrPopulateMemoryCache(
      cache,
      "k",
      1_000,
      async () => {
        calls += 1;
        return "one";
      }
    );
    expect(first).toBe("one");

    const second = await getOrPopulateMemoryCache(
      cache,
      "k",
      1_000,
      async () => {
        calls += 1;
        return "two";
      }
    );
    expect(second).toBe("one");
    expect(calls).toBe(1);

    vi.advanceTimersByTime(1_001);
    const third = await getOrPopulateMemoryCache(
      cache,
      "k",
      1_000,
      async () => {
        calls += 1;
        return "two";
      }
    );
    expect(third).toBe("two");
    expect(calls).toBe(2);
  });

  it("keeps per-key values isolated so an expired sibling does not leak into a fresh key", async () => {
    vi.useFakeTimers();
    setSystemTime("2026-01-01T00:00:00.000Z");

    const cache = new Map<string, MemoryCacheEntry<string>>();
    cache.set("expired", {
      value: "do-not-use",
      expiresAt: Number(new Date("2026-01-01T00:00:00.000Z")),
    });
    cache.set("fresh", {
      value: "keep-me",
      expiresAt: Number(new Date("2026-01-01T00:01:00.000Z")),
    });

    expect(
      await getOrPopulateMemoryCache(cache, "fresh", 1_000, async () => {
        throw new Error("should not load");
      })
    ).toBe("keep-me");
    expect(cache.get("expired")?.value).toBe("do-not-use");
  });

  it("preserves the value type across the generic cache boundary", async () => {
    const cache = new Map<string, MemoryCacheEntry<Record<string, number>>>();
    let calls = 0;

    const value = await getOrPopulateMemoryCache<Record<string, number>>(
      cache,
      "obj",
      10_000,
      async () => {
        calls += 1;
        return { a: 1, b: 2 };
      }
    );

    expect(value).toEqual({ a: 1, b: 2 });
    expect(calls).toBe(1);
    expect(cache.get("obj")?.value).toEqual({ a: 1, b: 2 });
  });
});
