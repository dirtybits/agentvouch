import { describe, expect, it } from "vitest";
import { MIRROR_SOURCES, getMirrorSources } from "@/lib/mirror/sources";

// getMirrorSources is the key-selection seam for syncMirrorSkills (web/lib/mirror/sync.ts):
// callers pass CLI/source keys straight through, so the registry contract — which sources
// exist, how key matching behaves, and how unknown keys fail — deserves direct coverage.
// mirror-sync.test.ts mocks this module out, so these are the only tests exercising the
// real implementation.

describe("MIRROR_SOURCES registry", () => {
  it("contains exactly the anthropic and openai community sources", () => {
    expect(MIRROR_SOURCES.map((s) => s.key).sort()).toEqual([
      "anthropic",
      "openai",
    ]);
  });

  it("carries complete GitHub attribution for every source", () => {
    for (const source of MIRROR_SOURCES) {
      expect(source.key.length).toBeGreaterThan(0);
      expect(source.owner.length).toBeGreaterThan(0);
      expect(source.repo.length).toBeGreaterThan(0);
      expect(source.branch.length).toBeGreaterThan(0);
      expect(source.githubId.length).toBeGreaterThan(0);
      expect(source.handle.length).toBeGreaterThan(0);
      expect(source.displayName.length).toBeGreaterThan(0);
      expect(source.includePathPrefixes.length).toBeGreaterThan(0);
    }
  });

  it("mirrors only OpenAI's curated catalog, not Codex's internal .system skills", () => {
    const openai = MIRROR_SOURCES.find((s) => s.key === "openai");
    expect(openai?.includePathPrefixes).toEqual(["skills/.curated/"]);
    expect(openai?.includePathPrefixes).not.toContain("skills/.system/");
  });
});

describe("getMirrorSources", () => {
  it("returns every source when no keys are provided", () => {
    expect(getMirrorSources()).toHaveLength(MIRROR_SOURCES.length);
    expect(
      getMirrorSources()
        .map((s) => s.key)
        .sort()
    ).toEqual(["anthropic", "openai"]);
  });

  it("returns every source for an empty key list", () => {
    expect(getMirrorSources([])).toHaveLength(MIRROR_SOURCES.length);
  });

  it("returns the single source for a known key", () => {
    const [source] = getMirrorSources(["openai"]);
    expect(source).toMatchObject({ key: "openai", owner: "openai" });
  });

  it("matches source keys case-insensitively and dedupes repeats", () => {
    expect(getMirrorSources(["ANTHROPIC"]).map((s) => s.key)).toEqual([
      "anthropic",
    ]);
    expect(getMirrorSources(["anthropic", "ANTHROPIC"])).toHaveLength(1);
    expect(
      getMirrorSources(["OpenAI", "anthropic"])
        .map((s) => s.key)
        .sort()
    ).toEqual(["anthropic", "openai"]);
  });

  it("throws naming unknown keys when some requested keys are unknown", () => {
    expect(() => getMirrorSources(["nope"])).toThrow(
      "Unknown mirror source(s): nope"
    );
    // unknown keys are reported in their lowercased form, matching the lookup
    expect(() =>
      getMirrorSources(["anthropic", "nope", "ALSO-MISSING"])
    ).toThrow("Unknown mirror source(s): nope, also-missing");
  });

  it("does not throw when every requested key is known", () => {
    expect(() => getMirrorSources(["anthropic", "openai"])).not.toThrow();
  });
});
