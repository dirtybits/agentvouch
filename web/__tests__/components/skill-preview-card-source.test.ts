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
    expect(source).toContain("Setup");
    expect(source).toContain("primaryUsdcPrice");
    expect(source).toContain("Installed");
    expect(source).toContain("USDC");
    expect(source.indexOf("if (params.hasPurchased)")).toBeLessThan(
      source.indexOf("if (params.hasUsdcPrimary)")
    );
  });
});
