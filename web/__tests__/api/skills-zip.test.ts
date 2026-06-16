import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/skillRawAccess", () => ({
  getOptionalDownloadAuthPubkey: vi.fn().mockReturnValue(null),
  recordInstallAndDownloadEvent: vi.fn().mockResolvedValue(undefined),
  resolveSkillAccess: vi.fn(),
}));

vi.mock("@/lib/skillStorage", () => ({
  buildZipForVersion: vi.fn().mockResolvedValue(Buffer.from("zip-bytes")),
}));

import { GET } from "@/app/api/skills/[id]/zip/route";
import {
  recordInstallAndDownloadEvent,
  resolveSkillAccess,
} from "@/lib/skillRawAccess";
import { buildZipForVersion } from "@/lib/skillStorage";

const mockResolveSkillAccess = resolveSkillAccess as unknown as ReturnType<
  typeof vi.fn
>;
const mockRecordInstallAndDownloadEvent =
  recordInstallAndDownloadEvent as unknown as ReturnType<typeof vi.fn>;
const mockBuildZip = buildZipForVersion as unknown as ReturnType<typeof vi.fn>;

const ENTITLED_SKILL = {
  id: "skill-1",
  content: "# Skill",
  files: null,
  tree_hash: "abc123",
  storage_backend: "inline",
};

function makeRequest() {
  return new NextRequest("http://localhost/api/skills/skill-1/zip", {
    method: "GET",
  });
}

describe("GET /api/skills/[id]/zip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildZip.mockResolvedValue(Buffer.from("zip-bytes"));
  });

  it("returns raw entitlement failures without serving zip bytes", async () => {
    mockResolveSkillAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json(
        { error: "Payment required" },
        { status: 402 }
      ),
    });

    const res = await GET(makeRequest(), {
      params: Promise.resolve({ id: "skill-1" }),
    });

    expect(res.status).toBe(402);
    expect(mockBuildZip).not.toHaveBeenCalled();
    expect(mockRecordInstallAndDownloadEvent).not.toHaveBeenCalled();
  });

  it("serves zip after entitlement succeeds and increments installs once", async () => {
    mockResolveSkillAccess.mockResolvedValue({
      ok: true,
      skill: ENTITLED_SKILL,
    });

    const res = await GET(makeRequest(), {
      params: Promise.resolve({ id: "skill-1" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain(".zip");
    expect(res.headers.get("x-agentvouch-tree-hash")).toBe("abc123");
    expect(await res.text()).toBe("zip-bytes");
    expect(mockBuildZip).toHaveBeenCalledWith(ENTITLED_SKILL);
    expect(mockRecordInstallAndDownloadEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordInstallAndDownloadEvent).toHaveBeenCalledWith(
      "skill-1",
      expect.objectContaining({ kind: "archive" })
    );
  });
});
