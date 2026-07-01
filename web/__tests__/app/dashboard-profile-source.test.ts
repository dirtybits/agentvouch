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

  it("loads purchased skill data through the server dashboard API", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/dashboard/page.tsx"),
      "utf8"
    );

    expect(source).toContain("/api/dashboard/purchases?buyer=");
    expect(source).not.toContain("oracle.getPurchasesByBuyer(publicKey)");
    expect(source).not.toContain("oracle.getAllSkillListings()");
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

  it("surfaces settings as a dashboard tab after disputes", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/dashboard/page.tsx"),
      "utf8"
    );

    expect(source).toContain('href="/settings"');
    expect(source).toContain("FiSettings");
    expect(source).toContain('id: "disputes"');
    expect(source).toContain("<FiSettings className=");
  });

  it("links vouch dashboard rows through author wallets instead of AgentProfile PDAs", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/dashboard/page.tsx"),
      "utf8"
    );

    expect(source).toContain("profileAuthorityByPda");
    expect(source).toContain("getAgentProfileByAddress(address(profileKey))");
    expect(source).toContain("const voucherHref");
    expect(source).toContain("const voucheeHref");
    expect(source).toContain("voucherAuthority ?? voucherProfile");
    expect(source).toContain("voucheeAuthority ?? voucheeProfile");
    expect(source).not.toContain("href={`/author/${voucher}`}");
    expect(source).not.toContain("href={`/author/${vouchee}`}");
  });
});
