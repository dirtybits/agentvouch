import {
  AGENTVOUCH_DEFAULT_BASE_URL,
  AGENTVOUCH_DEFAULT_RPC_URL,
} from "@agentvouch/protocol";

// Return the first candidate that is non-empty after trimming. A blank or
// whitespace-only value (e.g. `--base-url "   "` or a stray env var) is
// therefore treated as *unset* and falls through the chain to the next
// candidate, rather than becoming `""` and breaking every subsequent API/RPC
// call in the invocation.
function firstNonBlank(...candidates: (string | undefined)[]): string {
  for (const raw of candidates) {
    if (raw == null) {
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed !== "") {
      return trimmed;
    }
  }
  return "";
}

export function resolveBaseUrl(baseUrl?: string): string {
  return firstNonBlank(
    baseUrl,
    process.env.AGENTVOUCH_BASE_URL,
    AGENTVOUCH_DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
}

export function resolveRpcUrl(rpcUrl?: string): string {
  return firstNonBlank(
    rpcUrl,
    process.env.AGENTVOUCH_RPC_URL,
    process.env.ANCHOR_PROVIDER_URL,
    AGENTVOUCH_DEFAULT_RPC_URL
  );
}
