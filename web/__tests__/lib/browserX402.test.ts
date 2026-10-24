import type { TransactionSignerCapabilities } from "@solana/connector/headless";
import type { TransactionSigner } from "@solana/kit";
import { describe, expect, it, vi } from "vitest";

import {
  createBrowserX402Fetch,
  fetchSkillWithBrowserX402,
  walletSupportsBrowserX402,
} from "@/lib/browserX402";

// The vitest harness runs in the node environment, which provides the web
// Request/Response/Headers/Blob globals that @x402/fetch relies on. The x402
// client builds `new Request(input, init)` internally, so the fake fetch
// receives Request objects. Absolute URLs keep the fixtures portable across
// undici and browser fetch implementations.

const WALLET_ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtSWMY";
const SKILL_ID = "skill-scan-offline-eval";
const LISTING_ADDRESS = "4Kq7tX402UsdcDirectListing0000000000000000000000";
const PATH =
  "https://agentvouch.test/api/skills/skillpack?skill_id=skill-scan-offline-eval";
const SIGNATURE_BYTES = new Uint8Array(64).fill(7);
const EXPECTED_SIGNATURE = Buffer.from(SIGNATURE_BYTES).toString("base64");

function capabilities(
  overrides: Partial<TransactionSignerCapabilities> = {}
): TransactionSignerCapabilities {
  return {
    canSign: true,
    canSend: true,
    canSignMessage: true,
    supportsBatchSigning: true,
    ...overrides,
  };
}

function makeSigner() {
  const signMessage = vi.fn(async (message: Uint8Array) => {
    expect(message).toBeInstanceOf(Uint8Array);
    return SIGNATURE_BYTES;
  });
  const signer = { signMessage } as unknown as TransactionSigner;
  return { signMessage, signer };
}

function makeFetch(handler: (request: Request) => Response) {
  const calls: Request[] = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = new Request(input, init);
      calls.push(request);
      return handler(request);
    }
  );
  return { calls, fetchImpl };
}

describe("walletSupportsBrowserX402 capability gate", () => {
  it("rejects missing wallets and wallets without transaction or message signing", () => {
    expect(walletSupportsBrowserX402(null)).toBe(false);
    expect(walletSupportsBrowserX402(undefined)).toBe(false);
    expect(walletSupportsBrowserX402(capabilities({ canSign: false }))).toBe(
      false
    );
    expect(
      walletSupportsBrowserX402(capabilities({ canSignMessage: false }))
    ).toBe(false);
    expect(walletSupportsBrowserX402(capabilities())).toBe(true);
  });
});

describe("fetchSkillWithBrowserX402 purchase path", () => {
  it("passes through successful responses and returns the signed auth payload", async () => {
    const { signMessage, signer } = makeSigner();
    const { calls, fetchImpl } = makeFetch(
      () =>
        new Response("skill-pack-bytes", {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        })
    );

    const result = await fetchSkillWithBrowserX402({
      signer,
      walletAddress: WALLET_ADDRESS,
      signMessage,
      skillId: SKILL_ID,
      path: PATH,
      fetchImpl,
    });

    expect(calls).toHaveLength(1);
    // The first request is a plain GET; the auth header only rides the 402 retry.
    expect(calls[0].headers.get("X-AgentVouch-Auth")).toBeNull();
    expect(calls[0].headers.get("PAYMENT-SIGNATURE")).toBeNull();
    await expect(result.blob.text()).resolves.toBe("skill-pack-bytes");
    expect(result.paymentResponse).toBeUndefined();

    const auth = JSON.parse(result.authHeader);
    expect(auth.pubkey).toBe(WALLET_ADDRESS);
    expect(auth.signature).toBe(EXPECTED_SIGNATURE);
    expect(typeof auth.timestamp).toBe("number");
    expect(auth.message).toBe(
      `AgentVouch Skill Download\nAction: download-raw\nSkill id: ${SKILL_ID}\nListing: x402-usdc-direct\nTimestamp: ${auth.timestamp}`
    );
  });

  it("signs a download message scoped to the listing address when provided", async () => {
    const { signMessage, signer } = makeSigner();
    const { fetchImpl } = makeFetch(() => new Response("ok", { status: 200 }));

    const result = await fetchSkillWithBrowserX402({
      signer,
      walletAddress: WALLET_ADDRESS,
      signMessage,
      skillId: SKILL_ID,
      listingAddress: LISTING_ADDRESS,
      path: PATH,
      fetchImpl,
    });

    expect(signMessage).toHaveBeenCalledTimes(1);
    const signedMessage = new TextDecoder().decode(
      signMessage.mock.calls[0][0] as Uint8Array
    );
    const auth = JSON.parse(result.authHeader);
    expect(signedMessage).toBe(
      `AgentVouch Skill Download\nAction: download-raw\nSkill id: ${SKILL_ID}\nListing: ${LISTING_ADDRESS}\nTimestamp: ${auth.timestamp}`
    );
  });

  it("retries once with the signed auth header after a PAYMENT-REQUIRED 402", async () => {
    const { signMessage, signer } = makeSigner();
    const paymentRequiredHeader = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        resource: PATH,
        accepts: [
          {
            scheme: "exact",
            network: "solana:devnet",
            maxAmountRequired: "1000000",
          },
        ],
      })
    ).toString("base64");
    const seenAuthHeaders: Array<string | null> = [];
    const { calls, fetchImpl } = makeFetch((request) => {
      seenAuthHeaders.push(request.headers.get("X-AgentVouch-Auth"));
      if (request.headers.has("X-AgentVouch-Auth")) {
        return new Response("paid-skill-pack", {
          status: 200,
          headers: {
            "PAYMENT-RESPONSE": Buffer.from(
              JSON.stringify({ transaction: "FAKE_SETTLE_TX" })
            ).toString("base64"),
          },
        });
      }
      return new Response("{}", {
        status: 402,
        headers: {
          "PAYMENT-REQUIRED": paymentRequiredHeader,
          "content-type": "application/json",
        },
      });
    });

    const result = await fetchSkillWithBrowserX402({
      signer,
      walletAddress: WALLET_ADDRESS,
      signMessage,
      skillId: SKILL_ID,
      path: PATH,
      fetchImpl,
    });

    expect(calls).toHaveLength(2);
    expect(seenAuthHeaders[0]).toBeNull();
    expect(seenAuthHeaders[1]).toBe(result.authHeader);
    await expect(result.blob.text()).resolves.toBe("paid-skill-pack");
    expect(result.paymentResponse).toEqual({ transaction: "FAKE_SETTLE_TX" });
    // The auth hook won, so no on-chain payment signing was attempted.
    expect(calls[1].headers.get("PAYMENT-SIGNATURE")).toBeNull();
  });

  it("surfaces a parse error when the 402 response lacks PAYMENT-REQUIRED", async () => {
    const { signMessage, signer } = makeSigner();
    const { calls, fetchImpl } = makeFetch(
      () => new Response("payment required", { status: 402 })
    );

    await expect(
      fetchSkillWithBrowserX402({
        signer,
        walletAddress: WALLET_ADDRESS,
        signMessage,
        skillId: SKILL_ID,
        path: PATH,
        fetchImpl,
      })
    ).rejects.toThrow(
      "Failed to parse payment requirements: Invalid payment required response"
    );
    expect(calls).toHaveLength(1);
  });

  it("prefers server-provided error text from JSON failure bodies", async () => {
    const { signMessage, signer } = makeSigner();
    const { fetchImpl } = makeFetch(
      () =>
        new Response(JSON.stringify({ error: "Insufficient author bond" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        })
    );

    await expect(
      fetchSkillWithBrowserX402({
        signer,
        walletAddress: WALLET_ADDRESS,
        signMessage,
        skillId: SKILL_ID,
        path: PATH,
        fetchImpl,
      })
    ).rejects.toThrow("Insufficient author bond");
  });

  it("falls back to the status code for empty non-2xx responses", async () => {
    const { signMessage, signer } = makeSigner();
    const { fetchImpl } = makeFetch(() => new Response(null, { status: 503 }));

    await expect(
      fetchSkillWithBrowserX402({
        signer,
        walletAddress: WALLET_ADDRESS,
        signMessage,
        skillId: SKILL_ID,
        path: PATH,
        fetchImpl,
      })
    ).rejects.toThrow("USDC purchase failed with status 503");
  });
});

describe("createBrowserX402Fetch wiring", () => {
  it("is the fetcher used by the purchase path (transitively exercised above)", () => {
    expect(typeof createBrowserX402Fetch).toBe("function");
    expect(typeof fetchSkillWithBrowserX402).toBe("function");
  });
});
