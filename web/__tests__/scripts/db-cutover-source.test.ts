import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("db cutover script source", () => {
  const source = readFileSync(
    join(process.cwd(), "scripts", "db-cutover.ts"),
    "utf8"
  );

  it("supports the milestone 9 cutover commands", () => {
    expect(source).toContain('command === "inventory"');
    expect(source).toContain('command === "bootstrap"');
    expect(source).toContain('command === "export"');
    expect(source).toContain('command === "import"');
    expect(source).toContain('command === "sanity"');
  });

  it("excludes receipts and entitlements from the default export path", () => {
    expect(source).toContain("includeReceipts: false");
    expect(source).toContain("clearPurchaseState");
    expect(source).toContain("DELETE FROM usdc_purchase_entitlements");
    expect(source).toContain("DELETE FROM usdc_purchase_receipts");
    expect(source).toContain("Receipts and entitlements were intentionally not imported");
  });

  it("normalizes v0.2 protocol metadata for protocol-listed skills", () => {
    expect(source).toContain("AGENTVOUCH_PROTOCOL_VERSION");
    expect(source).toContain("getAgentVouchProgramId");
    expect(source).toContain("getConfiguredUsdcMint");
    expect(source).toContain("on_chain_protocol_version");
    expect(source).toContain("on_chain_program_id");
  });
});
