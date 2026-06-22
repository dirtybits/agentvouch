import { describe, expect, it } from "vitest";
import {
  buildWalletFallbackUsername,
  formatWalletAuthorLabel,
  shortWalletAddress,
} from "@/lib/authorDisplay";

describe("authorDisplay", () => {
  const wallet = "asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw";

  it("builds wallet fallback usernames from the first wallet characters", () => {
    expect(buildWalletFallbackUsername(wallet)).toBe("wallet-asuavu");
  });

  it("keeps generated fallback usernames stable before and after hydration", () => {
    expect(formatWalletAuthorLabel(wallet)).toBe("wallet-asuavu");
    expect(
      formatWalletAuthorLabel(wallet, {
        username: "wallet-fz7wzg",
        usernameSource: "fallback",
      })
    ).toBe("wallet-asuavu");
  });

  it("preserves user-chosen wallet usernames", () => {
    expect(
      formatWalletAuthorLabel(wallet, {
        username: "dirtybits",
        usernameSource: "user",
      })
    ).toBe("@dirtybits");
    expect(
      formatWalletAuthorLabel(wallet, {
        username: "wallet-human",
        usernameSource: "user",
      })
    ).toBe("@wallet-human");
  });

  it("can still format raw addresses for non-author identifiers", () => {
    expect(shortWalletAddress(wallet)).toBe("asua...WZgw");
  });
});
