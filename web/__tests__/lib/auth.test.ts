import { describe, expect, it, vi } from "vitest";

import {
  buildDownloadRawMessage,
  createSignedDownloadAuthPayload,
} from "@/lib/authPayload";
import { decodeBase64 } from "@/lib/base64";

describe("createSignedDownloadAuthPayload", () => {
  it("builds the canonical signed raw-download payload", async () => {
    const signatureBytes = new Uint8Array([1, 2, 3, 4]);
    const signMessage = vi.fn().mockResolvedValue(signatureBytes);

    const payload = await createSignedDownloadAuthPayload({
      walletAddress: "BuyerPubkey1111111111111111111111111111111111",
      signMessage,
      skillId: "skill-db-id",
      listingAddress: "Listing111111111111111111111111111111111111",
      timestamp: 1709234567890,
    });

    expect(payload).toEqual({
      pubkey: "BuyerPubkey1111111111111111111111111111111111",
      signature: "AQIDBA==",
      message: buildDownloadRawMessage(
        "skill-db-id",
        "Listing111111111111111111111111111111111111",
        1709234567890
      ),
      timestamp: 1709234567890,
    });
    expect(signMessage).toHaveBeenCalledWith(
      new TextEncoder().encode(payload.message)
    );
    expect(Array.from(decodeBase64(payload.signature))).toEqual(
      Array.from(signatureBytes)
    );
  });

  it("uses the USDC direct scope when no listing address is linked", async () => {
    const signMessage = vi.fn().mockResolvedValue(new Uint8Array([9, 8, 7]));

    const payload = await createSignedDownloadAuthPayload({
      walletAddress: "BuyerPubkey1111111111111111111111111111111111",
      signMessage,
      skillId: "skill-db-id",
      timestamp: 1709234567891,
    });

    expect(payload.message).toBe(
      buildDownloadRawMessage("skill-db-id", undefined, 1709234567891)
    );
    expect(payload.message).toContain("Listing: x402-usdc-direct");
  });
});
