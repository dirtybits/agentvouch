export declare const AGENTVOUCH_DEFAULT_BASE_URL: "https://agentvouch.xyz";
export declare const AGENTVOUCH_DEFAULT_RPC_URL: "https://api.devnet.solana.com";
export declare const AGENTVOUCH_PROGRAM_ID: "AgnTDF3sXguYDpnkeS8jCyPRgaEahjivAWcqBjxDE7qZ";
export declare const AGENTVOUCH_SOLANA_CHAIN_CONTEXT: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export declare const AUTH_PAYLOAD_MAX_AGE_MS: number;

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

export declare function buildSignMessage(
  action: string,
  timestamp: number
): string;
export declare function buildDownloadRawMessage(
  skillId: string,
  listingAddress: string | null | undefined,
  timestamp: number
): string;
export declare function normalizeProtocolNewlines(value: string): string;
