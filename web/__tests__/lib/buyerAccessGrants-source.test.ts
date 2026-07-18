import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "lib/buyerAccessGrants.ts"),
  "utf8"
);

describe("buyer access grant SQL invariants", () => {
  it("keeps replayed refunded payments revoked and account-bound", () => {
    expect(source).toContain("pg_advisory_xact_lock");
    expect(source).toContain("marketplace_access_grants.status = 'active'");
    expect(source).toContain(
      "marketplace_access_grants.buyer_account_id = EXCLUDED.buyer_account_id"
    );
    expect(source).toContain("status = 'revoked'");
    expect(source).toContain("revoked_reason");
  });

  it("requires both an active grant and active buyer account", () => {
    expect(source).toContain("grants.status = 'active'");
    expect(source).toContain("accounts.status = 'active'");
  });
});
