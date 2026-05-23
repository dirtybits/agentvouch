import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("author page source", () => {
  it("explains skill-linked disputes without manual voucher selection", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/author/[pubkey]/page.tsx"),
      "utf8"
    );

    expect(source).not.toContain("Link backing vouchers");
    expect(source).not.toContain("Link to report");
    expect(source).toContain("Author-wide backing snapshot");
    expect(source).toContain("skill-linked author dispute");
    expect(source).toContain("Free-skill disputes cap slashing at author bond");
  });

  it("clears report route state when dismissing the modal", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/author/[pubkey]/page.tsx"),
      "utf8"
    );

    expect(source).toContain("clearClaimRouteParams");
    expect(source).toContain('nextParams.delete("report")');
    expect(source).toContain("claimRouteDismissed");
    expect(source).toContain("onClick={closeClaimModal}");
    expect(source).toContain('aria-label="Close report dialog"');
  });

  it("shows viewer backing and estimates voucher revenue from author-wide reward indexes", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/author/[pubkey]/page.tsx"),
      "utf8"
    );

    expect(source).toContain("This connected wallet is staking behind this author");
    expect(source).toContain("REWARD_INDEX_SCALE");
    expect(source).toContain("rewardIndexUsdcMicrosX1e12");
    expect(source).toContain("entryAuthorRewardIndexX1e12");
    expect(source).toContain("pendingRewardsUsdcMicros");
    expect(source).toContain("authorUnclaimedVoucherRevenueUsdcMicros");
    expect(source).toContain("Author-wide reward pool");
    expect(source).not.toContain("listing.account.unclaimedVoucherRevenueUsdcMicros");
  });
});
