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
    expect(source).toContain("const payload = (await response");
    expect(source).toContain(".json()");
    expect(source).toContain(".catch(() => null)");
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

  it("does not request another signature after switching to an already-linked wallet", () => {
    expect(source).toContain("resolvePendingWalletLinkAction");
    expect(source).toContain('action === "already-linked"');
    expect(source).toContain("is already linked to this account.");
    expect(source).toContain("setPendingTarget(null)");
  });

  it("renders wallet-link failures as an accessible terminal state", () => {
    expect(source).toContain("walletLinkResponseError");
    expect(source).toContain('role={notice.kind === "error" ? "alert"');
    expect(source).toContain("setLinking(false)");
  });

  it("shows the connected wallet as linked instead of repeating verification", () => {
    expect(source).toContain("normalizeChainAddressForStorage");
    expect(source).toContain("currentWalletLinked");
    expect(source).toContain('"Current wallet linked"');
    expect(source).toContain("currentWalletLinked ||");
  });
});
