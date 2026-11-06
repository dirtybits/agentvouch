import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildTarArchive,
  DOWNLOAD_TREE_CAPS,
  ingestTarArchive,
  isDirectoryLikeOutput,
  writeSkillFilesToDirectory,
  writeTarArchiveToDirectory,
} from "../src/lib/archive.js";
import { CliError } from "../src/lib/errors.js";
import type { SkillTreeInputFile } from "../src/lib/archive.js";

function file(path: string, bytes: number): SkillTreeInputFile {
  return { path, content: Buffer.alloc(bytes) };
}

describe("skill archive path normalization guard", () => {
  it("rejects absolute and escape-style file paths", () => {
    const escapePaths = [
      "../etc/passwd",
      "../../etc/shadow",
      "..",
      ".",
      "/etc/passwd",
      "/usr/bin",
      "a/../b/../../x",
      "a/../../",
      "./..",
      "sub/..",
    ];
    for (const path of escapePaths) {
      expect(() =>
        buildTarArchive([
          { path: "SKILL.md", content: Buffer.from("# s\n") },
          { path, content: Buffer.alloc(0) },
        ])
      ).toThrow(CliError);
    }
  });

  it("normalizes backslashes to forward slashes before the guard", () => {
    // A Windows-style traversal spelled with backslashes must not slip through.
    expect(() =>
      buildTarArchive([
        { path: "SKILL.md", content: Buffer.from("# s\n") },
        { path: "SKILL.md\\..\\..\\etc", content: Buffer.alloc(0) },
      ])
    ).toThrow(CliError);
  });

  it("rejects empty or null-byte file paths", () => {
    expect(() =>
      buildTarArchive([
        { path: "SKILL.md", content: Buffer.from("# s\n") },
        { path: "", content: Buffer.alloc(0) },
      ])
    ).toThrow(CliError);
    expect(() =>
      buildTarArchive([
        { path: "SKILL.md", content: Buffer.from("# s\n") },
        { path: "a\0b", content: Buffer.alloc(0) },
      ])
    ).toThrow(CliError);
  });

  it("allows benign dot-prefixed directory names that are not traversal", () => {
    // "..a", "..b", and ".../x" contain dot sequences but never normalize to "..".
    const allowed = [
      "SKILL.md",
      "docs/..a/readme.md",
      "scripts/a..b.mjs",
      "archive/.../nested.txt",
      "a/b",
      "a/./b/c",
    ];
    const result = buildTarArchive(allowed.map((p) => file(p, 0)));
    expect(result.byteLength).toBeGreaterThan(0);
  });
});

describe("skill archive normalization and caps", () => {
  it("throws when the tree is empty", () => {
    expect(() => buildTarArchive([])).toThrow(
      "Skill tree must include SKILL.md."
    );
  });

  it("throws when a normalized tree has no SKILL.md", () => {
    expect(() =>
      buildTarArchive([{ path: "README.md", content: Buffer.from("# r\n") }])
    ).toThrow(CliError);
  });

  it("rejects duplicate paths including ones that normalize to the same value", () => {
    expect(() =>
      buildTarArchive([
        { path: "SKILL.md", content: Buffer.from("# s\n") },
        { path: "SKILL.md", content: Buffer.from("# dup\n") },
      ])
    ).toThrow(CliError);
    expect(() =>
      buildTarArchive([
        { path: "SKILL.md", content: Buffer.from("# s\n") },
        { path: "a/./b", content: Buffer.alloc(0) },
        { path: "a/b", content: Buffer.alloc(0) },
      ])
    ).toThrow(CliError);
  });

  it("rejects a SKILL.md larger than the 256 KiB content cap", () => {
    expect(() =>
      buildTarArchive([
        { path: "SKILL.md", content: Buffer.alloc(256 * 1024 + 1) },
      ])
    ).toThrow(CliError);
  });

  it("rejects a regular file larger than the 1 MiB file cap", () => {
    expect(() =>
      buildTarArchive([
        { path: "SKILL.md", content: Buffer.from("# s\n") },
        { path: "big.bin", content: Buffer.alloc(1024 * 1024 + 1) },
      ])
    ).toThrow(CliError);
  });

  it("rejects a tree whose total exceeds the 5 MiB cap", () => {
    // Six 1 MiB files (1 MiB each stays under the per-file 1 MiB cap, but the
    // running total crosses MAX_SKILL_TREE_BYTES (5 MiB) on the sixth file.
    const big = Buffer.alloc(1024 * 1024);
    const files: SkillTreeInputFile[] = [
      { path: "SKILL.md", content: Buffer.alloc(0) },
    ];
    for (let i = 0; i < 6; i += 1)
      files.push({ path: `big-${i}.bin`, content: big });
    expect(() => buildTarArchive(files)).toThrow(CliError);
  });

  it("rejects a tree with more than 200 files", () => {
    const files: SkillTreeInputFile[] = [
      { path: "SKILL.md", content: Buffer.alloc(0) },
    ];
    for (let i = 0; i < 200; i += 1)
      files.push({ path: `f-${i}`, content: Buffer.alloc(0) });
    // files length is 201, which exceeds MAX_SKILL_TREE_FILES (200).
    expect(() => buildTarArchive(files)).toThrow(CliError);
  });
});

describe("buildTarArchive / ingestTarArchive round trip", () => {
  it("round-trips a multi-file tree preserving paths and contents", () => {
    const input: SkillTreeInputFile[] = [
      { path: "SKILL.md", content: Buffer.from("# skill\n") },
      { path: "scripts/run.mjs", content: Buffer.from("export default 1;\n") },
      { path: "docs/notes.txt", content: Buffer.from("hello\n") },
    ];
    const archive = buildTarArchive(input);
    const parsed = ingestTarArchive(archive);
    expect(parsed.length).toBe(3);
    const byPath = new Map(
      parsed.map((f) => [f.path, f.content.toString("utf8")])
    );
    expect(byPath.get("SKILL.md")).toBe("# skill\n");
    expect(byPath.get("scripts/run.mjs")).toBe("export default 1;\n");
    expect(byPath.get("docs/notes.txt")).toBe("hello\n");
  });
});

describe("writeTarArchiveToDirectory", () => {
  it("writes the archive contents out to the target directory", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentvouch-cli-"));
    const count = await writeTarArchiveToDirectory(
      tempDir,
      buildTarArchive([
        { path: "SKILL.md", content: Buffer.from("# skill\n") },
        {
          path: "scripts/run.mjs",
          content: Buffer.from("export default 1;\n"),
        },
      ])
    );
    expect(count).toBe(2);
    expect(await readFile(`${tempDir}/SKILL.md`, "utf8")).toBe("# skill\n");
  });
});

describe("isDirectoryLikeOutput", () => {
  it("treats trailing-separator and extensionless names as directory-like", () => {
    expect(isDirectoryLikeOutput("out/")).toBe(true);
    expect(isDirectoryLikeOutput("out")).toBe(true);
    expect(isDirectoryLikeOutput("out.md")).toBe(false);
    expect(isDirectoryLikeOutput("skills.tar")).toBe(false);
  });
});

describe("download limits", () => {
  function tree(count: number): SkillTreeInputFile[] {
    const files = [{ path: "SKILL.md", content: Buffer.from("# big\n") }];
    for (let index = 1; index < count; index += 1) {
      files.push({
        path: `references/part-${String(index).padStart(3, "0")}.md`,
        content: Buffer.from(`part ${index}\n`),
      });
    }
    return files;
  }

  it("keeps the 200-file upload limit for publishing", () => {
    expect(() => buildTarArchive(tree(201))).toThrow("exceeds cap of 200");
  });

  // Minimal ustar writer for this test only: it has no file-count limit, so it
  // can model a stored mirror tree that is larger than the upload limit.
  function tarOf(files: SkillTreeInputFile[]): Buffer {
    const blocks: Buffer[] = [];
    for (const entry of files) {
      const header = Buffer.alloc(512);
      header.write(entry.path, 0, 100, "utf8");
      header.write("0000644\0", 100, 8, "ascii");
      header.write("0000000\0", 108, 8, "ascii");
      header.write("0000000\0", 116, 8, "ascii");
      header.write(
        entry.content.byteLength.toString(8).padStart(11, "0") + "\0",
        124,
        12,
        "ascii"
      );
      header.write("00000000000\0", 136, 12, "ascii");
      header.fill(" ", 148, 156);
      header.write("0", 156, 1, "ascii");
      header.write("ustar", 257, 6, "ascii");
      header.write("00", 263, 2, "ascii");
      const checksum = header.reduce((sum, byte) => sum + byte, 0);
      header.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
      header[154] = 0;
      header[155] = 0x20;
      const padding = (512 - (entry.content.byteLength % 512)) % 512;
      blocks.push(header, entry.content, Buffer.alloc(padding));
    }
    blocks.push(Buffer.alloc(1024));
    return Buffer.concat(blocks);
  }

  it("reads downloaded trees up to the 512-file mirror limit", () => {
    const archive = tarOf(tree(300));

    expect(() => ingestTarArchive(archive)).toThrow("exceeds cap of 200");
    expect(ingestTarArchive(archive, DOWNLOAD_TREE_CAPS)).toHaveLength(300);
    expect(DOWNLOAD_TREE_CAPS).toEqual({
      maxFiles: 512,
      maxBytes: 8 * 1024 * 1024,
    });
  });

  it("writes already-checked files with writeSkillFilesToDirectory", async () => {
    const outputDir = await mkdtemp(
      path.join(os.tmpdir(), "agentvouch-write-")
    );
    const count = await writeSkillFilesToDirectory(outputDir, [
      { path: "SKILL.md", content: Buffer.from("# skill\n") },
      { path: "scripts/run.sh", content: Buffer.from("echo hi\n") },
    ]);
    expect(count).toBe(2);
    expect(
      await readFile(path.join(outputDir, "scripts", "run.sh"), "utf8")
    ).toBe("echo hi\n");
  });
});
