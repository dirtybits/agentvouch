import { NextRequest, NextResponse } from "next/server";
import { getFileForVersion } from "@/lib/skillStorage";
import { fetchOnChainSkillListing } from "@/lib/onchain";
import { getConfiguredUsdcMint, hasOnChainPurchase } from "@/lib/x402";
import { getErrorMessage } from "@/lib/errors";
import {
  AGENTVOUCH_PROTOCOL_VERSION,
  getAgentVouchChainContext,
  getAgentVouchProgramId,
} from "@/lib/protocolMetadata";
import {
  getOptionalDownloadAuthPubkey,
  recordInstallAndDownloadEvent,
  resolveSkillAccess,
  validateDownloadAuth,
  type RawSkillContentRow,
} from "@/lib/skillRawAccess";

const CHAIN_PREFIX = "chain-";

function serveContent(
  content: string | Buffer,
  extraHeaders?: Record<string, string>,
  options: { path?: string; contentType?: string } = {}
) {
  const filePath = options.path ?? "SKILL.md";
  const body = Buffer.isBuffer(content) ? new Uint8Array(content) : content;
  return new NextResponse(body, {
    headers: {
      "Content-Type": options.contentType ?? "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${
        filePath.split("/").at(-1)?.replace(/"/g, "") ?? "SKILL.md"
      }"`,
      ...(extraHeaders ?? {}),
    },
  });
}

function serveSkillContent(
  skill: RawSkillContentRow,
  extraHeaders?: Record<string, string>
) {
  return serveContent(skill.download_bytes ?? skill.content, extraHeaders, {
    path: skill.download_path ?? "SKILL.md",
    contentType: skill.download_content_type ?? "text/markdown; charset=utf-8",
  });
}

async function fetchSkillUriContent(skillUri: string) {
  const res = await fetch(skillUri);
  if (!res.ok) {
    throw new Error(`Skill URI fetch failed with status ${res.status}`);
  }
  return res.text();
}

async function handleChainOnlyRaw(request: NextRequest, id: string) {
  const onChainAddress = id.slice(CHAIN_PREFIX.length);
  const listing = await fetchOnChainSkillListing(onChainAddress);
  if (!listing) {
    return new NextResponse("Skill not found", { status: 404 });
  }
  if (!listing.data.skillUri) {
    return NextResponse.json(
      { error: "Chain-only skill has no skill_uri" },
      { status: 404 }
    );
  }

  const priceMicros = BigInt(listing.data.priceUsdcMicros);
  if (priceMicros <= 0n) {
    return serveContent(await fetchSkillUriContent(listing.data.skillUri));
  }

  const authHeader = request.headers.get("x-agentvouch-auth");
  if (authHeader) {
    const authResult = await validateDownloadAuth(
      authHeader,
      id,
      listing.publicKey
    );
    if ("response" in authResult) {
      return authResult.response;
    }

    const entitled = await hasOnChainPurchase(
      authResult.buyerPubkey,
      listing.publicKey
    ).catch(() => false);
    if (entitled) {
      return serveContent(await fetchSkillUriContent(listing.data.skillUri));
    }
  }

  return NextResponse.json(
    {
      error: "Direct purchase required",
      message:
        "This chain-only skill requires the on-chain purchase_skill flow. After the wallet transaction confirms, sign to download again.",
      payment_flow: "direct-purchase-skill",
      amount_micros: priceMicros.toString(),
      currency_mint: getConfiguredUsdcMint(),
      chain_context: getAgentVouchChainContext(),
      on_chain_program_id: getAgentVouchProgramId(),
      protocol_version: AGENTVOUCH_PROTOCOL_VERSION,
      on_chain_address: listing.publicKey,
    },
    { status: 402 }
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (id.startsWith(CHAIN_PREFIX)) {
      return handleChainOnlyRaw(request, id);
    }

    const access = await resolveSkillAccess(request, id);
    if (!access.ok) {
      return access.response;
    }

    const skill = access.skill;
    const requestedPath =
      request.nextUrl.searchParams.get("path") ?? "SKILL.md";
    try {
      if (requestedPath === "SKILL.md") {
        skill.download_bytes = Buffer.from(skill.content, "utf8");
        skill.download_path = "SKILL.md";
        skill.download_content_type = "text/markdown; charset=utf-8";
      } else {
        const requestedFile = await getFileForVersion(skill, requestedPath);
        skill.download_bytes = requestedFile.bytes;
        skill.download_path = requestedFile.path;
        skill.download_content_type = requestedFile.contentType;
      }
    } catch (error) {
      return NextResponse.json(
        { error: getErrorMessage(error, "Skill file not found") },
        { status: 404 }
      );
    }

    await recordInstallAndDownloadEvent(skill.id, {
      kind: "raw",
      request,
      requestedPath,
      walletPubkey: await getOptionalDownloadAuthPubkey(
        request,
        id,
        skill.evm_listing_id ?? skill.on_chain_address
      ),
      authPresent: Boolean(request.headers.get("x-agentvouch-auth")),
      skillVersionId: skill.version_id,
      skillVersion: skill.version,
    });
    return serveSkillContent(skill, access.headers);
  } catch (error: unknown) {
    console.error("GET /api/skills/[id]/raw error:", error);
    return new NextResponse(getErrorMessage(error, "Internal server error"), {
      status: 500,
    });
  }
}
