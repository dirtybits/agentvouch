export const AGENTVOUCH_DEFAULT_BASE_URL = "https://agentvouch.xyz";
export const AGENTVOUCH_DEFAULT_RPC_URL = "https://api.devnet.solana.com";
export const AGENTVOUCH_PROGRAM_ID =
  "AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg";
export const AGENTVOUCH_SOLANA_CHAIN_CONTEXT =
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const AUTH_PAYLOAD_MAX_AGE_MS = 5 * 60_000;

export interface AuthPayload {
  pubkey: string;
  signature: string;
  message: string;
  timestamp: number;
}

export interface PaymentRequirement {
  scheme: "exact";
  network: "solana";
  chainContext?: string;
  programId: string;
  instruction: "purchaseSkill";
  skillListingAddress: string;
  mint: string;
  amount: number;
  resource: string;
  expiry: number;
  nonce: string;
  metadata?: Record<string, string>;
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

export function normalizeProtocolNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}
