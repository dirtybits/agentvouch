import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../lib/usdcPurchases.ts", import.meta.url),
  "utf8"
);

describe("deployment-qualified paid report index schema", () => {
  it("keeps receipt history append-only and indexes reports in a separate additive table", () => {
    expect(source).toContain(
      "CREATE TABLE IF NOT EXISTS evm_paid_purchase_report_index"
    );
    expect(source).toContain(
      "purchase_receipt_id UUID NOT NULL REFERENCES usdc_purchase_receipts(id)"
    );
    expect(source).not.toMatch(
      /purchase_receipt_id UUID NOT NULL REFERENCES usdc_purchase_entitlements/
    );
  });

  it("namespaces report, purchase, and event identities by chain plus deployment", () => {
    expect(source).toContain(
      "PRIMARY KEY (chain_context, contract_address, report_id)"
    );
    expect(source).toContain(
      "UNIQUE (chain_context, contract_address, purchase_id)"
    );
    expect(source).toContain(
      "UNIQUE (chain_context, contract_address, opened_tx_hash, opened_log_index)"
    );
  });

  it("stores uint64 report ids and block numbers without signed BIGINT truncation", () => {
    expect(source).toContain("report_id NUMERIC(20, 0) NOT NULL");
    expect(source).toContain("opened_block_number NUMERIC(78, 0) NOT NULL");
  });
});
