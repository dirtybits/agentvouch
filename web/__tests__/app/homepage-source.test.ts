import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("homepage source", () => {
  it("uses shared server loaders instead of same-origin HTTP self-fetches", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/page.tsx"),
      "utf8"
    );

    expect(source).toContain("loadLandingPayload()");
    expect(source).toContain("loadMarketplaceBrowseSnapshot({ pageSize: 3 })");
    expect(source).not.toContain("/api/landing");
    expect(source).not.toContain("/api/skills?sort=trusted");
    expect(source).not.toContain("fetchHomepageJson");
    expect(source).not.toContain("getSelfOrigin");
    expect(source).not.toContain("process.env.VERCEL_URL");
  });

  it("shares the landing snapshot loader with the API route", () => {
    const routeSource = fs.readFileSync(
      path.join(process.cwd(), "app/api/landing/route.ts"),
      "utf8"
    );
    const helperSource = fs.readFileSync(
      path.join(process.cwd(), "lib/landingPayload.ts"),
      "utf8"
    );

    expect(routeSource).toContain("loadLandingPayload");
    expect(helperSource).toContain("readPlatformMetricsSnapshot");
    expect(helperSource).toContain("refreshPlatformMetricsSnapshot");
    expect(helperSource).toContain("computeLandingPayloadFromChain");
  });
});
