import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("skill detail source", () => {
  it("shows USDC price, receipt rent, and preflight warnings", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/skills/[id]/SkillDetailClient.tsx"),
      "utf8"
    );

    expect(source).toContain("USDC primary pricing");
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
    expect(source).toContain("buildPaidSkillDownloadRequiredMessage");
    expect(source).toContain("fetchSignedRawSkill");
    expect(source).not.toContain("fetchChainSkillContent");
    expect(source).not.toContain("Buy & Install");
  });

  it("keeps repo-backed listing edits and repo version publishing as separate author actions", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/skills/[id]/SkillDetailClient.tsx"),
      "utf8"
    );

    expect(source).toContain("Repo-backed listings stay pinned to the canonical raw");
    expect(source).toContain("endpoint.");
    expect(source).toContain("Publish New Version");
    expect(source).toContain("buildSignMessage");
    expect(source).toContain('requestedAuthorAction === "publish-version"');
    expect(source).toContain("Listing edits stay on the on-chain");
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
    expect(clientSource).toContain("useState<SkillDetail | null>(initialSkill)");
    expect(clientSource).toContain("useState(!initialSkill)");
    expect(clientSource).toContain("refreshSkill({ includeBuyer: false })");
    expect(clientSource).toContain("refreshSkill({ includeBuyer: true })");
    expect(pageSource).toContain("loadSkillDetailSnapshot(route.id)");
    expect(pageSource).toContain("initialSkill={initialSkill}");
  });
});
