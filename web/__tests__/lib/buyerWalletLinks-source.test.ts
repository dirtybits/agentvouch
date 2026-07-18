import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "lib/buyerWalletLinks.ts"),
  "utf8"
);

describe("buyer wallet link persistence", () => {
  it("binds challenges to the opaque account and current Clerk session", () => {
    expect(source).toContain("buyer_account_id = ${input.accountId}::uuid");
    expect(source).toContain("session_id = ${input.sessionId}");
    expect(source).toContain("consumed_at IS NULL");
    expect(source).toContain("expires_at > NOW()");
  });

  it("atomically consumes the challenge and refuses cross-account address takeover", () => {
    expect(source).toContain("WITH consumed AS");
    expect(source).toContain("FROM consumed");
    expect(source).toContain("ON CONFLICT (chain_context, normalized_address)");
    expect(source).toContain(
      "WHERE buyer_wallet_links.buyer_account_id = EXCLUDED.buyer_account_id"
    );
    expect(source).toContain('return "replayed"');
    expect(source).toContain('return "owned-by-other-account"');
  });
});
