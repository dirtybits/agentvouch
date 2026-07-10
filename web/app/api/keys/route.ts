import { NextRequest, NextResponse } from "next/server";
import { sql, initializeDatabase } from "@/lib/db";
import { verifyWalletSignature, type AuthPayload } from "@/lib/auth";
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

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function generateApiKey(): string {
  const bytes = randomBytes(32);
  return `sk_${bytes.toString("hex")}`;
}

export async function POST(request: NextRequest) {
  try {
    await initializeDatabase();
    const body = await request.json();
    const { auth, name } = body as { auth: AuthPayload; name?: string };

    if (!auth) {
      return NextResponse.json(
        { error: "Missing auth payload" },
        { status: 400 }
      );
    }

    const verification = verifyWalletSignature(auth);
    if (!verification.valid || !verification.pubkey) {
      return NextResponse.json(
        { error: verification.error || "Invalid signature" },
        { status: 401 }
      );
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
    const keyName = name?.trim() || "default";

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

    let signedAuth = body?.auth as AuthPayload | undefined;
    if (signedAuthHeader) {
      try {
        signedAuth = JSON.parse(signedAuthHeader) as AuthPayload;
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
    const { auth, key_id } = body as { auth: AuthPayload; key_id: string };

    if (!auth || !key_id) {
      return NextResponse.json(
        { error: "Missing required fields: auth, key_id" },
        { status: 400 }
      );
    }

    const verification = verifyWalletSignature(auth);
    if (!verification.valid || !verification.pubkey) {
      return NextResponse.json(
        { error: verification.error || "Invalid signature" },
        { status: 401 }
      );
    }

    const rows = await sql()<ApiKeyIdRow & ApiKeyOwnerRow>`
      SELECT id, owner_pubkey FROM api_keys
      WHERE id = ${key_id}::uuid AND revoked_at IS NULL
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
      UPDATE api_keys SET revoked_at = NOW() WHERE id = ${key_id}::uuid
    `;

    return NextResponse.json({ success: true, revoked: key_id });
  } catch (error: unknown) {
    console.error("DELETE /api/keys error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
