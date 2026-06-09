import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("marketplace source", () => {
  it("uses the activity API and renders USDC feed items", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/skills/MarketplaceClient.tsx"),
      "utf8"
    );

    expect(source).toContain("/api/skills/activity");
    expect(source).toContain("priceUsdcMicros");
    expect(source).toContain("UsdcIcon");
    expect(source).toContain("buyerHasPurchased");
    expect(source).toContain('skill.source === "repo" || Boolean(listingPubkey)');
    expect(source).toContain("hasAccessPath={hasAccessPath}");
  });

  it("renders the browse view from a server snapshot before client fetching", () => {
    const clientSource = fs.readFileSync(
      path.join(process.cwd(), "app/skills/MarketplaceClient.tsx"),
      "utf8"
    );
    const pageSource = fs.readFileSync(
      path.join(process.cwd(), "app/skills/page.tsx"),
      "utf8"
    );

    expect(clientSource).toContain("initialSkills?: SkillRow[] | null");
    expect(clientSource).toContain("useState<SkillRow[]>(initialSkills ?? [])");
    expect(clientSource).toContain("useState(!initialSkills)");
    expect(clientSource).toContain("snapshotKeyRef");
    expect(pageSource).toContain("loadMarketplaceBrowseSnapshot({");
    expect(pageSource).toContain("initialSkills=");
    expect(pageSource).toContain("MARKETPLACE_PAGE_SIZE");
  });

  it("keeps the client page size in sync with the server snapshot", () => {
    const clientSource = fs.readFileSync(
      path.join(process.cwd(), "app/skills/MarketplaceClient.tsx"),
      "utf8"
    );
    const browseSource = fs.readFileSync(
      path.join(process.cwd(), "lib/marketplaceBrowse.ts"),
      "utf8"
    );

    // The client can't import the server module, so the constant is duplicated;
    // this guards against the two drifting apart.
    expect(clientSource).toContain("const MARKETPLACE_PAGE_SIZE = 9;");
    expect(browseSource).toContain("const MARKETPLACE_PAGE_SIZE = 9;");
  });
});
