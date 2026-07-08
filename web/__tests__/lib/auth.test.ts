import { describe, expect, it, vi } from "vitest";

import {
  assertPublisherAuthMessageScope,
  buildDownloadRawMessage,
  buildPublisherAuthMessage,
  createSignedDownloadAuthPayload,
} from "@/lib/authPayload";
import { decodeBase64 } from "@/lib/base64";

describe("assertPublisherAuthMessageScope", () => {
  it("accepts create-skill Action+Timestamp messages", () => {
    const timestamp = 1_709_234_567_890;
    const message = buildPublisherAuthMessage({
      action: "publish-skill",
      timestamp,
    });
    expect(
      assertPublisherAuthMessageScope({
        message,
        timestamp,
        expectedAction: "publish-skill",
      })
    ).toEqual({ ok: true });
  });

  it("accepts skill-scoped messages and rejects wrong action or skill id", () => {
    const timestamp = 1_709_234_567_891;
    const skillId = "uuid-skill-1";
    const ok = buildPublisherAuthMessage({
      action: "link-base-listing",
      timestamp,
      skillId,
    });
    expect(
      assertPublisherAuthMessageScope({
        message: ok,
        timestamp,
        expectedAction: "link-base-listing",
        skillId,
      })
    ).toEqual({ ok: true });

    const wrongAction = assertPublisherAuthMessageScope({
      message: buildPublisherAuthMessage({
        action: "publish-skill",
        timestamp,
        skillId,
      }),
      timestamp,
      expectedAction: "link-base-listing",
      skillId,
    });
    expect(wrongAction.ok).toBe(false);
    if (!wrongAction.ok) {
      expect(wrongAction.error).toMatch(/not for action "link-base-listing"/i);
    }

    const wrongSkill = assertPublisherAuthMessageScope({
      message: buildPublisherAuthMessage({
        action: "link-base-listing",
        timestamp,
        skillId: "other-id",
      }),
      timestamp,
      expectedAction: "link-base-listing",
      skillId,
    });
    expect(wrongSkill.ok).toBe(false);
    if (!wrongSkill.ok) {
      expect(wrongSkill.error).toMatch(/skill id does not match/i);
    }
  });

  it("accepts legacy Action+Timestamp-only when allowLegacyWithoutSkillId is set", () => {
    const timestamp = 1_709_234_567_892;
    const legacy = buildPublisherAuthMessage({
      action: "publish-skill",
      timestamp,
    });
    expect(
      assertPublisherAuthMessageScope({
        message: legacy,
        timestamp,
        expectedAction: "publish-skill",
        skillId: "uuid-skill-1",
        allowLegacyWithoutSkillId: true,
      })
    ).toEqual({ ok: true });

    const rejected = assertPublisherAuthMessageScope({
      message: legacy,
      timestamp,
      expectedAction: "publish-skill",
      skillId: "uuid-skill-1",
    });
    expect(rejected.ok).toBe(false);
  });
});

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
