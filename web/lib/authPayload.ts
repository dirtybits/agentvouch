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

export function buildStripeCheckoutMessage(
  skillId: string,
  timestamp: number
): string {
  return `AgentVouch Stripe Checkout\nAction: stripe-checkout\nSkill id: ${skillId}\nTimestamp: ${timestamp}`;
}

export async function createSignedDownloadAuthPayload(input: {
  walletAddress: string;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
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
  const signatureBytes = await input.signMessage(
    new TextEncoder().encode(message)
  );

  return {
    pubkey: input.walletAddress,
    signature: encodeBase64(signatureBytes),
    message,
    timestamp,
  };
}

export function normalizeProtocolNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}
