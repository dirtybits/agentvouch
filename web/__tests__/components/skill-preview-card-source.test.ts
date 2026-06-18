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
    expect(source).toContain('variant: "price"');
    expect(source).toContain("bg-[var(--sea-accent-soft)]");
    expect(source.indexOf("if (params.hasPurchased)")).toBeLessThan(
      source.indexOf("if (params.hasUsdcPrimary)")
    );
  });

  it("renders skill tags as clickable filters when a handler is provided", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "components/SkillPreviewCard.tsx"),
      "utf8"
    );

    expect(source).toContain("onTagClick?: (tag: string) => void");
    expect(source).toContain("onClick={() => onTagClick(tag)}");
    expect(source).toContain("Show all skills tagged");
  });

  it("formats wallet author labels and exposes linked GitHub profiles", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "components/SkillPreviewCard.tsx"),
      "utf8"
    );

    expect(source).toContain("formatWalletAuthorLabel");
    expect(source).toContain("skill.author_identity");
    expect(source).toContain("skill.author_identity?.githubProfile");
    expect(source).toContain("Linked GitHub");
  });
});
