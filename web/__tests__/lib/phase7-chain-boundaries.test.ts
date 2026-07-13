import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

// Phase 7 — chain-aware address/explorer boundaries. Behavioral coverage for the pure helper
// lives in chainAddress.test.ts; these source assertions lock the boundary wiring.

describe("phase 7: mixed-chain API boundaries accept EVM buyers", () => {
  it("browse buyer status is chain-aware", () => {
    const source = read("app/api/skills/route.ts");
    expect(source).toContain("normalizeChainAddressForStorage");
    expect(source).toContain("addEvmBuyerStatus");
    expect(source).toContain("hasChainUsdcPurchaseEntitlement");
  });

  it("hydrate buyer status is chain-aware", () => {
    const source = read("app/api/skills/hydrate/route.ts");
    expect(source).toContain("buyerChainContext");
    expect(source).toContain("normalizeChainAddressForStorage");
    expect(source).toContain("hasChainUsdcPurchaseEntitlement");
  });

  it("an explicit EVM buyer context is exclusive — no Solana fallback on invalid values", () => {
    // If buyerChainContext says eip155:* but the buyer value fails EVM validation, the
    // request must get NO buyer status rather than silently running the Solana path.
    for (const file of [
      "app/api/skills/route.ts",
      "app/api/skills/hydrate/route.ts",
    ]) {
      const source = read(file);
      expect(source, `${file} should gate EVM exclusively`).toContain(
        "wantsEvmBuyer"
      );
      expect(
        source,
        `${file} Solana buyer parse must be gated on !wantsEvmBuyer`
      ).toContain("!wantsEvmBuyer");
      expect(
        source,
        `${file} must not fall back to Solana when EVM normalization returns null`
      ).not.toMatch(/!evmBuyer(Address)?\s*&&.*isAddress/s);
    }
  });

  it("dashboard purchases returns empty for EVM buyers instead of rejecting them", () => {
    const source = read("app/api/dashboard/purchases/route.ts");
    expect(source).toContain("isEvmShapedAddress");
    expect(source).toContain("{ purchases: [], listings: [] }");
    // The Solana PDA enumeration is gated behind the EVM early return.
    expect(source.indexOf("{ purchases: [], listings: [] }")).toBeLessThan(
      source.indexOf("getProgramAccounts")
    );
  });
});

describe("phase 7: UI shorteners route through the shared helper", () => {
  it("cross-chain display surfaces use shortenChainAddress", () => {
    for (const file of [
      "components/SkillPreviewCard.tsx",
      "app/skills/[id]/SkillDetailClient.tsx",
      "app/author/[pubkey]/page.tsx",
    ]) {
      expect(read(file), `${file} should use shortenChainAddress`).toContain(
        "shortenChainAddress"
      );
    }
  });

  it("storage boundaries never use the display formatter", () => {
    // formatChainAddressForDisplay may checksum EVM addresses; API/DB writes must use the
    // storage normalizer to preserve the Phase 6 lowercase invariant.
    for (const file of [
      "app/api/skills/route.ts",
      "app/api/skills/hydrate/route.ts",
      "app/api/dashboard/purchases/route.ts",
      "lib/usdcPurchases.ts",
      "lib/db.ts",
    ]) {
      expect(
        read(file).includes("formatChainAddressForDisplay"),
        `${file} must not use the display formatter`
      ).toBe(false);
    }
  });
});
