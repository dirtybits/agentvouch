import { getAddressCodec, type Address } from "@solana/kit";
import nacl from "tweetnacl";
import type { AuthPayload } from "@/lib/authPayload";
import { getErrorMessage } from "@/lib/errors";

export {
  assertPublisherAuthMessageScope,
  buildDownloadRawMessage,
  buildPublisherAuthMessage,
  buildSignMessage,
  createSignedDownloadAuthPayload,
  normalizeProtocolNewlines,
  type AuthPayload,
} from "@/lib/authPayload";

type ApiKeyLookupRow = {
  owner_pubkey: string;
  permissions: string[] | null;
};

const AUTH_PAYLOAD_MAX_AGE_MS = 5 * 60_000;
const addressCodec = getAddressCodec();

export function verifyWalletSignature(payload: AuthPayload): {
  valid: boolean;
  pubkey: string | null;
  error?: string;
} {
  try {
    const { pubkey, signature, message, timestamp } = payload;

    const age = Date.now() - timestamp;
    if (age > AUTH_PAYLOAD_MAX_AGE_MS || age < -AUTH_PAYLOAD_MAX_AGE_MS) {
      return { valid: false, pubkey: null, error: "Signature expired" };
    }

    const publicKeyBytes = new Uint8Array(
      addressCodec.encode(pubkey as Address)
    );
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = Uint8Array.from(Buffer.from(signature, "base64"));

    const verified = nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKeyBytes
    );

    if (!verified) {
      return { valid: false, pubkey: null, error: "Invalid signature" };
    }

    return { valid: true, pubkey };
  } catch (error: unknown) {
    return { valid: false, pubkey: null, error: getErrorMessage(error) };
  }
}

export async function verifyApiKey(key: string): Promise<{
  valid: boolean;
  pubkey: string | null;
  permissions: string[];
  error?: string;
}> {
  try {
    if (!key.startsWith("sk_")) {
      return {
        valid: false,
        pubkey: null,
        permissions: [],
        error: "Invalid key format",
      };
    }

    const { createHash } = await import("crypto");
    const keyHash = createHash("sha256").update(key).digest("hex");

    const { sql } = await import("@/lib/db");
    const rows = await sql()<ApiKeyLookupRow>`
      SELECT owner_pubkey, permissions FROM api_keys
      WHERE key_hash = ${keyHash} AND revoked_at IS NULL
    `;

    if (rows.length === 0) {
      return {
        valid: false,
        pubkey: null,
        permissions: [],
        error: "Invalid or revoked API key",
      };
    }

    await sql()`
      UPDATE api_keys SET last_used_at = NOW() WHERE key_hash = ${keyHash}
    `;

    return {
      valid: true,
      pubkey: rows[0].owner_pubkey,
      permissions: rows[0].permissions ?? [],
    };
  } catch (error: unknown) {
    return {
      valid: false,
      pubkey: null,
      permissions: [],
      error: getErrorMessage(error),
    };
  }
}

export async function authenticateRequest(request: Request): Promise<{
  valid: boolean;
  pubkey: string | null;
  error?: string;
}> {
  const authHeader = request.headers.get("authorization");

  if (authHeader?.startsWith("Bearer sk_")) {
    const key = authHeader.slice(7);
    const result = await verifyApiKey(key);
    return { valid: result.valid, pubkey: result.pubkey, error: result.error };
  }

  try {
    const body = await request.clone().json();
    if (body?.auth) {
      const result = verifyWalletSignature(body.auth);
      return result;
    }
  } catch {
    // No JSON body or no auth field
  }

  return { valid: false, pubkey: null, error: "No authentication provided" };
}
