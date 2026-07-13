import { NextRequest, NextResponse } from "next/server";
import { sql, initializeDatabase } from "@/lib/db";
import { AUTH_PAYLOAD_MAX_AGE_MS, verifyWalletSignature } from "@/lib/auth";
import {
  assertApiKeyAuthMessageScope,
  normalizeApiKeyName,
  normalizeApiKeyUuid,
  type ApiKeyAuthAction,
  type ApiKeyAuthPayload,
} from "@/lib/apiKeyAuth";
import { randomBytes, createHash } from "crypto";
import { getErrorMessage } from "@/lib/errors";

type ApiKeyIdRow = { id: string };
type ApiKeyOwnerRow = { owner_pubkey: string };
type ApiKeyInsertRow = {
  id: string;
  key_prefix: string;
  name: string;
  permissions: string[];
  created_at: string;
};
type ApiKeyListRow = {
  id: string;
  key_prefix: string;
  name: string;
  permissions: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};
type ApiKeyAuthNonceRow = { nonce: string };

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function generateApiKey(): string {
  const bytes = randomBytes(32);
  return `sk_${bytes.toString("hex")}`;
}

async function consumeApiKeyAuthNonce(input: {
  ownerPubkey: string;
  auth: ApiKeyAuthPayload;
  action: ApiKeyAuthAction;
}): Promise<boolean> {
  const expiresAt = new Date(
    input.auth.timestamp + AUTH_PAYLOAD_MAX_AGE_MS
  ).toISOString();
  const rows = await sql()<ApiKeyAuthNonceRow>`
    WITH expired_nonces AS (
      DELETE FROM api_key_auth_nonces
      WHERE ctid IN (
        SELECT ctid
        FROM api_key_auth_nonces
        WHERE expires_at < NOW() - INTERVAL '5 minutes'
        ORDER BY expires_at ASC
        LIMIT 100
      )
      RETURNING nonce
    )
    INSERT INTO api_key_auth_nonces (
      owner_pubkey,
      nonce,
      action,
      expires_at
    )
    VALUES (
      ${input.ownerPubkey},
      ${input.auth.nonce}::uuid,
      ${input.action},
      ${expiresAt}::timestamptz
    )
    ON CONFLICT (owner_pubkey, nonce) DO NOTHING
    RETURNING nonce::text
  `;
  return rows.length === 1;
}

function replayResponse() {
  return NextResponse.json(
    { error: "API key signature nonce already used" },
    { status: 409 }
  );
}

export async function POST(request: NextRequest) {
  try {
    await initializeDatabase();
    const body = await request.json();
    const { auth, name } = body as {
      auth: ApiKeyAuthPayload;
      name?: unknown;
    };

    if (!auth) {
      return NextResponse.json(
        { error: "Missing auth payload" },
        { status: 400 }
      );
    }

    const keyNameResult = normalizeApiKeyName(name);
    if (!keyNameResult.ok) {
      return NextResponse.json({ error: keyNameResult.error }, { status: 400 });
    }
    const keyName = keyNameResult.value;

    const verification = verifyWalletSignature(auth);
    if (!verification.valid || !verification.pubkey) {
      return NextResponse.json(
        { error: verification.error || "Invalid signature" },
        { status: 401 }
      );
    }

    const scope = assertApiKeyAuthMessageScope({
      auth,
      expectedAction: "create-key",
      expectedAudience: request.nextUrl.origin,
      keyName,
    });
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: 401 });
    }
    if (
      !(await consumeApiKeyAuthNonce({
        ownerPubkey: verification.pubkey,
        auth,
        action: "create-key",
      }))
    ) {
      return replayResponse();
    }

    const existing = await sql()<ApiKeyIdRow>`
      SELECT id FROM api_keys
      WHERE owner_pubkey = ${verification.pubkey} AND revoked_at IS NULL
    `;
    if (existing.length >= 5) {
      return NextResponse.json(
        {
          error:
            "Maximum 5 active API keys allowed. Revoke an existing key first.",
        },
        { status: 400 }
      );
    }

    const rawKey = generateApiKey();
    const keyHash = hashKey(rawKey);
    const keyPrefix = rawKey.slice(0, 12);
    const [row] = await sql()<ApiKeyInsertRow>`
      INSERT INTO api_keys (owner_pubkey, key_hash, key_prefix, name)
      VALUES (${verification.pubkey}, ${keyHash}, ${keyPrefix}, ${keyName})
      RETURNING id, key_prefix, name, permissions, created_at
    `;

    return NextResponse.json({
      ...row,
      key: rawKey,
      warning: "Store this key securely — it will not be shown again.",
    });
  } catch (error: unknown) {
    console.error("POST /api/keys error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase();
    const body = await request.json().catch(() => null);

    const authHeader = request.headers.get("authorization");
    const signedAuthHeader = request.headers.get("x-agentvouch-auth");
    let pubkey: string | null = null;

    let signedAuth = body?.auth as ApiKeyAuthPayload | undefined;
    if (signedAuthHeader) {
      try {
        signedAuth = JSON.parse(signedAuthHeader) as ApiKeyAuthPayload;
      } catch {
        return NextResponse.json(
          { error: "Malformed X-AgentVouch-Auth header" },
          { status: 400 }
        );
      }
    }

    if (signedAuth) {
      const verification = verifyWalletSignature(signedAuth);
      if (!verification.valid || !verification.pubkey) {
        return NextResponse.json(
          { error: verification.error || "Invalid signature" },
          { status: 401 }
        );
      }
      const scope = assertApiKeyAuthMessageScope({
        auth: signedAuth,
        expectedAction: "list-keys",
        expectedAudience: request.nextUrl.origin,
      });
      if (!scope.ok) {
        return NextResponse.json({ error: scope.error }, { status: 401 });
      }
      if (
        !(await consumeApiKeyAuthNonce({
          ownerPubkey: verification.pubkey,
          auth: signedAuth,
          action: "list-keys",
        }))
      ) {
        return replayResponse();
      }
      pubkey = verification.pubkey;
    } else if (authHeader?.startsWith("Bearer sk_")) {
      const key = authHeader.slice(7);
      const keyHash = hashKey(key);
      const rows = await sql()<ApiKeyOwnerRow>`
        SELECT owner_pubkey FROM api_keys
        WHERE key_hash = ${keyHash} AND revoked_at IS NULL
      `;
      if (rows.length === 0) {
        return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
      }
      pubkey = rows[0].owner_pubkey;
    }

    if (!pubkey) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const keys = await sql()<ApiKeyListRow>`
      SELECT id, key_prefix, name, permissions, created_at, last_used_at, revoked_at
      FROM api_keys
      WHERE owner_pubkey = ${pubkey}
      ORDER BY created_at DESC
    `;

    return NextResponse.json({ keys });
  } catch (error: unknown) {
    console.error("GET /api/keys error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await initializeDatabase();
    const body = await request.json();
    const { auth, key_id } = body as {
      auth: ApiKeyAuthPayload;
      key_id: unknown;
    };

    if (!auth || !key_id) {
      return NextResponse.json(
        { error: "Missing required fields: auth, key_id" },
        { status: 400 }
      );
    }

    const keyIdResult = normalizeApiKeyUuid(key_id, "key id");
    if (!keyIdResult.ok) {
      return NextResponse.json({ error: keyIdResult.error }, { status: 400 });
    }
    const keyId = keyIdResult.value;

    const verification = verifyWalletSignature(auth);
    if (!verification.valid || !verification.pubkey) {
      return NextResponse.json(
        { error: verification.error || "Invalid signature" },
        { status: 401 }
      );
    }

    const scope = assertApiKeyAuthMessageScope({
      auth,
      expectedAction: "revoke-key",
      expectedAudience: request.nextUrl.origin,
      keyId,
    });
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: 401 });
    }
    if (
      !(await consumeApiKeyAuthNonce({
        ownerPubkey: verification.pubkey,
        auth,
        action: "revoke-key",
      }))
    ) {
      return replayResponse();
    }

    const rows = await sql()<ApiKeyIdRow & ApiKeyOwnerRow>`
      SELECT id, owner_pubkey FROM api_keys
      WHERE id = ${keyId}::uuid AND revoked_at IS NULL
    `;
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Key not found or already revoked" },
        { status: 404 }
      );
    }
    if (rows[0].owner_pubkey !== verification.pubkey) {
      return NextResponse.json({ error: "Not your API key" }, { status: 403 });
    }

    await sql()`
      UPDATE api_keys SET revoked_at = NOW() WHERE id = ${keyId}::uuid
    `;

    return NextResponse.json({ success: true, revoked: keyId });
  } catch (error: unknown) {
    console.error("DELETE /api/keys error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
