import { NextRequest, NextResponse } from "next/server";
import {
  getOptionalDownloadAuthPubkey,
  recordInstallAndDownloadEvent,
  resolveSkillAccess,
} from "@/lib/skillRawAccess";
import { getErrorMessage } from "@/lib/errors";
import { buildZipForVersion } from "@/lib/skillStorage";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const access = await resolveSkillAccess(request, id);
    if (!access.ok) {
      return access.response;
    }

    const archive = await buildZipForVersion(access.skill);
    await recordInstallAndDownloadEvent(access.skill.id, {
      kind: "archive",
      request,
      walletPubkey: getOptionalDownloadAuthPubkey(
        request,
        id,
        access.skill.on_chain_address
      ),
      authPresent: Boolean(request.headers.get("x-agentvouch-auth")),
      skillVersionId: access.skill.version_id,
      skillVersion: access.skill.version,
    });
    const treeHash = access.skill.tree_hash ?? "skill";
    return new NextResponse(new Uint8Array(archive), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${id}-${treeHash}.zip"`,
        "X-AgentVouch-Tree-Hash": treeHash,
      },
    });
  } catch (error: unknown) {
    console.error("GET /api/skills/[id]/zip error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "Internal server error") },
      { status: 500 }
    );
  }
}
