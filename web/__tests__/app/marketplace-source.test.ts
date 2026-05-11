import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("marketplace source", () => {
  it("uses the activity API and renders USDC feed items", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/skills/page.tsx"),
      "utf8"
    );

    expect(source).toContain("/api/skills/activity");
    expect(source).toContain("priceUsdcMicros");
    expect(source).toContain("UsdcIcon");
    expect(source).toContain("buyerHasPurchased");
    expect(source).toContain('skill.source === "repo" || Boolean(listingPubkey)');
    expect(source).toContain("hasAccessPath={hasAccessPath}");
  });
});
