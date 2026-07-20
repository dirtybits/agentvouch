import { describe, expect, it } from "vitest";
import {
  resolvePendingWalletLinkAction,
  walletLinkResponseError,
  WALLET_OWNED_BY_OTHER_ACCOUNT_CODE,
} from "@/lib/buyerWalletLinkClient";

describe("buyer wallet link client", () => {
  it.each([
    { hasPendingTarget: false },
    { connecting: true },
    { linking: true },
    { canSign: false },
    { targetConnected: false },
  ])("waits while the provider target is unsettled: %o", (override) => {
    expect(
      resolvePendingWalletLinkAction({
        hasPendingTarget: true,
        connecting: false,
        linking: false,
        canSign: true,
        targetConnected: true,
        currentWalletLinked: false,
        ...override,
      })
    ).toBe("wait");
  });

  it("skips another signature when the settled wallet is already linked", () => {
    expect(
      resolvePendingWalletLinkAction({
        hasPendingTarget: true,
        connecting: false,
        linking: false,
        canSign: true,
        targetConnected: true,
        currentWalletLinked: true,
      })
    ).toBe("already-linked");
  });

  it("starts linking when the settled wallet is not linked", () => {
    expect(
      resolvePendingWalletLinkAction({
        hasPendingTarget: true,
        connecting: false,
        linking: false,
        canSign: true,
        targetConnected: true,
        currentWalletLinked: false,
      })
    ).toBe("link");
  });

  it("turns the private ownership conflict code into actionable copy", async () => {
    const response = Response.json(
      {
        code: WALLET_OWNED_BY_OTHER_ACCOUNT_CODE,
        error: "This wallet is already linked to another AgentVouch account.",
      },
      { status: 409 }
    );

    await expect(walletLinkResponseError(response)).resolves.toBe(
      "This wallet is already linked to another AgentVouch account. Sign in to that account or connect a different wallet."
    );
  });

  it("preserves ordinary server errors", async () => {
    const response = Response.json(
      { error: "Wallet challenge expired." },
      { status: 409 }
    );
    await expect(walletLinkResponseError(response)).resolves.toBe(
      "Wallet challenge expired."
    );
  });

  it("falls back to the response status for malformed payloads", async () => {
    const response = new Response("not json", { status: 503 });
    await expect(walletLinkResponseError(response)).resolves.toBe(
      "Request failed (503)."
    );
  });
});
