import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("skill detail source", () => {
  it("shows USDC price, receipt rent, and preflight warnings", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/skills/[id]/SkillDetailClient.tsx"),
      "utf8"
    );

    expect(source).toContain("paid download docs");
    expect(source).toContain("estimatedPurchaseRentLamports");
    expect(source).toContain("purchasePreflightMessage");
  });

  it("documents signed download instructions for paid skills", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/skills/[id]/SkillDetailClient.tsx"),
      "utf8"
    );

    expect(source).toContain(
      "This connected wallet is the author for this skill. Use the author actions below to manage the listing instead of purchasing it."
    );
    expect(source).toContain('href="#author-actions"');
    expect(source).toContain("Manage Listing");
    expect(source).toContain("X-AgentVouch-Auth");
    expect(source).toContain("listing-required");
    expect(source).toContain("/docs#paid-skill-download");
    expect(source).toContain("purchase_skill");
    expect(source).toContain("buyerHasPurchased");
    expect(source).toContain("UsdcIcon");
    expect(source).toContain("Pay with USDC");
    expect(source).toContain("getConfiguredSolanaExplorerAddressUrl");
    expect(source).toContain("View PDA");
    expect(source).toContain("Sign & Download");
    expect(source).toContain("buildDownloadRawMessage");
    expect(source).toContain("createSignedDownloadAuthPayload");
    expect(source).toContain("recommendedActionFromSignals(sigs)");
    expect(source).toContain("@/lib/authPayload");
    expect(source).not.toContain('@/lib/auth"');
    expect(source).toContain("buildPaidSkillDownloadRequiredMessage");
    expect(source).toContain("fetchSignedSkill");
    expect(source).toContain("downloadEntitledSkill");
    expect(source).not.toContain("fetchChainSkillContent");
    expect(source).not.toContain("Buy & Install");
  });

  it("lets free skills download without forcing wallet connection", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/skills/[id]/SkillDetailClient.tsx"),
      "utf8"
    );

    expect(source).toContain("handleFreeDownload");
    expect(source).toContain('${isMultiFile ? "zip" : "raw"}');
    expect(source).toContain("Download SKILL.md");
    expect(source).toContain("without connecting a wallet");
    expect(source).not.toContain("Connect wallet to install");
  });

  it("keeps repo-backed listing edits and repo version publishing as separate author actions", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/skills/[id]/SkillDetailClient.tsx"),
      "utf8"
    );

    expect(source).toContain(
      "Repo-backed listings stay pinned to the canonical raw"
    );
    expect(source).toContain("endpoint.");
    expect(source).toContain("Publish New Version");
    expect(source).toContain("buildSignMessage");
    expect(source).toContain('requestedAuthorAction === "publish-version"');
    expect(source).toContain("Listing edits stay on the on-chain");
  });

  it("labels Base orphan repair as sync, not duplicate listing", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/skills/[id]/SkillDetailClient.tsx"),
      "utf8"
    );

    expect(source).toContain("needsBaseListingSync");
    expect(source).toContain("Sync Base Listing");
    expect(source).toContain("Sync Now");
    expect(source).toContain("Base listing linked");
  });

  it("passes the skill title into the multi-file tree", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/skills/[id]/SkillDetailClient.tsx"),
      "utf8"
    );

    expect(source).toContain("skillName={skill.name}");
  });

  it("renders from an initial server snapshot before buyer hydration", () => {
    const clientSource = fs.readFileSync(
      path.join(process.cwd(), "app/skills/[id]/SkillDetailClient.tsx"),
      "utf8"
    );
    const pageSource = fs.readFileSync(
      path.join(process.cwd(), "app/skills/[id]/[skill]/page.tsx"),
      "utf8"
    );

    expect(clientSource).toContain("initialSkill?: SkillDetail | null");
    expect(clientSource).toContain(
      "useState<SkillDetail | null>(initialSkill)"
    );
    expect(clientSource).toContain("useState(!initialSkill)");
    expect(clientSource).toContain("refreshSkill({ includeBuyer: false })");
    expect(clientSource).toContain("buyerChainContext?: string | null");
    expect(clientSource).toContain("buyerAddress: activeWalletAddress");
    expect(clientSource).toContain("buyerChainContext: activeChainContext");
    expect(clientSource).toContain('params.set("trust", "live")');
    expect(clientSource).toContain('cache: "no-store"');
    expect(clientSource).not.toContain("if (skill) return");
    expect(pageSource).toContain("loadSkillDetailSnapshot(route.id)");
    expect(pageSource).toContain("initialSkill={initialSkill}");
  });
});
