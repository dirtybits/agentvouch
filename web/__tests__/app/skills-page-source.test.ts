import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("skills page source", () => {
  it("derives purchased state from both purchases and direct listing flags", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/skills/page.tsx"),
      "utf8"
    );

    expect(source).toContain("const purchasedSkillListingKeys = useMemo");
    expect(source).toContain("purchase.account.skillListing");
    expect(source).toContain("Already purchased with this wallet.");
    expect(source).toContain("Purchase status is temporarily unavailable");
    expect(source).not.toContain(") : purchaseStatusUnavailable ? (");
  });

  it("does not run broad browser-side marketplace scans on initial browse mount", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/skills/page.tsx"),
      "utf8"
    );

    expect(source).toContain("fetch(`/api/skills?${params}`)");
    expect(source).toContain('fetch("/api/skills/activity")');
    expect(source).not.toContain("oracle.getAllSkillListings");
    expect(source).not.toContain("oracle.getAllPurchases");
    expect(source).not.toContain("oracle.getPurchasedSkillListingKeys");
    expect(source).not.toContain('params.set("buyer"');
  });

  it("shows USDC purchase preflight warnings for paid skills", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/skills/page.tsx"),
      "utf8"
    );

    expect(source).toContain("estimatedBuyerTotalLamports");
    expect(source).toContain("price_usdc_micros");
    expect(source).toContain("purchasePreflightStatus");
    expect(source).toContain("purchaseBlocked={purchaseBlocked}");
    expect(source).toContain("legacySolLamports");
  });

  it("links author listing cards into edit and repo version actions", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/skills/page.tsx"),
      "utf8"
    );

    expect(source).toContain("getAuthorActionHref");
    expect(source).toContain('"edit-listing"');
    expect(source).toContain('"publish-version"');
    expect(source).toContain("Edit Listing");
    expect(source).toContain("Publish New Version");
  });
});
