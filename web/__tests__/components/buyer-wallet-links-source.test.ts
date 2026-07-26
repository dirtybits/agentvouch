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

  it("waits for the authoritative wallet inventory before enabling link actions", () => {
    expect(source).toContain("const [linksLoaded, setLinksLoaded]");
    expect(source).toContain("const [linksAccountId, setLinksAccountId]");
    expect(source).toContain(
      "const linksAreForCurrentBuyer = linksLoaded && linksAccountId === userId"
    );
    expect(source).toContain("setLinksLoaded(true)");
    expect(source).toContain("linksLoaded: linksAreForCurrentBuyer");
    expect(source.match(/!linksAreForCurrentBuyer \|\|/g)).toHaveLength(4);
  });

  it("discards stale wallet inventories after buyer authentication changes", () => {
    expect(source).toContain("const walletLinksRequestRef = useRef(0)");
    expect(source).toContain(
      "const requestId = ++walletLinksRequestRef.current"
    );
    expect(source).toContain("}, [isSignedIn, userId]);");
    expect(source).toContain("setLinks([])");
    expect(
      source.match(/walletLinksRequestRef.current !== requestId/g)
    ).toHaveLength(2);
  });

  it("cancels in-flight connection and signature actions after a buyer switch", () => {
    expect(source).toContain("const walletLinkActionRef = useRef(0)");
    expect(source).toContain("useLayoutEffect");
    expect(source).not.toContain("buyerKeyRef");
    expect(source).toContain("const actionId = ++walletLinkActionRef.current");
    expect(source).toContain(
      "const isCurrentAction = () => walletLinkActionRef.current === actionId"
    );
    expect(source).toMatch(
      /await wallet\.signMessage\(challenge\.message\);\s*if \(!isCurrentAction\(\)\) return;/
    );
    expect(source).toMatch(
      /const verifyResponse = await fetch\([\s\S]*?\);\s*if \(!isCurrentAction\(\)\) return;/
    );
    expect(source).toMatch(
      /const linksRefreshed = await loadLinks\(\);\s*if \(!isCurrentAction\(\) \|\| !linksRefreshed\) return;/
    );
    expect(source).toMatch(
      /await solana\.connectPhantomExtension\(\);[\s\S]*?if \(!isCurrentAction\(\)\) return;\s*setPendingTarget\(target\)/
    );
  });

  it("resets buyer state at commit and invalidates actions on unmount", () => {
    const buyerSwitchEffect = source.match(
      /useLayoutEffect\(\(\) => \{([\s\S]*?)\n\s*\}, \[buyerKey\]\);/
    );
    expect(buyerSwitchEffect).not.toBeNull();
    const resetBody = buyerSwitchEffect?.[1] ?? "";
    expect(resetBody.match(/walletLinkActionRef\.current \+= 1/g)).toHaveLength(
      2
    );
    for (const reset of [
      "setPendingTarget(null)",
      "setConnectingTarget(null)",
      "setLinking(false)",
      "setNotice(null)",
    ]) {
      expect(resetBody).toContain(reset);
    }
    expect(resetBody).toMatch(
      /return \(\) => \{\s*walletLinkActionRef\.current \+= 1;\s*\};/
    );
  });

  it("renders wallet-link failures as an accessible terminal state", () => {
    expect(source).toContain("walletLinkResponseError");
    expect(source).toContain('role={notice.kind === "error" ? "alert"');
    expect(source).toContain("setLinking(false)");
    expect(source).toContain(
      "const visibleLinks = linksAreForCurrentBuyer ? links : []"
    );
    expect(source).toContain("{loading ? (");
    expect(source).toContain(") : visibleLinks.length ? (");
    expect(source).toContain("{visibleLinks.map((link) => (");
    expect(source).not.toContain(
      "loading || (!linksAreForCurrentBuyer && links.length > 0)"
    );
  });

  it("shows the connected wallet as linked instead of repeating verification", () => {
    expect(source).toContain("normalizeChainAddressForStorage");
    expect(source).toContain("currentWalletLinked");
    expect(source).toContain('"Current wallet linked"');
    expect(source).toContain("currentWalletLinked ||");
  });
});
