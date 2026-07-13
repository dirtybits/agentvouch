import { describe, expect, it } from "vitest";
import {
  IN_MEMORY_CACHE_TTL_MS,
  PUBLIC_ROUTE_CACHE_SECONDS,
} from "@/lib/cachePolicy";

describe("author trust cache policy", () => {
  it("keeps in-memory trust freshness aligned with the public route", () => {
    expect(IN_MEMORY_CACHE_TTL_MS.authorTrust).toBe(
      PUBLIC_ROUTE_CACHE_SECONDS.authorTrust * 1_000
    );
  });
});
