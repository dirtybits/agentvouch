import { encodeBase64 } from "@/lib/base64";

export interface AuthPayload {
  pubkey: string;
  signature: string;
  message: string;
  timestamp: number;
}

export function buildSignMessage(action: string, timestamp: number): string {
  return `AgentVouch Skill Repo\nAction: ${action}\nTimestamp: ${timestamp}`;
}

/**
 * Canonical publisher-auth message. Include `skillId` (DB UUID) for mutations
 * that target an existing skill row; omit it for create-skill publishes.
 */
export function buildPublisherAuthMessage(input: {
  action: string;
  timestamp: number;
  skillId?: string;
}): string {
  if (input.skillId) {
    return `AgentVouch Skill Repo\nAction: ${input.action}\nSkill id: ${input.skillId}\nTimestamp: ${input.timestamp}`;
  }
  return buildSignMessage(input.action, input.timestamp);
}

/**
 * Server-side scope check for publisher mutations. Signature verification alone
 * is not enough — the signed body must name the intended Action (and Skill id
 * when the route targets an existing skill).
 *
 * `allowLegacyWithoutSkillId` accepts the pre-2026-07-08 Action+Timestamp-only
 * shape used by the published CLI (`publish-skill` without Skill id). Prefer
 * skill-scoped web clients; remove the legacy branch once the CLI is bumped.
 */
export function assertPublisherAuthMessageScope(input: {
  message: string;
  timestamp: number;
  expectedAction: string;
  skillId?: string;
  allowLegacyWithoutSkillId?: boolean;
}): { ok: true } | { ok: false; error: string } {
  const message = normalizeProtocolNewlines(input.message);
  const expected = buildPublisherAuthMessage({
    action: input.expectedAction,
    timestamp: input.timestamp,
    skillId: input.skillId,
  });
  if (message === expected) {
    return { ok: true };
  }

  if (input.skillId && input.allowLegacyWithoutSkillId) {
    const legacy = buildPublisherAuthMessage({
      action: input.expectedAction,
      timestamp: input.timestamp,
    });
    if (message === legacy) {
      return { ok: true };
    }
  }

  const actionMatch = /^Action:\s*(.*)$/m.exec(message);
  const skillMatch = /^Skill id:\s*(.*)$/m.exec(message);
  const actualAction = actionMatch?.[1] ?? null;
  const actualSkillId = skillMatch?.[1] ?? null;

  if (actualAction !== null && actualAction !== input.expectedAction) {
    return {
      ok: false,
      error: `Signature is not for action "${input.expectedAction}" (got "${actualAction}").`,
    };
  }

  if (
    input.skillId &&
    actualSkillId !== null &&
    actualSkillId !== input.skillId
  ) {
    return {
      ok: false,
      error: "Signature skill id does not match this skill.",
    };
  }

  if (
    input.skillId &&
    actualSkillId === null &&
    !input.allowLegacyWithoutSkillId
  ) {
    return {
      ok: false,
      error: `Message scope mismatch: expected Action "${input.expectedAction}" and Skill id "${input.skillId}".`,
    };
  }

  return {
    ok: false,
    error: input.skillId
      ? `Message scope mismatch: expected Action "${input.expectedAction}" and Skill id "${input.skillId}".`
      : `Message scope mismatch: expected Action "${input.expectedAction}".`,
  };
}

export function buildDownloadRawMessage(
  skillId: string,
  listingAddress: string | null | undefined,
  timestamp: number
): string {
  return `AgentVouch Skill Download\nAction: download-raw\nSkill id: ${skillId}\nListing: ${
    listingAddress ?? "x402-usdc-direct"
  }\nTimestamp: ${timestamp}`;
}

export async function createSignedDownloadAuthPayload(input: {
  walletAddress: string;
  signMessage: (message: Uint8Array) => Promise<Uint8Array | string>;
  skillId: string;
  listingAddress?: string | null;
  timestamp?: number;
}): Promise<AuthPayload> {
  const timestamp = input.timestamp ?? Date.now();
  const message = buildDownloadRawMessage(
    input.skillId,
    input.listingAddress,
    timestamp
  );
  const signature = await input.signMessage(new TextEncoder().encode(message));

  return {
    pubkey: input.walletAddress,
    signature:
      typeof signature === "string" ? signature : encodeBase64(signature),
    message,
    timestamp,
  };
}

export function normalizeProtocolNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}
