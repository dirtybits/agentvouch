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

  it("positions AgentVouch as both trust layer and skills marketplace", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();

    const { SITE_DESCRIPTION, SITE_TAGLINE } = await import("@/lib/site");

    expect(SITE_DESCRIPTION).toMatch(/trust layer/i);
    expect(SITE_DESCRIPTION).toMatch(/skills marketplace/i);
    expect(SITE_TAGLINE).toMatch(/trust layer/i);
    expect(SITE_TAGLINE).toMatch(/agent skills/i);
  });
});
