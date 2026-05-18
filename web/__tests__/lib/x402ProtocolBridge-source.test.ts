import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("x402 protocol bridge source", () => {
  const source = readFileSync(
    join(process.cwd(), "lib", "x402ProtocolBridge.ts"),
    "utf8"
  );

  it("keeps the on-chain memo compact and binds details through the payment ref hash", () => {
    expect(source).toContain("const memo = input.paymentRefHashHex.slice(0, 32)");
    expect(source).toContain("agentvouch_skill_db_id");
    expect(source).toContain("agentvouch_listing");
    expect(source).toContain("agentvouch_buyer");
    expect(source).toContain("agentvouch_nonce");
    expect(source).toContain("agentvouch_payment_ref_hash");
  });

  it("accepts base64-wrapped JSON keypairs for local bridge smoke envs", () => {
    expect(source).toContain('decodedText.startsWith("[")');
    expect(source).toContain("base64:<json-secret>");
  });
});
