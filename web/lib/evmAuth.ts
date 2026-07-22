// EVM publisher auth (Phase 8a). Verifies the same AuthPayload shape the Solana
// Ed25519 path uses (web/lib/auth.ts), but for EVM addresses: the signature is a
// hex personal_sign / smart-account signature checked with viem's
// publicClient.verifyMessage, which handles EOA ecrecover plus ERC-1271 and
// ERC-6492 (deployed and counterfactual Coinbase Smart Wallet passkeys).

import {
  createPublicClient,
  http,
  isAddress as isEvmAddress,
  type Hex,
  type PublicClient,
} from "viem";
import { BASE_SEPOLIA_RPC_URL } from "@/lib/adapters/baseConfig";
import type { AuthPayload } from "@/lib/authPayload";
import { getErrorMessage } from "@/lib/errors";

const AUTH_PAYLOAD_MAX_AGE_MS = 5 * 60_000;

let cachedClient: PublicClient | null = null;

function getVerificationClient(): PublicClient {
  if (!cachedClient) {
    cachedClient = createPublicClient({
      transport: http(BASE_SEPOLIA_RPC_URL),
    });
  }
  return cachedClient;
}

export async function verifyEvmWalletSignature(
  payload: AuthPayload,
  options?: { client?: Pick<PublicClient, "verifyMessage"> }
): Promise<{ valid: boolean; pubkey: string | null; error?: string }> {
  try {
    const { pubkey, signature, message, timestamp } = payload;

    // JSON request bodies are untyped at runtime. Without this guard, a
    // non-numeric timestamp makes both age comparisons false and bypasses the
    // five-minute replay window.
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
      return { valid: false, pubkey: null, error: "Invalid timestamp" };
    }

    const age = Date.now() - timestamp;
    if (age > AUTH_PAYLOAD_MAX_AGE_MS || age < -AUTH_PAYLOAD_MAX_AGE_MS) {
      return { valid: false, pubkey: null, error: "Signature expired" };
    }

    if (!isEvmAddress(pubkey)) {
      return { valid: false, pubkey: null, error: "Invalid EVM address" };
    }
    if (!signature.startsWith("0x")) {
      return {
        valid: false,
        pubkey: null,
        error: "EVM signatures must be 0x-prefixed hex",
      };
    }

    const client = options?.client ?? getVerificationClient();
    const verified = await client.verifyMessage({
      address: pubkey as Hex,
      message,
      signature: signature as Hex,
    });

    if (!verified) {
      return { valid: false, pubkey: null, error: "Invalid signature" };
    }

    // Phase 6 storage invariant: EVM addresses are stored lowercase.
    return { valid: true, pubkey: pubkey.toLowerCase() };
  } catch (error: unknown) {
    return { valid: false, pubkey: null, error: getErrorMessage(error) };
  }
}
