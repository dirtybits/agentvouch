import { describe, expect, it, vi } from "vitest";

describe("site URL helpers", () => {
  it("trims whitespace from NEXT_PUBLIC_APP_URL before building canonical URLs", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://agentvouch.xyz\n");

    const { SITE_URL, getCanonicalUrl } = await import("@/lib/site");

    expect(SITE_URL).toBe("https://agentvouch.xyz");
    expect(getCanonicalUrl("/docs")).toBe("https://agentvouch.xyz/docs");
    expect(getCanonicalUrl("/sitemap.xml")).toBe(
      "https://agentvouch.xyz/sitemap.xml"
    );
  });

  it("positions AgentVouch as an agent reputation system and skills marketplace", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();

    const { SITE_DESCRIPTION, SITE_TAGLINE } = await import("@/lib/site");

    // Search-facing positioning leads with the "agent reputation system" head
    // term (see .agents/plans/seo-agent-reputation-system.plan.md); "trust
    // layer" remains brand flavor on machine surfaces (agentvouch.json, llms.txt).
    expect(SITE_DESCRIPTION).toMatch(/agent reputation system/i);
    expect(SITE_DESCRIPTION).toMatch(/skills marketplace/i);
    expect(SITE_TAGLINE).toMatch(/agent reputation system/i);
    expect(SITE_TAGLINE).toMatch(/agent skills/i);
  });
});
