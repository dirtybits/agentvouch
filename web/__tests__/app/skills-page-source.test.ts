import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("skills page source", () => {
  it("derives purchased state from both purchases and direct listing flags", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/skills/MarketplaceClient.tsx"),
      "utf8"
    );

    expect(source).toContain("const purchasedSkillListingKeys = useMemo");
    expect(source).toContain("purchase.account.skillListing");
    expect(source).toContain("Already purchased with this wallet.");
    expect(source).toContain("Purchase status is temporarily unavailable");
    expect(source).not.toContain(") : purchaseStatusUnavailable ? (");
  });

  it("uses server-scoped buyer status without broad browser-side marketplace scans", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/skills/MarketplaceClient.tsx"),
      "utf8"
    );

    expect(source).toContain("fetch(`/api/skills?${params}`)");
    expect(source).toContain('params.set("mode", "fast")');
    expect(source).toContain("MARKETPLACE_PAGE_SIZE");
    expect(source).toContain('params.set("pageSize", String(MARKETPLACE_PAGE_SIZE))');
    expect(source).toContain('fetch("/api/skills/hydrate"');
    expect(source).toContain("buyer: publicKey ? String(publicKey) : null");
    expect(source).toContain('fetch("/api/skills/activity")');
    expect(source).not.toContain("oracle.getAllSkillListings");
    expect(source).not.toContain("oracle.getAllPurchases");
    expect(source).not.toContain("oracle.getPurchasedSkillListingKeys");
  });

  it("debounces search, resets pagination, and ignores stale browse responses", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/skills/MarketplaceClient.tsx"),
      "utf8"
    );

    expect(source).toContain("SEARCH_DEBOUNCE_MS");
    expect(source).toContain("debouncedSearch");
    expect(source).toContain("setPage(1);");
    expect(source).toContain("browseRequestRef");
    expect(source).toContain("browseRequestRef.current !== requestId");
    expect(source).not.toContain("if (search) params.set(\"q\", search)");
  });

  it("filters marketplace cards by clicked skill tags", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/skills/MarketplaceClient.tsx"),
      "utf8"
    );

    expect(source).toContain("selectedTag");
    expect(source).toContain('params.set("tags", selectedTag)');
    expect(source).toContain("const handleTagClick");
    expect(source).toContain("setSelectedTag(tag)");
    expect(source).toContain("onTagClick={handleTagClick}");
    expect(source).toContain("Showing tag");
    expect(source).toContain("Clear");
  });

  it("shows USDC purchase preflight warnings for paid skills", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/skills/MarketplaceClient.tsx"),
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
      path.join(process.cwd(), "app/skills/MarketplaceClient.tsx"),
      "utf8"
    );

    expect(source).toContain("getAuthorActionHref");
    expect(source).toContain('"edit-listing"');
    expect(source).toContain('"publish-version"');
    expect(source).toContain("Edit Listing");
    expect(source).toContain("Publish New Version");
  });
});
