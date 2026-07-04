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
