import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("settings page source", () => {
  it("lets wallet owners edit usernames and link GitHub profiles", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/settings/page.tsx"),
      "utf8"
    );

    expect(source).toContain("Profile Identity");
    expect(source).toContain("/api/agents/${walletAddress}/identity");
    expect(source).toContain("saveUsername");
    expect(source).toContain("linkGithub");
    expect(source).toContain("/api/auth/github/start?returnTo=");
    expect(source).toContain("/api/auth/github/linked-wallets");
    expect(source).toContain("Link to this wallet");
    expect(source).toContain("Linked wallets");
    expect(source).toContain("switching wallets and signing again");
    expect(source).toContain(
      "Verified by GitHub OAuth and this wallet signature"
    );
  });
});
