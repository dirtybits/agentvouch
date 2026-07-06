import { NextRequest, NextResponse, after } from "next/server";
import { sql } from "@/lib/db";
import { verifyWalletSignature, type AuthPayload } from "@/lib/auth";
import { verifyEvmWalletSignature } from "@/lib/evmAuth";
import { pinSkillContent } from "@/lib/ipfs";
import { runReviewSafe } from "@/lib/ai/review";
import { putSkillTree } from "@/lib/skillStorage";
import { parseSkillUploadRequest, SkillUploadError } from "@/lib/skillUpload";
import { MAX_SKILL_CONTENT_BYTES } from "@/lib/skillDraft";
import { getErrorMessage } from "@/lib/errors";
import {
  BASE_SEPOLIA_CHAIN_CONTEXT,
  normalizeInputChainContext,
} from "@/lib/chains";
import { getAddress as getEvmAddress, isAddress as isEvmAddress } from "viem";

type VersionedSkillRow = {
  id: string;
  skill_id: string;
  author_pubkey: string | null;
  chain_context: string | null;
  current_version: number;
  ipfs_cid: string | null;
};

async function verifyVersionPublisherAuth(
  skill: VersionedSkillRow,
  auth: AuthPayload
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!skill.author_pubkey) {
    return {
      ok: false,
      status: 403,
      error:
        "This unverified publisher has not linked a wallet yet, so wallet-signed version publishing is unavailable.",
    };
  }

  const chainContext = normalizeInputChainContext(skill.chain_context);
  if (
    chainContext === BASE_SEPOLIA_CHAIN_CONTEXT &&
    isEvmAddress(skill.author_pubkey)
  ) {
    const verification = await verifyEvmWalletSignature(auth);
    if (!verification.valid || !verification.pubkey) {
      return {
        ok: false,
        status: 401,
        error: verification.error || "Invalid signature",
      };
    }
    if (
      getEvmAddress(skill.author_pubkey) !== getEvmAddress(verification.pubkey)
    ) {
      return { ok: false, status: 403, error: "Not the skill author" };
    }
    return { ok: true };
  }

  const verification = verifyWalletSignature(auth);
  if (!verification.valid || !verification.pubkey) {
    return {
      ok: false,
      status: 401,
      error: verification.error || "Invalid signature",
    };
  }
  if (skill.author_pubkey !== verification.pubkey) {
    return { ok: false, status: 403, error: "Not the skill author" };
  }
  return { ok: true };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const upload = await parseSkillUploadRequest(request);
    const body = upload.body;
    const content = upload.skillContent;
    const { auth, changelog } = body as {
      auth: AuthPayload;
      content?: string;
      changelog?: string;
    };

    if (!auth || !content) {
      return NextResponse.json(
        { error: "Missing required fields: auth, content" },
        { status: 400 }
      );
    }

    const contentBytes = Buffer.byteLength(content, "utf8");
    if (contentBytes > MAX_SKILL_CONTENT_BYTES) {
      return NextResponse.json(
        {
          error: `content is ${contentBytes} bytes, exceeds cap of ${MAX_SKILL_CONTENT_BYTES} bytes`,
        },
        { status: 400 }
      );
    }

    const rows = await sql()<VersionedSkillRow>`
      SELECT * FROM skills WHERE id = ${id}::uuid
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    const skill = rows[0];
    const authResult = await verifyVersionPublisherAuth(skill, auth);
    if (!authResult.ok) {
      return NextResponse.json(
        { error: authResult.error },
        { status: authResult.status }
      );
    }

    const newVersion = skill.current_version + 1;

    const tree = await putSkillTree(upload.files);
    const pinResult = await pinSkillContent(
      content,
      skill.skill_id,
      newVersion
    );

    await sql()`
      INSERT INTO skill_versions (
        skill_id,
        version,
        content,
        ipfs_cid,
        changelog,
        files,
        tree_hash,
        storage_backend,
        has_executable
      )
      VALUES (
        ${id}::uuid,
        ${newVersion},
        ${content},
        ${pinResult.success ? pinResult.cid : null},
        ${changelog || null},
        ${JSON.stringify(tree.manifest)}::jsonb,
        ${tree.treeHash},
        ${tree.backend},
        ${tree.hasExecutable}
      )
    `;

    await sql()`
      UPDATE skills
      SET current_version = ${newVersion},
          ipfs_cid = ${pinResult.success ? pinResult.cid : skill.ipfs_cid},
          updated_at = NOW()
      WHERE id = ${id}::uuid
    `;

    // Regenerate the automated review (summary + scan) for the new content.
    after(() =>
      runReviewSafe({
        skillId: id,
        content,
        treeHash: tree.treeHash,
        files: tree.filesWithBytes,
        expectedVersion: newVersion,
      })
    );

    return NextResponse.json(
      {
        version: newVersion,
        ipfs: pinResult,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("POST /api/skills/[id]/versions error:", error);
    const status = error instanceof SkillUploadError ? error.status : 500;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
