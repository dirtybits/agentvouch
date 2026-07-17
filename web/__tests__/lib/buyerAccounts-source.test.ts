import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "lib/buyerAccounts.ts"),
  "utf8"
);

describe("buyer account identity resolution", () => {
  it("serializes first-login creation and keys identity by provider subject", () => {
    expect(source).toContain("pg_advisory_xact_lock");
    expect(source).toContain("ON CONFLICT (provider, provider_subject)");
    expect(source).toContain("RETURNING id, status");
    expect(source).toContain("JOIN selected_account");
    expect(source).not.toContain(
      "JOIN buyer_accounts\n          ON buyer_accounts.id = linked_identity"
    );
    expect(source).not.toContain("email AS");
    expect(source).not.toContain("author_pubkey");
  });
});
