import { NextRequest, NextResponse, after } from "next/server";
import { sql } from "@/lib/db";
import { verifyWalletSignature, type AuthPayload } from "@/lib/auth";
import { pinSkillContent } from "@/lib/ipfs";
import { generateSummarySafe } from "@/lib/ai/summarize";
import { MAX_SKILL_CONTENT_BYTES } from "@/lib/skillDraft";
import { getErrorMessage } from "@/lib/errors";

type VersionedSkillRow = {
  id: string;
  skill_id: string;
  author_pubkey: string | null;
  current_version: number;
  ipfs_cid: string | null;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { auth, content, changelog } = body as {
      auth: AuthPayload;
      content: string;
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

    const verification = verifyWalletSignature(auth);
    if (!verification.valid) {
      return NextResponse.json(
        { error: verification.error || "Invalid signature" },
        { status: 401 }
      );
    }

    const rows = await sql()<VersionedSkillRow>`
      SELECT * FROM skills WHERE id = ${id}::uuid
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    const skill = rows[0];

    if (!skill.author_pubkey) {
      return NextResponse.json(
        {
          error:
            "This unverified publisher has not linked a wallet yet, so wallet-signed version publishing is unavailable.",
        },
        { status: 403 }
      );
    }

    if (skill.author_pubkey !== verification.pubkey) {
      return NextResponse.json(
        { error: "Not the skill author" },
        { status: 403 }
      );
    }

    const newVersion = skill.current_version + 1;

    const pinResult = await pinSkillContent(
      content,
      skill.skill_id,
      newVersion
    );

    await sql()`
      INSERT INTO skill_versions (skill_id, version, content, ipfs_cid, changelog)
      VALUES (
        ${id}::uuid,
        ${newVersion},
        ${content},
        ${pinResult.success ? pinResult.cid : null},
        ${changelog || null}
      )
    `;

    await sql()`
      UPDATE skills
      SET current_version = ${newVersion},
          ipfs_cid = ${pinResult.success ? pinResult.cid : skill.ipfs_cid},
          updated_at = NOW()
      WHERE id = ${id}::uuid
    `;

    // Regenerate the AI summary for the new content after the response.
    after(() =>
      generateSummarySafe(id, content, { expectedVersion: newVersion })
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
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
