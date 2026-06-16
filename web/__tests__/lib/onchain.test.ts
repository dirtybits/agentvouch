import { describe, expect, it } from "vitest";

import {
  isCurrentSkillListingAccountData,
  SKILL_LISTING_ACCOUNT_SIZE,
} from "@/lib/onchain";

describe("on-chain skill listing guards", () => {
  it("accepts current M13 skill listing account size", () => {
    expect(
      isCurrentSkillListingAccountData(
        new Uint8Array(SKILL_LISTING_ACCOUNT_SIZE)
      )
    ).toBe(true);
  });

  it("rejects legacy-sized skill listing account data before decode", () => {
    expect(isCurrentSkillListingAccountData(new Uint8Array(787))).toBe(false);
  });
});
