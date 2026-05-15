import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("usdc purchase schema source", () => {
  const source = readFileSync(
    join(process.cwd(), "lib", "usdcPurchases.ts"),
    "utf8"
  );

  it("keeps direct purchase audit metadata in receipts and entitlements", () => {
    expect(source).toContain("DIRECT_PURCHASE_PAYMENT_FLOW");
    expect(source).toContain("payment_flow");
    expect(source).toContain("protocol_version");
    expect(source).toContain("on_chain_program_id");
    expect(source).toContain("chain_context");
    expect(source).toContain("on_chain_address");
    expect(source).toContain("purchase_pda");
  });

  it("keeps x402 bridge settlement provenance in receipts and entitlements", () => {
    expect(source).toContain("X402_BRIDGE_PURCHASE_PAYMENT_FLOW");
    expect(source).toContain("x402_payment_ref_hash");
    expect(source).toContain("x402_settlement_signature_hash");
    expect(source).toContain("x402_settlement_receipt_pda");
    expect(source).toContain("x402_settlement_vault");
  });

  it("does not allow one payment signature to unlock a different buyer or skill", () => {
    expect(source).toContain("ON CONFLICT (payment_tx_signature)");
    expect(source).toContain(
      "usdc_purchase_receipts.skill_db_id = EXCLUDED.skill_db_id"
    );
    expect(source).toContain(
      "usdc_purchase_receipts.buyer_pubkey = EXCLUDED.buyer_pubkey"
    );
  });
});
