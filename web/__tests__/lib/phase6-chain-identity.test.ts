import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { getSkillPaymentFlow } from "@/lib/listingContract";

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

// Phase 6 — multichain database hardening. SQL-layer invariants are asserted at the
// source level (the vitest harness has no database); pure helpers are exercised directly.
// See .agents/plans/base-port-chain-adapter-phase-6.plan.md.

describe("phase 6: skills EVM listing identity", () => {
  const dbSource = read("lib/db.ts");
  const skillsRouteSource = read("app/api/skills/[id]/route.ts");

  it("runtime schema keeps only additive, race-tolerant EVM identity DDL", () => {
    expect(dbSource).toContain("idx_skills_evm_listing");
    // Data normalization of existing rows belongs to the standalone migration, not the
    // request-time initializer.
    expect(dbSource).not.toContain(
      "SET evm_contract_address = LOWER(evm_contract_address)"
    );
    // The UNIQUE variant is reserved for the standalone guarded migration.
    expect(dbSource).not.toContain("uidx_skills_evm_listing_identity");
  });

  it("Base listing persistence lowercases the contract address and clears on_chain_address", () => {
    expect(skillsRouteSource).toContain(
      "evm_contract_address = ${verification.onChainProgramId.toLowerCase()}"
    );
    expect(skillsRouteSource).toContain("on_chain_address = NULL");
  });
});

describe("phase 6: standalone chain-identity migration", () => {
  const migrationSource = read("scripts/phase6-chain-identity-migration.ts");

  it("preflights duplicates for both identity keys before any DDL", () => {
    expect(migrationSource).toContain("findEvmListingDuplicates");
    expect(migrationSource).toContain("findEntitlementDuplicates");
    expect(migrationSource).toContain(
      "Preflight reported duplicates; aborting without DDL."
    );
  });

  it("creates partial unique indexes and never touches the legacy primary key", () => {
    expect(migrationSource).toContain("uidx_skills_evm_listing_identity");
    expect(migrationSource).toContain(
      "uidx_usdc_purchase_entitlements_chain_buyer"
    );
    expect(migrationSource).toContain("buyer_chain_context IS NOT NULL");
    expect(migrationSource).toContain("buyer_address IS NOT NULL");
    expect(migrationSource).not.toContain("DROP CONSTRAINT");
    expect(migrationSource).not.toContain("ADD PRIMARY KEY");
  });

  it("normalizes existing EVM addresses to what new writes store before creating unique indexes", () => {
    expect(migrationSource).toContain(
      "SET evm_contract_address = LOWER(evm_contract_address)"
    );
    expect(migrationSource).toContain(
      "SET buyer_address = LOWER(buyer_address)"
    );
    expect(migrationSource).toContain("UPDATE usdc_purchase_entitlements");
    expect(migrationSource).toContain("UPDATE usdc_purchase_receipts");
    // Preflight groups EVM buyers case-insensitively so it sees what the index will see.
    expect(migrationSource).toContain(
      "WHEN buyer_chain_context LIKE 'eip155:%' THEN LOWER(buyer_address)"
    );
  });

  it("migrate refuses to run against an unconfirmed database host", () => {
    expect(migrationSource).toContain("EXPECTED_DATABASE_HOST");
    expect(migrationSource).toContain("assertExpectedDatabaseHost(host)");
  });
});

describe("phase 6: chain-qualified entitlement semantics", () => {
  const usdcSource = read("lib/usdcPurchases.ts");

  it("keeps the legacy (skill_db_id, buyer_pubkey) upsert path for Phase 6", () => {
    expect(usdcSource).toContain("ON CONFLICT (skill_db_id, buyer_pubkey)");
    expect(usdcSource).toContain("PRIMARY KEY (skill_db_id, buyer_pubkey)");
  });

  it("receipt upsert also compares chain-qualified buyer fields (D3)", () => {
    expect(usdcSource).toContain(
      "usdc_purchase_receipts.buyer_chain_context = EXCLUDED.buyer_chain_context"
    );
    expect(usdcSource).toContain(
      "usdc_purchase_receipts.buyer_address = EXCLUDED.buyer_address"
    );
    // NULL-tolerant so pre-backfill legacy rows keep re-verifying.
    expect(usdcSource).toContain(
      "usdc_purchase_receipts.buyer_chain_context IS NULL"
    );
  });

  it("normalizes EVM buyer addresses to lowercase for chain-qualified storage and lookup", () => {
    expect(usdcSource).toContain(
      'chainContext?.startsWith("eip155:") ? trimmed.toLowerCase() : trimmed'
    );
  });
});

describe("phase 6: trust reads scoped by row chain context", () => {
  const browseSource = read("lib/marketplaceBrowse.ts");
  const snapshotSource = read("lib/skillDetailSnapshot.ts");
  const trustSnapshotsSource = read("lib/trustSnapshots.ts");

  it("marketplace and detail trust joins follow the skill row's chain context", () => {
    for (const source of [browseSource, snapshotSource]) {
      expect(source).toContain(
        "ats.chain_context = COALESCE(s.chain_context, ${configuredSolanaChainContext})"
      );
      expect(source).toContain(
        "owner_binding.chain_context = COALESCE(s.chain_context, ${configuredSolanaChainContext})"
      );
      expect(source).not.toContain(
        "ats.chain_context = ${configuredSolanaChainContext}\n"
      );
    }
  });

  it("EVM-shaped authors never enter the Solana trust snapshot pipeline", () => {
    expect(trustSnapshotsSource).toContain("isEvmShapedWallet");
    expect(trustSnapshotsSource).toContain("AND author_pubkey NOT LIKE '0x%'");
  });
});

describe("phase 6: activity exposes chain-qualified actors", () => {
  const activitySource = read("app/api/skills/activity/route.ts");
  const marketplaceClientSource = read("app/skills/MarketplaceClient.tsx");

  it("activity route selects buyer chain identity and EVM listing/purchase fields", () => {
    expect(activitySource).toContain("r.buyer_chain_context");
    expect(activitySource).toContain("r.buyer_address");
    expect(activitySource).toContain("r.evm_listing_id");
    expect(activitySource).toContain("r.evm_purchase_id");
    expect(activitySource).toContain("evmListingId: skill.evm_listing_id");
  });

  it("marketplace feed prefers buyer_address + buyer_chain_context with legacy fallback", () => {
    expect(marketplaceClientSource).toContain(
      "purchase.buyer_address ?? purchase.buyer_pubkey"
    );
    expect(marketplaceClientSource).toContain(
      "purchase.buyer_chain_context ?? purchase.chain_context"
    );
  });
});

describe("phase 6: payment flow for Base listings", () => {
  it("a paid skill with an EVM listing id is direct-purchase, not listing-required", () => {
    expect(
      getSkillPaymentFlow({
        priceUsdcMicros: "1000000",
        onChainAddress: null,
        evmListingId: "0x" + "ab".repeat(32),
      })
    ).toBe("direct-purchase-skill");
  });

  it("a paid skill with neither listing form still requires a listing", () => {
    expect(
      getSkillPaymentFlow({
        priceUsdcMicros: "1000000",
        onChainAddress: null,
        evmListingId: null,
      })
    ).toBe("listing-required");
  });

  it("a Solana-listed paid skill keeps its direct-purchase flow", () => {
    expect(
      getSkillPaymentFlow({
        priceUsdcMicros: "1000000",
        onChainAddress: "SoLanaListingAddress11111111111111111111111",
        evmListingId: null,
      })
    ).toBe("direct-purchase-skill");
  });
});

describe("phase 6: Base raw access stays clear of Solana PDA/ATA code", () => {
  const rawAccessSource = read("lib/skillRawAccess.ts");

  it("routes Base-listed skills to the Base x402 handler before any ATA derivation", () => {
    const baseBranch = rawAccessSource.indexOf(
      "isBaseProtocolListedUsdcSkill(skill, priceMicros)"
    );
    const ataDerivation = rawAccessSource.indexOf(
      "await deriveAssociatedTokenAccount(",
      rawAccessSource.indexOf("async function handleUsdcDirect")
    );
    expect(baseBranch).toBeGreaterThan(-1);
    expect(ataDerivation).toBeGreaterThan(-1);
    expect(baseBranch).toBeLessThan(ataDerivation);
  });

  it("Base raw entitlement checks are chain-qualified", () => {
    expect(rawAccessSource).toContain("hasChainUsdcPurchaseEntitlement");
    expect(rawAccessSource).toContain(
      "buyerChainContext: BASE_SEPOLIA_CHAIN_CONTEXT"
    );
  });
});
