import { describe, expect, it, vi } from "vitest";

import {
  assertPublisherAuthMessageScope,
  buildDownloadRawMessage,
  buildPublisherAuthMessage,
  createSignedDownloadAuthPayload,
} from "@/lib/authPayload";
import { decodeBase64 } from "@/lib/base64";
import {
  assertApiKeyAuthMessageScope,
  buildApiKeyAuthMessage,
  normalizeApiKeyName,
  normalizeApiKeyUuid,
  type ApiKeyAuthPayload,
} from "@/lib/apiKeyAuth";

const API_KEY_NONCE = "11111111-1111-4111-8111-111111111111";
const API_KEY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const API_KEY_AUDIENCE = "https://agentvouch.example";

describe("API-key auth envelope", () => {
  function payload(
    action: "list-keys" | "create-key" | "revoke-key",
    object: { keyName?: string; keyId?: string } = {}
  ): ApiKeyAuthPayload {
    return {
      pubkey: "Wallet111",
      signature: "signature",
      timestamp: 1_709_234_567_890,
      nonce: API_KEY_NONCE,
      message: buildApiKeyAuthMessage({
        action,
        audience: API_KEY_AUDIENCE,
        timestamp: 1_709_234_567_890,
        nonce: API_KEY_NONCE,
        ...object,
      }),
    };
  }

  it("builds exact method/path messages for every API-key action", () => {
    expect(
      buildApiKeyAuthMessage({
        action: "list-keys",
        audience: API_KEY_AUDIENCE,
        timestamp: 1,
        nonce: API_KEY_NONCE,
      })
    ).toBe(
      `AgentVouch API Key\nAction: list-keys\nMethod: GET\nPath: /api/keys\nAudience: ${API_KEY_AUDIENCE}\nNonce: ${API_KEY_NONCE}\nTimestamp: 1`
    );
    expect(
      buildApiKeyAuthMessage({
        action: "create-key",
        audience: API_KEY_AUDIENCE,
        timestamp: 2,
        nonce: API_KEY_NONCE,
        keyName: "work",
      })
    ).toContain(
      `Method: POST\nPath: /api/keys\nAudience: ${API_KEY_AUDIENCE}\nName: "work"`
    );
    expect(
      buildApiKeyAuthMessage({
        action: "revoke-key",
        audience: API_KEY_AUDIENCE,
        timestamp: 3,
        nonce: API_KEY_NONCE,
        keyId: API_KEY_ID,
      })
    ).toContain(
      `Method: DELETE\nPath: /api/keys\nAudience: ${API_KEY_AUDIENCE}\nKey id: ${API_KEY_ID}`
    );
  });

  it("normalizes names and JSON-encodes embedded newlines", () => {
    expect(normalizeApiKeyName(undefined)).toEqual({
      ok: true,
      value: "default",
    });
    expect(normalizeApiKeyName("  work  ")).toEqual({
      ok: true,
      value: "work",
    });
    expect(normalizeApiKeyName({ value: "work" }).ok).toBe(false);
    expect(normalizeApiKeyName("x".repeat(65)).ok).toBe(false);
    expect(
      buildApiKeyAuthMessage({
        action: "create-key",
        audience: API_KEY_AUDIENCE,
        timestamp: 1,
        nonce: API_KEY_NONCE,
        keyName: "line one\nline two",
      })
    ).toContain('Name: "line one\\nline two"');
  });

  it("requires lowercase UUIDs for nonces and key ids", () => {
    expect(normalizeApiKeyUuid(API_KEY_NONCE, "nonce")).toEqual({
      ok: true,
      value: API_KEY_NONCE,
    });
    expect(normalizeApiKeyUuid("not-a-uuid", "nonce").ok).toBe(false);
    expect(normalizeApiKeyUuid(API_KEY_ID.toUpperCase(), "key id").ok).toBe(
      false
    );
  });

  it("rejects action, method/path, object, nonce, and timestamp changes", () => {
    const create = payload("create-key", { keyName: "work" });
    expect(
      assertApiKeyAuthMessageScope({
        auth: create,
        expectedAction: "create-key",
        expectedAudience: API_KEY_AUDIENCE,
        keyName: "work",
      })
    ).toEqual({ ok: true, nonce: API_KEY_NONCE });

    const cases: ApiKeyAuthPayload[] = [
      { ...create, message: create.message.replace("POST", "DELETE") },
      { ...create, message: create.message.replace("/api/keys", "/api/other") },
      { ...create, message: create.message.replace('"work"', '"other"') },
      { ...create, nonce: "22222222-2222-4222-8222-222222222222" },
      { ...create, timestamp: create.timestamp + 1 },
    ];
    for (const auth of cases) {
      expect(
        assertApiKeyAuthMessageScope({
          auth,
          expectedAction: "create-key",
          expectedAudience: API_KEY_AUDIENCE,
          keyName: "work",
        }).ok
      ).toBe(false);
    }

    expect(
      assertApiKeyAuthMessageScope({
        auth: create,
        expectedAction: "list-keys",
        expectedAudience: API_KEY_AUDIENCE,
      }).ok
    ).toBe(false);

    expect(
      assertApiKeyAuthMessageScope({
        auth: {
          ...create,
          timestamp: "1709234567890",
        } as unknown as ApiKeyAuthPayload,
        expectedAction: "create-key",
        expectedAudience: API_KEY_AUDIENCE,
        keyName: "work",
      })
    ).toEqual({ ok: false, error: "API key timestamp must be a safe integer" });

    expect(
      assertApiKeyAuthMessageScope({
        auth: create,
        expectedAction: "create-key",
        expectedAudience: "https://preview.example",
        keyName: "work",
      }).ok
    ).toBe(false);
  });
});

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
