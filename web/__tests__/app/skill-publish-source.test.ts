import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("skill publish source", () => {
  it("uses the USDC icon for the payment mode and primary price surfaces", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/skills/publish/page.tsx"),
      "utf8"
    );

    expect(source).toContain("UsdcIcon");
    expect(source).toContain("Listing Mode");
    expect(source).toContain("GitHub publisher");
    expect(source).toContain("Primary price");
    expect(source).toContain("purchase_skill");
    expect(source).toContain("USDC");
  });
});
