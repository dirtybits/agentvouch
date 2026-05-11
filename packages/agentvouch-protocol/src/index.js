export const AGENTVOUCH_DEFAULT_BASE_URL = "https://agentvouch.xyz";
export const AGENTVOUCH_DEFAULT_RPC_URL = "https://api.devnet.solana.com";
export const AGENTVOUCH_PROGRAM_ID =
  "AgnTDF3sXguYDpnkeS8jCyPRgaEahjivAWcqBjxDE7qZ";
export const AGENTVOUCH_SOLANA_CHAIN_CONTEXT =
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const AUTH_PAYLOAD_MAX_AGE_MS = 5 * 60_000;

export function buildSignMessage(action, timestamp) {
  return `AgentVouch Skill Repo\nAction: ${action}\nTimestamp: ${timestamp}`;
}

export function buildDownloadRawMessage(skillId, listingAddress, timestamp) {
  return `AgentVouch Skill Download\nAction: download-raw\nSkill id: ${skillId}\nListing: ${listingAddress ?? "x402-usdc-direct"}\nTimestamp: ${timestamp}`;
}

export function normalizeProtocolNewlines(value) {
  return value.replace(/\r\n/g, "\n");
}
