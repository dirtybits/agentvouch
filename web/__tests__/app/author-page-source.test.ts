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

    expect(source).toContain(
      "This connected wallet is staking behind this author"
    );
    expect(source).toContain("REWARD_INDEX_SCALE");
    expect(source).toContain("rewardIndexUsdcMicrosX1e12");
    expect(source).toContain("entryAuthorRewardIndexX1e12");
    expect(source).toContain("pendingRewardsUsdcMicros");
    expect(source).toContain("authorUnclaimedVoucherRevenueUsdcMicros");
    expect(source).toContain("Author-wide reward pool");
    expect(source).not.toContain(
      "listing.account.unclaimedVoucherRevenueUsdcMicros"
    );
  });

  it("shows a username in the author header when identity has one", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/author/[pubkey]/page.tsx"),
      "utf8"
    );

    expect(source).toContain("authorDisplayHandle");
    expect(source).toContain("authorIdentity?.username");
    expect(source).toContain("Author Trust Record");
  });

  it("shows settings only on the connected user's public author profile", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/author/[pubkey]/page.tsx"),
      "utf8"
    );

    expect(source).toContain("{isOwnProfile && (");
    expect(source).toContain('href="/settings"');
    expect(source).toContain("FiSettings");
  });

  it("routes Base author trust writes through the writable ChainWallet seam", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/author/[pubkey]/page.tsx"),
      "utf8"
    );

    expect(source).toContain("useWritableChainWallet");
    expect(source).toContain("BASE_SEPOLIA_CHAIN_CONTEXT");
    expect(source).toContain("activeChainWallet.vouchForAuthor");
    expect(source).toContain("activeChainWallet.openAuthorReport");
    expect(source).toContain("authorCanReceiveTrust");
    expect(source).toContain("isEvmAddress(pubkey)");
    expect(source).toContain("setVouchTxExplorerUrl(result.explorerUrl)");
    expect(source).toContain("setClaimTxExplorerUrl(result.explorerUrl)");
  });

  it("renders Base author trust from chain-neutral trustData instead of Solana profile state", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/author/[pubkey]/page.tsx"),
      "utf8"
    );

    expect(source).toContain(
      "const authorIsRegistered = Boolean(trustData?.isRegistered);"
    );
    expect(source).toContain(
      "const registeredAt = Number(trustData?.registeredAt ?? 0);"
    );
    expect(source).toContain("{!authorIsRegistered ? (");
    expect(source).toContain("{!isOwnProfile && authorIsRegistered && (");
    expect(source).not.toContain("{!profile ? (");
    expect(source).not.toContain("{!isOwnProfile && profile && (");
  });
});
