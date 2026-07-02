import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

// Phase 2 circle-back — Solana adapter/wallet seam invariants, asserted at the source level
// (the vitest harness has no wallet providers). See
// .agents/plans/base-port-chain-adapter-phase-2-circleback.plan.md.

describe("phase 2: writable chain wallet seam", () => {
  const providerSource = read("components/WalletContextProvider.tsx");
  const writableHookSource = read("hooks/useWritableChainWallet.ts");
  const facadeSource = read("lib/adapters/solanaWallet.ts");

  it("keeps the header wallet provider free of the Solana write stack", () => {
    expect(providerSource).not.toContain("useReputationOracle");
    expect(providerSource).not.toContain("useMarketplaceOracle");
    expect(providerSource).not.toContain("solanaWrites");
    expect(providerSource).not.toContain("solanaWallet");
  });

  it("no longer leaves connected Solana sessions without a writable wallet", () => {
    expect(writableHookSource).toContain("createSolanaChainWallet");
    expect(writableHookSource).toContain('chain.solana.status === "connected"');
    // Base passkey sessions pass the provider-built ChainWallet through untouched.
    expect(writableHookSource).toContain(
      "if (baseChainWallet) return baseChainWallet;"
    );
  });

  it("Solana facade rejects buildX402Payment honestly until Phase 2d", () => {
    expect(facadeSource).toContain("buildX402Payment");
    expect(facadeSource).toContain("Phase 2d");
    expect(facadeSource).toContain("Promise.reject");
  });

  it("Solana facade enforces the displayed price like the Base wallet", () => {
    expect(facadeSource).toContain(
      "expectedPriceUsdcMicros: purchase.expectedPriceUsdcMicros"
    );
    const writesSource = read("lib/solanaWrites.ts");
    expect(writesSource).toContain("Refresh before purchasing.");
  });

  it("Base passkey wallet behavior is untouched", () => {
    const baseWalletSource = read("lib/adapters/baseWallet.ts");
    expect(baseWalletSource).toContain("createBasePasskeyChainWallet");
    expect(baseWalletSource).toContain("purchaseBaseSkill");
    expect(baseWalletSource).toContain("Refresh before purchasing.");
  });
});

describe("phase 2: purchase callers use the chain-agnostic facade", () => {
  const detailSource = read("app/skills/[id]/SkillDetailClient.tsx");
  const marketplaceSource = read("app/skills/MarketplaceClient.tsx");

  it("SkillDetailClient routes Solana purchases through the writable wallet", () => {
    expect(detailSource).toContain("useWritableChainWallet");
    expect(detailSource).toContain("listingId: skill.on_chain_address");
    // The already-owned short-circuit still skips verification and re-payment.
    expect(detailSource).toContain("if (!purchaseResult.alreadyPurchased)");
  });

  it("MarketplaceClient quick purchase uses the facade when a price quote exists", () => {
    expect(marketplaceSource).toContain("useWritableChainWallet");
    expect(marketplaceSource).toContain("writableChainWallet.purchaseSkill");
    expect(marketplaceSource).toContain("Already purchased with this wallet.");
  });
});

describe("phase 2: x402 family separation", () => {
  const solanaOnlyMarkers = [
    "browserX402",
    "x402ProtocolBridge",
    "solanaWrites",
    "@solana/kit",
    "@x402/svm",
  ];
  const baseFiles = [
    "lib/baseX402.ts",
    "lib/baseX402Api.ts",
    "lib/basePurchaseVerification.ts",
    "lib/baseListingVerification.ts",
    "lib/adapters/base.ts",
    "lib/adapters/baseWallet.ts",
  ];

  it("Base x402/verification modules never import Solana PDA/ATA/x402 code", () => {
    for (const file of baseFiles) {
      const source = read(file);
      for (const marker of solanaOnlyMarkers) {
        expect(
          source.includes(marker),
          `${file} must not reference ${marker}`
        ).toBe(false);
      }
    }
  });

  it("the Solana x402 modules are explicitly named Solana seams", () => {
    expect(read("lib/browserX402.ts")).toContain("SOLANA/SVM-ONLY x402 seam");
    expect(read("lib/x402ProtocolBridge.ts")).toContain(
      "SOLANA/SVM-ONLY x402 protocol bridge seam"
    );
  });
});

describe("phase 2: safe read repoints", () => {
  it("chain-skill metadata reads go through the adapter seam", () => {
    const source = read("lib/metadataData.ts");
    expect(source).toContain("getAdapter(");
    expect(source).not.toContain('from "@/lib/onchain"');
  });

  it("cache-bypass money paths still use explicit Solana reads", () => {
    // These call sites need fresh chain reads (useCache: false) that the adapter interface
    // does not expose yet; repointing them would silently reintroduce stale-price checks.
    for (const file of [
      "lib/skillRawAccess.ts",
      "lib/sponsoredPurchase.ts",
      "lib/x402ProtocolBridge.ts",
    ]) {
      expect(read(file)).toContain("useCache: false");
    }
  });
});
