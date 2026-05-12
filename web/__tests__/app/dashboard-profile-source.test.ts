import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("dashboard profile source", () => {
  it("shows a purchased skills section in the profile tab", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/dashboard/page.tsx"),
      "utf8"
    );

    expect(source).toContain("Purchased");
    expect(source).toContain("Skills this wallet has already bought on-chain.");
    expect(source).toContain("No purchased skills yet.");
    expect(source).toContain("Purchased skills are unavailable right now.");
    expect(source).toContain("Marketplace Listings");
    expect(source).toContain("purchasePreflightMessage");
    expect(source).toContain("USDC");
  });

  it("links marketplace listings into author edit and version publish actions", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/dashboard/page.tsx"),
      "utf8"
    );

    expect(source).toContain("getAuthorActionHref");
    expect(source).toContain('"edit-listing"');
    expect(source).toContain('"publish-version"');
    expect(source).toContain("Edit Listing");
    expect(source).toContain("Publish New Version");
  });
});
