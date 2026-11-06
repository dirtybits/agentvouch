import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import {
  getOptionalDownloadAuthPubkey,
  recordInstallAndDownloadEvent,
  resolveSkillAccess,
} from "@/lib/skillRawAccess";
import {
  buildArchiveForVersion,
  type SkillFileManifestEntry,
} from "@/lib/skillStorage";
import { getErrorMessage } from "@/lib/errors";

// Version-pinned tree download: GET /api/skills/{id}/versions/{version}/archive.
// Access rules are the same as /api/skills/{id}/archive (free, entitled, or a
// payment flow), decided by resolveSkillAccess. After access is granted, the
// requested version is served instead of the latest. Clients check the bytes
// against that version's tree_hash (docs/SKILL_TREE_HASH.md).

const VERSION_PATTERN = /^[1-9][0-9]{0,8}$/;

type PinnedVersionRow = {
  version_id: string;
  version: number;
  content: string;
  files: SkillFileManifestEntry[] | null;
  tree_hash: string | null;
  storage_backend: string | null;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; version: string }> }
) {
  try {
    const { id, version } = await params;
    if (!VERSION_PATTERN.test(version)) {
      return NextResponse.json(
        { error: "Version must be a positive integer" },
        { status: 400 }
      );
    }

    const access = await resolveSkillAccess(request, id);
    if (!access.ok) {
      return access.response;
    }

    const requestedVersion = Number(version);
    const rows = await sql()<PinnedVersionRow>`
      SELECT
        id AS version_id,
        version,
        content,
        files,
        tree_hash,
        storage_backend
      FROM skill_versions
      WHERE skill_id = ${access.skill.id}::uuid
        AND version = ${requestedVersion}
      LIMIT 1
    `;
    const pinned = rows[0];
    if (!pinned) {
      return NextResponse.json(
        { error: `Skill version ${requestedVersion} not found` },
        { status: 404 }
      );
    }

    const archive = await buildArchiveForVersion(pinned);
    await recordInstallAndDownloadEvent(access.skill.id, {
      kind: "archive",
      request,
      walletPubkey: await getOptionalDownloadAuthPubkey(
        request,
        id,
        access.skill.evm_listing_id ?? access.skill.on_chain_address
      ),
      authPresent: Boolean(request.headers.get("x-agentvouch-auth")),
      skillVersionId: pinned.version_id,
      skillVersion: pinned.version,
    });

    const treeHash = pinned.tree_hash ?? "skill";
    return new NextResponse(new Uint8Array(archive), {
      headers: {
        "Content-Type": "application/x-tar",
        "Content-Disposition": `attachment; filename="${id}-v${pinned.version}-${treeHash}.tar"`,
        "X-AgentVouch-Tree-Hash": treeHash,
        "X-AgentVouch-Skill-Version": String(pinned.version),
      },
    });
  } catch (error: unknown) {
    console.error(
      "GET /api/skills/[id]/versions/[version]/archive error:",
      error
    );
    return NextResponse.json(
      { error: getErrorMessage(error, "Internal server error") },
      { status: 500 }
    );
  }
}
