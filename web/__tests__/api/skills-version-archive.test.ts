import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/db", () => ({
  sql: vi.fn(),
}));

vi.mock("@/lib/skillRawAccess", () => ({
  getOptionalDownloadAuthPubkey: vi.fn().mockReturnValue(null),
  recordInstallAndDownloadEvent: vi.fn().mockResolvedValue(undefined),
  resolveSkillAccess: vi.fn(),
}));

vi.mock("@/lib/skillStorage", () => ({
  buildArchiveForVersion: vi.fn().mockResolvedValue(Buffer.from("tar-v2")),
}));

import { GET } from "@/app/api/skills/[id]/versions/[version]/archive/route";
import { sql } from "@/lib/db";
import {
  recordInstallAndDownloadEvent,
  resolveSkillAccess,
} from "@/lib/skillRawAccess";
import { buildArchiveForVersion } from "@/lib/skillStorage";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockResolveSkillAccess = resolveSkillAccess as unknown as ReturnType<
  typeof vi.fn
>;
const mockRecordEvent = recordInstallAndDownloadEvent as unknown as ReturnType<
  typeof vi.fn
>;
const mockBuildArchive = buildArchiveForVersion as unknown as ReturnType<
  typeof vi.fn
>;

const SKILL_ID = "8f6c3a52-4c1e-4b1f-9d2a-0f3e5b7c9a11";
const LATEST = {
  id: SKILL_ID,
  version_id: "version-3",
  version: 3,
  content: "# Latest",
  files: null,
  tree_hash: "c".repeat(64),
  storage_backend: "inline",
  evm_listing_id: null,
  on_chain_address: null,
};
const PINNED = {
  version_id: "version-2",
  version: 2,
  content: "# Version two",
  files: null,
  tree_hash: "b".repeat(64),
  storage_backend: "inline",
};

function request(version: string) {
  return new NextRequest(
    `http://localhost/api/skills/${SKILL_ID}/versions/${version}/archive`,
    { method: "GET" }
  );
}

function params(version: string) {
  return { params: Promise.resolve({ id: SKILL_ID, version }) };
}

function mockVersionRows(rows: unknown[]) {
  const query = vi.fn().mockResolvedValue(rows);
  mockSql.mockReturnValue(query);
  return query;
}

describe("GET /api/skills/[id]/versions/[version]/archive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildArchive.mockResolvedValue(Buffer.from("tar-v2"));
  });

  it.each(["0", "-1", "1.5", "v2", "01", "1234567890"])(
    "rejects version %j before any access check",
    async (version) => {
      const res = await GET(request(version), params(version));
      expect(res.status).toBe(400);
      expect(mockResolveSkillAccess).not.toHaveBeenCalled();
      expect(mockSql).not.toHaveBeenCalled();
    }
  );

  it("returns the access decision unchanged when access is denied", async () => {
    mockResolveSkillAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json(
        { error: "Payment required" },
        { status: 402 }
      ),
    });

    const res = await GET(request("2"), params("2"));

    expect(res.status).toBe(402);
    expect(mockSql).not.toHaveBeenCalled();
    expect(mockBuildArchive).not.toHaveBeenCalled();
    expect(mockRecordEvent).not.toHaveBeenCalled();
  });

  it("serves the requested version, not the latest, with its tree hash", async () => {
    mockResolveSkillAccess.mockResolvedValue({ ok: true, skill: LATEST });
    const query = mockVersionRows([PINNED]);

    const res = await GET(request("2"), params("2"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-tar");
    expect(res.headers.get("x-agentvouch-tree-hash")).toBe(PINNED.tree_hash);
    expect(res.headers.get("x-agentvouch-skill-version")).toBe("2");
    expect(await res.text()).toBe("tar-v2");
    expect(mockBuildArchive).toHaveBeenCalledWith(PINNED);
    const values = query.mock.calls[0].slice(1);
    expect(values).toEqual([SKILL_ID, 2]);
    expect(mockRecordEvent).toHaveBeenCalledWith(
      SKILL_ID,
      expect.objectContaining({
        kind: "archive",
        skillVersionId: "version-2",
        skillVersion: 2,
      })
    );
  });

  it("returns 404 when the version does not exist", async () => {
    mockResolveSkillAccess.mockResolvedValue({ ok: true, skill: LATEST });
    mockVersionRows([]);

    const res = await GET(request("9"), params("9"));

    expect(res.status).toBe(404);
    expect(mockBuildArchive).not.toHaveBeenCalled();
    expect(mockRecordEvent).not.toHaveBeenCalled();
  });
});
