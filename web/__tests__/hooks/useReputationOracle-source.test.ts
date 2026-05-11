import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("useReputationOracle source", () => {
  it("memoizes the returned API object", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "hooks/useReputationOracle.ts"),
      "utf8"
    );

    expect(source).toContain("return useMemo(");
    expect(source).toContain("connected: !!connected");
    expect(source).toContain("getPurchasedSkillListingKeys");
  });

  it("re-checks the purchase PDA after a failed purchase send", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "hooks/useReputationOracle.ts"),
      "utf8"
    );

    expect(source).toContain("const existingPurchaseAfterFailure");
    expect(source).toContain("if (existingPurchaseAfterFailure?.exists)");
    expect(source).toContain("alreadyPurchased: true");
  });

  it("runs the shared purchase preflight before sending a paid purchase", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "hooks/useReputationOracle.ts"),
      "utf8"
    );

    expect(source).toContain("estimatePurchasePreflight");
    expect(source).toContain('"authorPayoutRentBlocked"');
    expect(source).toContain('"authorMissingBacking"');
    expect(source).toContain("buildPurchaseBalanceError");
  });

  it("preserves per-account signer metadata when sending instructions", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "hooks/useReputationOracle.ts"),
      "utf8"
    );

    expect(source).toContain("export function normalizeInstructionForSend");
    expect(source).toContain("export function buildTransactionSendRequest");
    expect(source).toContain("signer?: TransactionSigner");
    expect(source).toContain('"signer" in acc && acc.signer');
    expect(source).toContain("authority: signer");
  });

  it("runs cluster guards before other wallet-driven mutations", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "hooks/useReputationOracle.ts"),
      "utf8"
    );

    expect(source).toContain(
      "await assertRegisterAgentClusterReady(walletAddress)"
    );
    expect(source).toContain("await assertResolveAuthorDisputeClusterReady({");
    expect(source).toContain("await assertOpenAuthorDisputeClusterReady({");
    expect(source).toContain("await assertSkillListingClusterReady({");
  });
});
