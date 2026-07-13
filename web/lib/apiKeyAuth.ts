import type { AuthPayload } from "@/lib/authPayload";
import { normalizeProtocolNewlines } from "@/lib/authPayload";

export type ApiKeyAuthAction = "list-keys" | "create-key" | "revoke-key";

export interface ApiKeyAuthPayload extends AuthPayload {
  nonce: string;
}

type ApiKeyAuthScope = {
  action: ApiKeyAuthAction;
  audience: string;
  timestamp: number;
  nonce: string;
  keyName?: string;
  keyId?: string;
};

type NormalizedValue =
  | { ok: true; value: string }
  | { ok: false; error: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const ACTION_REQUEST: Record<
  ApiKeyAuthAction,
  { method: "GET" | "POST" | "DELETE"; path: "/api/keys" }
> = {
  "list-keys": { method: "GET", path: "/api/keys" },
  "create-key": { method: "POST", path: "/api/keys" },
  "revoke-key": { method: "DELETE", path: "/api/keys" },
};

export function normalizeApiKeyName(value: unknown): NormalizedValue {
  if (value !== undefined && typeof value !== "string") {
    return { ok: false, error: "API key name must be a string" };
  }
  const normalized = typeof value === "string" ? value.trim() : "";
  const keyName = normalized || "default";
  if (keyName.length > 64) {
    return {
      ok: false,
      error: "API key name must be at most 64 characters",
    };
  }
  return { ok: true, value: keyName };
}

export function normalizeApiKeyUuid(
  value: unknown,
  label: "nonce" | "key id"
): NormalizedValue {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return {
      ok: false,
      error: `API key ${label} must be a lowercase UUID`,
    };
  }
  return { ok: true, value };
}

export function normalizeApiKeyAudience(value: unknown): NormalizedValue {
  if (typeof value !== "string") {
    return { ok: false, error: "API key audience must be an origin" };
  }
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.origin !== value
    ) {
      return { ok: false, error: "API key audience must be an origin" };
    }
    return { ok: true, value: url.origin };
  } catch {
    return { ok: false, error: "API key audience must be an origin" };
  }
}

export function buildApiKeyAuthMessage(input: ApiKeyAuthScope): string {
  const audience = normalizeApiKeyAudience(input.audience);
  if (!audience.ok) throw new Error(audience.error);
  const request = ACTION_REQUEST[input.action];
  const lines = [
    "AgentVouch API Key",
    `Action: ${input.action}`,
    `Method: ${request.method}`,
    `Path: ${request.path}`,
    `Audience: ${audience.value}`,
  ];

  if (input.action === "create-key") {
    if (input.keyName === undefined) {
      throw new Error("create-key auth requires a normalized key name");
    }
    lines.push(`Name: ${JSON.stringify(input.keyName)}`);
  } else if (input.action === "revoke-key") {
    if (input.keyId === undefined) {
      throw new Error("revoke-key auth requires a key id");
    }
    lines.push(`Key id: ${input.keyId}`);
  }

  lines.push(`Nonce: ${input.nonce}`, `Timestamp: ${input.timestamp}`);
  return lines.join("\n");
}

export function assertApiKeyAuthMessageScope(input: {
  auth: ApiKeyAuthPayload;
  expectedAction: ApiKeyAuthAction;
  expectedAudience: string;
  keyName?: string;
  keyId?: string;
}): { ok: true; nonce: string } | { ok: false; error: string } {
  if (typeof input.auth.message !== "string") {
    return { ok: false, error: "API key message must be a string" };
  }
  if (
    typeof input.auth.timestamp !== "number" ||
    !Number.isSafeInteger(input.auth.timestamp)
  ) {
    return {
      ok: false,
      error: "API key timestamp must be a safe integer",
    };
  }

  const nonce = normalizeApiKeyUuid(input.auth.nonce, "nonce");
  if (!nonce.ok) return nonce;

  let expected: string;
  try {
    expected = buildApiKeyAuthMessage({
      action: input.expectedAction,
      audience: input.expectedAudience,
      timestamp: input.auth.timestamp,
      nonce: nonce.value,
      keyName: input.keyName,
      keyId: input.keyId,
    });
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (normalizeProtocolNewlines(input.auth.message) !== expected) {
    return {
      ok: false,
      error: "API key signature does not match this action and object",
    };
  }
  return { ok: true, nonce: nonce.value };
}
