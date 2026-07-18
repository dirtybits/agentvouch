import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "components/BuyerWalletLinks.tsx"),
  "utf8"
);

describe("buyer wallet link client wiring", () => {
  it("passes decoded challenge payloads through Clerk reverification", () => {
    expect(source).toContain("const requestChallenge = useReverification(");
    expect(source).toContain("response.json().catch(() => null)");
    expect(source).toContain("const challenge = challengeResponse");
    expect(source).not.toContain("challengeResponse.json()");
  });

  it("combines explicit wallet connection and linking", () => {
    expect(source).toContain("connectAndLink");
    expect(source).toContain('connectAndLink("phantom")');
    expect(source).toContain('connectAndLink("base-passkey")');
    expect(source).toContain('connectAndLink("base-injected")');
    expect(source).toContain("setPendingTarget(target)");
    expect(source).toContain("void linkConnectedWallet()");
  });

  it("shows the connected wallet as linked instead of repeating verification", () => {
    expect(source).toContain("normalizeChainAddressForStorage");
    expect(source).toContain("currentWalletLinked");
    expect(source).toContain('"Current wallet linked"');
    expect(source).toContain("currentWalletLinked ||");
  });
});
