import { describe, expect, it } from "vitest";
import {
  buildTarArchive,
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
