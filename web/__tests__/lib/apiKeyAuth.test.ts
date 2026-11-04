import { describe, expect, it } from "vitest";
import {
  assertApiKeyAuthMessageScope,
  buildApiKeyAuthMessage,
  normalizeApiKeyAudience,
  normalizeApiKeyName,
  normalizeApiKeyUuid,
  type ApiKeyAuthAction,
  type ApiKeyAuthPayload,
} from "@/lib/apiKeyAuth";
import { normalizeProtocolNewlines } from "@/lib/authPayload";

// The API key auth message is a signature interop contract: the web client signs
// it, the keys route re-derives it server-side, and any drift silently breaks
// key creation/revocation. These tests pin the exact message shape and the
// validation boundaries around audience, nonce, key id, name, and timestamp.
const NONCE = "11111111-1111-4111-8111-111111111111";
const KEY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_KEY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AUDIENCE = "https://agentvouch.xyz";
const TIMESTAMP = 1_700_000_000_000;

function authPayload(input: {
  action?: ApiKeyAuthAction;
  audience?: string;
  timestamp?: number;
  nonce?: string;
  keyName?: string;
  keyId?: string;
  message?: string;
}): ApiKeyAuthPayload {
  const action = input.action ?? "list-keys";
  const audience = input.audience ?? AUDIENCE;
  const timestamp = input.timestamp ?? TIMESTAMP;
  const nonce = input.nonce ?? NONCE;
  return {
    pubkey: "Wallet111",
    signature: "signature",
    message:
      input.message !== undefined
        ? input.message
        : buildApiKeyAuthMessage({
            action,
            audience,
            timestamp,
            nonce,
            keyName: input.keyName,
            keyId: input.keyId,
          }),
    timestamp,
    nonce,
  };
}

describe("normalizeApiKeyAudience", () => {
  it("accepts exact http(s) origin strings", () => {
    expect(normalizeApiKeyAudience(AUDIENCE)).toEqual({
      ok: true,
      value: AUDIENCE,
    });
    expect(normalizeApiKeyAudience("http://localhost")).toEqual({
      ok: true,
      value: "http://localhost",
    });
    // Non-default ports are part of the origin and survive normalization.
    expect(normalizeApiKeyAudience("https://agentvouch.xyz:8443")).toEqual({
      ok: true,
      value: "https://agentvouch.xyz:8443",
    });
  });

  it("rejects URLs that are not exactly their origin", () => {
    for (const value of [
      "https://agentvouch.xyz/",
      "https://agentvouch.xyz/settings",
      "https://agentvouch.xyz?x=1",
      "https://agentvouch.xyz#frag",
      "https://user@agentvouch.xyz",
      "https://user:pass@agentvouch.xyz",
    ]) {
      expect(normalizeApiKeyAudience(value).ok, value).toBe(false);
    }
  });

  it("rejects explicit default ports because URL normalization drops them", () => {
    expect(normalizeApiKeyAudience("https://agentvouch.xyz:443").ok).toBe(
      false
    );
    expect(normalizeApiKeyAudience("http://localhost:80").ok).toBe(false);
  });

  it("rejects non-http(s) protocols and case variants", () => {
    // ftp parses fine but fails the protocol check.
    expect(normalizeApiKeyAudience("ftp://agentvouch.xyz")).toEqual({
      ok: false,
      error: "API key audience must be an origin",
    });
    // Origin strings are lowercased, so uppercase input never equals its origin.
    expect(normalizeApiKeyAudience("HTTPS://EXAMPLE.COM").ok).toBe(false);
  });

  it("rejects non-string input", () => {
    for (const value of [null, undefined, 42, { origin: AUDIENCE }]) {
      expect(normalizeApiKeyAudience(value), JSON.stringify(value)).toEqual({
        ok: false,
        error: "API key audience must be an origin",
      });
    }
  });
});

describe("normalizeApiKeyUuid", () => {
  it("accepts well-formed lowercase UUIDs in the supported version range", () => {
    expect(normalizeApiKeyUuid(NONCE, "nonce")).toEqual({
      ok: true,
      value: NONCE,
    });
    // Version 1 is inside the [1-5] range the pattern allows.
    expect(
      normalizeApiKeyUuid("f47ac10b-58cc-137e-8001-000000000001", "nonce")
    ).toEqual({
      ok: true,
      value: "f47ac10b-58cc-137e-8001-000000000001",
    });
  });

  it("rejects uppercase, out-of-range versions, and bad variant nibbles", () => {
    for (const value of [
      // Uppercase only matters when the UUID contains letters; use a
      // letter-bearing v1 for the case-sensitivity assertion.
      "f47ac10b-58cc-437e-8001-000000000001".toUpperCase(),
      "00000000-0000-0111-8111-111111111111", // version 0
      "00000000-0000-6111-8111-111111111111", // version 6
      "11111111-1111-4111-c111-111111111111", // variant c
    ]) {
      expect(normalizeApiKeyUuid(value, "nonce").ok, value).toBe(false);
    }
  });

  it("rejects malformed and non-string values", () => {
    for (const value of [
      "11111111-1111-4111-8111-11111111111",
      "11111111111141118111111111111111",
      "11111111_1111_4111_8111_111111111111",
      "",
      null,
      undefined,
      42,
    ]) {
      expect(
        normalizeApiKeyUuid(value, "nonce"),
        JSON.stringify(value)
      ).toEqual({ ok: false, error: "API key nonce must be a lowercase UUID" });
    }
  });

  it("uses the caller-supplied label in error messages", () => {
    expect(normalizeApiKeyUuid(OTHER_KEY_ID.toUpperCase(), "key id")).toEqual({
      ok: false,
      error: "API key key id must be a lowercase UUID",
    });
  });
});

describe("normalizeApiKeyName", () => {
  it("defaults missing or blank names to 'default'", () => {
    expect(normalizeApiKeyName(undefined)).toEqual({
      ok: true,
      value: "default",
    });
    expect(normalizeApiKeyName("")).toEqual({ ok: true, value: "default" });
    expect(normalizeApiKeyName("   ")).toEqual({
      ok: true,
      value: "default",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeApiKeyName("  ops key  ")).toEqual({
      ok: true,
      value: "ops key",
    });
  });

  it("enforces the 64-character limit after trimming", () => {
    expect(normalizeApiKeyName("a".repeat(64)).ok).toBe(true);
    expect(normalizeApiKeyName("a".repeat(65))).toEqual({
      ok: false,
      error: "API key name must be at most 64 characters",
    });
    // Two padded spaces around a 64-char name still trim to the limit.
    expect(normalizeApiKeyName(`  ${"a".repeat(64)} `).ok).toBe(true);
  });

  it("rejects non-string names", () => {
    for (const value of [42, true, null, ["ops"]]) {
      expect(normalizeApiKeyName(value), JSON.stringify(value)).toEqual({
        ok: false,
        error: "API key name must be a string",
      });
    }
  });
});

describe("buildApiKeyAuthMessage", () => {
  it("pins the exact list-keys message shape", () => {
    expect(
      buildApiKeyAuthMessage({
        action: "list-keys",
        audience: AUDIENCE,
        timestamp: TIMESTAMP,
        nonce: NONCE,
      })
    ).toBe(
      [
        "AgentVouch API Key",
        "Action: list-keys",
        "Method: GET",
        "Path: /api/keys",
        `Audience: ${AUDIENCE}`,
        `Nonce: ${NONCE}`,
        `Timestamp: ${TIMESTAMP}`,
      ].join("\n")
    );
  });

  it("includes a JSON-quoted Name for create-key", () => {
    const message = buildApiKeyAuthMessage({
      action: "create-key",
      audience: AUDIENCE,
      timestamp: TIMESTAMP,
      nonce: NONCE,
      keyName: "ops key",
    });
    expect(message).toContain("Action: create-key");
    expect(message).toContain('Name: "ops key"');
  });

  it("includes the Key id for revoke-key", () => {
    const message = buildApiKeyAuthMessage({
      action: "revoke-key",
      audience: AUDIENCE,
      timestamp: TIMESTAMP,
      nonce: NONCE,
      keyId: KEY_ID,
    });
    expect(message).toContain("Method: DELETE");
    expect(message).toContain(`Key id: ${KEY_ID}`);
  });

  it("ignores name and key id for list-keys", () => {
    const message = buildApiKeyAuthMessage({
      action: "list-keys",
      audience: AUDIENCE,
      timestamp: TIMESTAMP,
      nonce: NONCE,
      keyName: "ignored",
      keyId: KEY_ID,
    });
    expect(message).not.toContain("Name:");
    expect(message).not.toContain("Key id:");
  });

  it("throws when the audience is not an origin", () => {
    expect(() =>
      buildApiKeyAuthMessage({
        action: "list-keys",
        audience: "https://agentvouch.xyz/",
        timestamp: TIMESTAMP,
        nonce: NONCE,
      })
    ).toThrow("API key audience must be an origin");
  });

  it("throws for create-key without a normalized key name", () => {
    expect(() =>
      buildApiKeyAuthMessage({
        action: "create-key",
        audience: AUDIENCE,
        timestamp: TIMESTAMP,
        nonce: NONCE,
      })
    ).toThrow("create-key auth requires a normalized key name");
  });

  it("throws for revoke-key without a key id", () => {
    expect(() =>
      buildApiKeyAuthMessage({
        action: "revoke-key",
        audience: AUDIENCE,
        timestamp: TIMESTAMP,
        nonce: NONCE,
      })
    ).toThrow("revoke-key auth requires a key id");
  });
});

describe("assertApiKeyAuthMessageScope", () => {
  it("accepts a correctly signed list-keys payload", () => {
    expect(
      assertApiKeyAuthMessageScope({
        auth: authPayload({}),
        expectedAction: "list-keys",
        expectedAudience: AUDIENCE,
      })
    ).toEqual({ ok: true, nonce: NONCE });
  });

  it("accepts create-key and revoke-key payloads with matching objects", () => {
    expect(
      assertApiKeyAuthMessageScope({
        auth: authPayload({ action: "create-key", keyName: "ops" }),
        expectedAction: "create-key",
        expectedAudience: AUDIENCE,
        keyName: "ops",
      }).ok
    ).toBe(true);
    expect(
      assertApiKeyAuthMessageScope({
        auth: authPayload({ action: "revoke-key", keyId: KEY_ID }),
        expectedAction: "revoke-key",
        expectedAudience: AUDIENCE,
        keyId: KEY_ID,
      }).ok
    ).toBe(true);
  });

  it("accepts CRLF line endings by normalizing to LF", () => {
    const lfMessage = buildApiKeyAuthMessage({
      action: "list-keys",
      audience: AUDIENCE,
      timestamp: TIMESTAMP,
      nonce: NONCE,
    });
    const crlfMessage = lfMessage.replace(/\n/g, "\r\n");
    expect(
      assertApiKeyAuthMessageScope({
        auth: authPayload({ message: crlfMessage }),
        expectedAction: "list-keys",
        expectedAudience: AUDIENCE,
      }).ok
    ).toBe(true);
  });

  it("rejects a payload signed for a different action", () => {
    expect(
      assertApiKeyAuthMessageScope({
        auth: authPayload({ action: "create-key", keyName: "ops" }),
        expectedAction: "list-keys",
        expectedAudience: AUDIENCE,
      })
    ).toEqual({
      ok: false,
      error: "API key signature does not match this action and object",
    });
  });

  it("rejects a payload signed for a different audience", () => {
    expect(
      assertApiKeyAuthMessageScope({
        auth: authPayload({ audience: "https://evil.example.com" }),
        expectedAction: "list-keys",
        expectedAudience: AUDIENCE,
      })
    ).toEqual({
      ok: false,
      error: "API key signature does not match this action and object",
    });
  });

  it("rejects create-key payloads whose expected name differs", () => {
    expect(
      assertApiKeyAuthMessageScope({
        auth: authPayload({ action: "create-key", keyName: "ops" }),
        expectedAction: "create-key",
        expectedAudience: AUDIENCE,
        keyName: "prod",
      })
    ).toEqual({
      ok: false,
      error: "API key signature does not match this action and object",
    });
  });

  it("rejects non-string messages and non-safe-integer timestamps", () => {
    expect(
      assertApiKeyAuthMessageScope({
        auth: authPayload({ message: null as unknown as string }),
        expectedAction: "list-keys",
        expectedAudience: AUDIENCE,
      })
    ).toEqual({ ok: false, error: "API key message must be a string" });

    for (const timestamp of [1.5, 2 ** 53, Number.NaN]) {
      expect(
        assertApiKeyAuthMessageScope({
          auth: authPayload({ timestamp }),
          expectedAction: "list-keys",
          expectedAudience: AUDIENCE,
        }),
        String(timestamp)
      ).toEqual({
        ok: false,
        error: "API key timestamp must be a safe integer",
      });
    }
  });

  it("rejects missing or malformed nonces", () => {
    const base = {
      expectedAction: "list-keys" as ApiKeyAuthAction,
      expectedAudience: AUDIENCE,
    };
    expect(
      assertApiKeyAuthMessageScope({
        auth: { ...authPayload({}), nonce: undefined as unknown as string },
        ...base,
      })
    ).toEqual({ ok: false, error: "API key nonce must be a lowercase UUID" });
    expect(
      assertApiKeyAuthMessageScope({
        auth: {
          ...authPayload({}),
          nonce: "f47ac10b-58cc-437e-8001-000000000001".toUpperCase(),
        },
        ...base,
      })
    ).toEqual({ ok: false, error: "API key nonce must be a lowercase UUID" });
  });

  it("surfaces structural errors from message construction", () => {
    expect(
      assertApiKeyAuthMessageScope({
        auth: authPayload({ action: "create-key", keyName: "ops" }),
        expectedAction: "create-key",
        expectedAudience: AUDIENCE,
      })
    ).toEqual({
      ok: false,
      error: "create-key auth requires a normalized key name",
    });
    expect(
      assertApiKeyAuthMessageScope({
        auth: authPayload({ action: "revoke-key", keyId: KEY_ID }),
        expectedAction: "revoke-key",
        expectedAudience: AUDIENCE,
      })
    ).toEqual({ ok: false, error: "revoke-key auth requires a key id" });
  });
});

describe("normalizeProtocolNewlines", () => {
  it("converts CRLF pairs to LF and leaves other content intact", () => {
    expect(normalizeProtocolNewlines("a\r\nb\r\nc")).toBe("a\nb\nc");
    expect(normalizeProtocolNewlines("a\nb")).toBe("a\nb");
    expect(normalizeProtocolNewlines("")).toBe("");
  });

  it("preserves standalone carriage returns (only CRLF pairs are normalized)", () => {
    expect(normalizeProtocolNewlines("a\rb")).toBe("a\rb");
  });
});
