import { describe, expect, it } from "vitest";
import {
  buildTarArchive,
  buildZipArchive,
  computeTreeHash,
  ingestTarArchive,
  normalizeSkillTreeFiles,
  prepareSkillTree,
} from "@/lib/skillStorage";

function maliciousTarHeader(name: string, typeflag = "0", size = 0): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
  header.write("00000000000\0", 136, 12, "ascii");
  header.fill(" ", 148, 156);
  header.write(typeflag, 156, 1, "ascii");
  header.write("ustar", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  return Buffer.concat([header, Buffer.alloc(1024)]);
}

function readZipLocalEntries(archive: Buffer) {
  const entries: Array<{ path: string; content: Buffer; method: number }> = [];
  let offset = 0;

  while (offset + 30 <= archive.byteLength) {
    const signature = archive.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;

    const method = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const contentStart = nameStart + nameLength + extraLength;
    const contentEnd = contentStart + compressedSize;

    entries.push({
      path: archive
        .subarray(nameStart, nameStart + nameLength)
        .toString("utf8"),
      content: archive.subarray(contentStart, contentEnd),
      method,
    });
    offset = contentEnd;
  }

  return entries;
}

describe("skillStorage", () => {
  it("computes deterministic tree hashes independent of input order", () => {
    const a = prepareSkillTree([
      { path: "references/info.txt", content: "reference" },
      { path: "SKILL.md", content: "# Skill\n" },
    ]);
    const b = prepareSkillTree([
      { path: "SKILL.md", content: "# Skill\n" },
      { path: "references/info.txt", content: "reference" },
    ]);

    expect(a.treeHash).toBe(b.treeHash);
    expect(a.archiveBytes.equals(b.archiveBytes)).toBe(true);
  });

  it("changes tree hash when file bytes change", () => {
    const a = prepareSkillTree([{ path: "SKILL.md", content: "# Skill\n" }]);
    const b = prepareSkillTree([{ path: "SKILL.md", content: "# Skill!\n" }]);

    expect(a.treeHash).not.toBe(b.treeHash);
  });

  it("round-trips regular files through deterministic tar", () => {
    const files = normalizeSkillTreeFiles([
      { path: "SKILL.md", content: "# Skill\n" },
      { path: "scripts/run.sh", content: "#!/bin/sh\necho ok\n" },
    ]);
    const archive = buildTarArchive(files);
    const parsed = normalizeSkillTreeFiles(ingestTarArchive(archive));

    expect(computeTreeHash(parsed)).toBe(computeTreeHash(files));
    expect(parsed.map((file) => file.path).sort()).toEqual([
      "SKILL.md",
      "scripts/run.sh",
    ]);
  });

  it("builds deterministic uncompressed zip downloads from the same tree", () => {
    const files = normalizeSkillTreeFiles([
      { path: "SKILL.md", content: "# Skill\n" },
      { path: "scripts/run.sh", content: "#!/bin/sh\necho ok\n" },
    ]);
    const a = buildZipArchive(files);
    const b = buildZipArchive([...files].reverse());
    const entries = readZipLocalEntries(a);
    const contentByPath = new Map(
      entries.map((entry) => [entry.path, entry.content.toString("utf8")])
    );

    expect(a.equals(b)).toBe(true);
    expect(entries.map((entry) => entry.path)).toEqual(
      files.map((file) => file.path)
    );
    expect(entries.every((entry) => entry.method === 0)).toBe(true);
    expect(contentByPath.get("SKILL.md")).toBe("# Skill\n");
    expect(contentByPath.get("scripts/run.sh")).toContain("echo ok");
    expect(a.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(true);
  });

  it("rejects path traversal", () => {
    expect(() =>
      normalizeSkillTreeFiles([{ path: "../escape", content: "bad" }])
    ).toThrow(/path traversal/i);
    expect(() => ingestTarArchive(maliciousTarHeader("../escape"))).toThrow(
      /path traversal/i
    );
  });

  it("rejects symlink tar entries", () => {
    expect(() => ingestTarArchive(maliciousTarHeader("SKILL.md", "2"))).toThrow(
      /non-regular/i
    );
  });

  it("rejects uncompressed tar bombs", () => {
    expect(() =>
      ingestTarArchive(
        maliciousTarHeader("assets/big.bin", "0", 2 * 1024 * 1024)
      )
    ).toThrow(/exceeds cap/i);
  });
});
