import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

// Phase 2 circle-back: the register/list/purchase write paths (and their guards) moved to
// lib/solanaWrites.ts so the legacy hooks and the Solana ChainWallet share one implementation.
// The invariants below are asserted against whichever file owns the behavior now.
const hookSource = fs.readFileSync(
  path.join(process.cwd(), "hooks/useReputationOracle.ts"),
  "utf8"
);
const writesSource = fs.readFileSync(
  path.join(process.cwd(), "lib/solanaWrites.ts"),
  "utf8"
);

describe("useReputationOracle source", () => {
  it("memoizes the returned API object", () => {
    expect(hookSource).toContain("return useMemo(");
    expect(hookSource).toContain("connected: !!connected");
    expect(hookSource).toContain("getPurchasedSkillListingKeys");
  });

  it("routes register/list/purchase writes through the shared solanaWrites module", () => {
    expect(hookSource).toContain("registerSolanaAgent(");
    expect(hookSource).toContain("createSolanaSkillListing(writeSession");
    expect(hookSource).toContain("purchaseSolanaSkill(writeSession");
    expect(hookSource).toContain(
      "sendSolanaInstructions({ signer, walletAddress }"
    );
  });

  it("guards the legacy number-priced listing path before bigint conversion", () => {
    expect(hookSource).toContain("Number.isSafeInteger(priceUsdcMicros)");
    expect(hookSource).toContain("priceUsdcMicros: BigInt(priceUsdcMicros)");
  });

  it("runs remaining Solana-only cluster guards in the hook", () => {
    expect(hookSource).toContain(
      "await assertResolveAuthorDisputeClusterReady({"
    );
    expect(hookSource).toContain("await assertOpenAuthorDisputeClusterReady({");
  });
});

describe("solanaWrites source (moved write-path invariants)", () => {
  it("re-checks the purchase PDA after a failed purchase send", () => {
    expect(writesSource).toContain("const existingPurchaseAfterFailure");
    expect(writesSource).toContain("if (existingPurchaseAfterFailure?.exists)");
    expect(writesSource).toContain("alreadyPurchased: true");
  });

  it("runs the shared purchase preflight before sending a paid purchase", () => {
    expect(writesSource).toContain("estimatePurchasePreflight");
    expect(writesSource).toContain('"authorPayoutRentBlocked"');
    expect(writesSource).toContain("buildPurchaseBalanceError");
  });

  it("preserves per-account signer metadata when sending instructions", () => {
    expect(writesSource).toContain(
      "export function normalizeInstructionForSend"
    );
    expect(writesSource).toContain(
      "export function buildTransactionSendRequest"
    );
    expect(writesSource).toContain("signer?: TransactionSigner");
    expect(writesSource).toContain('"signer" in acc && acc.signer');
    expect(writesSource).toContain("authority: signer");
  });

  it("runs cluster guards before register and listing writes", () => {
    expect(writesSource).toContain(
      "await assertRegisterAgentClusterReady(walletAddress)"
    );
    expect(writesSource).toContain("await assertSkillListingClusterReady({");
  });

  it("keeps free-listing authorBond semantics on the bigint path", () => {
    expect(writesSource).toContain(
      "authorBond: priceUsdcMicros === 0n ? authorBond : undefined"
    );
  });
});
