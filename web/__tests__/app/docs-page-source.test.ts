import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("docs page source", () => {
  it("documents the paid skill download flow and signed auth header", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/docs/page.tsx"),
      "utf8"
    );

    expect(source).toContain('id="paid-skill-download"');
    expect(source).toContain("Canonical signed message");
    expect(source).toContain("X-AgentVouch-Auth");
    expect(source).toContain("listing-required");
    expect(source).toContain("x402-usdc-direct");
    expect(source).toContain("purchaseSkill on-chain");
  });

  it("prefers agent vocabulary in the publish flow", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/docs/page.tsx"),
      "utf8"
    );

    expect(source).toContain("agentvouch agent register");
    expect(source).toContain("Agent Publish");
    expect(source).not.toMatch(/agentvouch author register/);
  });
});
