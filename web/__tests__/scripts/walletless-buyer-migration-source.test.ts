import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "scripts/walletless-buyer-migration.ts"),
  "utf8"
);

describe("walletless buyer migration safety", () => {
  it("keeps preflight read-only and migrate host-guarded", () => {
    expect(source).toContain("<preflight|migrate>");
    expect(source).toContain("EXPECTED_DATABASE_HOST");
    const mainBody = source.slice(source.indexOf("async function main()"));
    expect(mainBody.indexOf("assertExpectedDatabaseHost(host)")).toBeLessThan(
      mainBody.indexOf("SELECT current_database()")
    );
    const preflightBody = source.slice(
      source.indexOf("async function preflight"),
      source.indexOf("async function migrate")
    );
    expect(preflightBody).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/
    );
  });

  it("creates only the four additive account and grant tables", () => {
    for (const table of [
      "buyer_accounts",
      "buyer_identity_links",
      "buyer_wallet_links",
      "marketplace_access_grants",
    ]) {
      expect(source).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(source).not.toMatch(/DROP\s+(TABLE|COLUMN|CONSTRAINT)/);
    expect(source).not.toContain("usdc_purchase_entitlements(");
  });
});
