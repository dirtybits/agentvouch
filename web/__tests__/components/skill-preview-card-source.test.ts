import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("SkillPreviewCard source", () => {
  it("renders USDC-primary listings distinctly from free listings", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "components/SkillPreviewCard.tsx"),
      "utf8"
    );

    expect(source).toContain("price_usdc_micros");
    expect(source).toContain('skill.payment_flow === "listing-required"');
    expect(source).toContain('skill.payment_flow === "x402-usdc"');
    expect(source).toContain("UsdcIcon");
    expect(source).toContain("Listing Required");
    expect(source).toContain("Pay with USDC");
    expect(source).toContain("Connect Wallet to Pay");
    expect(source).toContain("USDC");
    expect(source.indexOf(") : hasPurchased ? (")).toBeLessThan(
      source.indexOf(") : hasUsdcPrimary ? (")
    );
  });
});
