import { Buffer } from "node:buffer";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { CliError } from "./errors.js";

const MAX_SKILL_CONTENT_BYTES = 256 * 1024;
const MAX_SKILL_FILE_BYTES = 1024 * 1024;
const MAX_SKILL_TREE_BYTES = 5 * 1024 * 1024;
const MAX_SKILL_TREE_FILES = 200;
const TAR_BLOCK_SIZE = 512;
const SKIP_DIRECTORY_NAMES = new Set([".git", "node_modules"]);
const SKIP_FILE_NAMES = new Set([".DS_Store"]);

export interface SkillTreeInputFile {
  path: string;
  content: Buffer;
}

export interface PreparedSkillUpload {
  content: string;
  mode: "file" | "tree";
  fileCount: number;
  tarBase64?: string;
}

function normalizeSkillPath(filePath: string): string {
  if (!filePath || filePath.includes("\0")) {
    throw new CliError("Skill file paths must be non-empty strings.");
  }

  const normalized = path.posix.normalize(filePath.replace(/\\/g, "/"));
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new CliError(`Invalid skill file path "${filePath}".`);
  }

  return normalized;
}

function toNormalizedFiles(
  files: SkillTreeInputFile[]
): Array<SkillTreeInputFile & { bytes: Buffer }> {
  if (files.length === 0) {
    throw new CliError("Skill tree must include SKILL.md.");
  }
  if (files.length > MAX_SKILL_TREE_FILES) {
    throw new CliError(
      `Skill tree has ${files.length} files, exceeds cap of ${MAX_SKILL_TREE_FILES}.`
    );
  }

  const seen = new Set<string>();
  let totalBytes = 0;
  const normalized = files.map((file) => {
    const filePath = normalizeSkillPath(file.path);
    if (seen.has(filePath)) {
      throw new CliError(`Duplicate skill file path "${filePath}".`);
    }
    seen.add(filePath);

    const bytes = Buffer.from(file.content);
    const fileCap =
      filePath === "SKILL.md" ? MAX_SKILL_CONTENT_BYTES : MAX_SKILL_FILE_BYTES;
    if (bytes.byteLength > fileCap) {
      throw new CliError(
        `File "${filePath}" is ${bytes.byteLength} bytes, exceeds cap of ${fileCap} bytes.`
      );
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_SKILL_TREE_BYTES) {
      throw new CliError(
        `Skill tree is ${totalBytes} bytes, exceeds cap of ${MAX_SKILL_TREE_BYTES} bytes.`
      );
    }

    return { path: filePath, content: bytes, bytes };
  });

  if (!seen.has("SKILL.md")) {
    throw new CliError(
      "Skill tree must include exactly one top-level SKILL.md."
    );
  }

  return normalized.sort((a, b) => a.path.localeCompare(b.path));
}

async function collectDirectoryFiles(
  rootDir: string,
  currentDir = rootDir
): Promise<SkillTreeInputFile[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const files: SkillTreeInputFile[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && SKIP_DIRECTORY_NAMES.has(entry.name)) continue;
    if (entry.isFile() && SKIP_FILE_NAMES.has(entry.name)) continue;
    if (entry.isFile() && entry.name.endsWith(".agentvouch.json")) continue;

    const absolute = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectDirectoryFiles(rootDir, absolute)));
      continue;
    }
    if (!entry.isFile()) continue;

    files.push({
      path: path.relative(rootDir, absolute).split(path.sep).join("/"),
      content: await readFile(absolute),
    });
  }

  return files;
}

function writeOctal(
  target: Buffer,
  offset: number,
  length: number,
  value: number
) {
  const octal = value.toString(8).padStart(length - 1, "0");
  target.write(octal.slice(-length + 1), offset, length - 1, "ascii");
  target[offset + length - 1] = 0;
}

function splitTarName(filePath: string): { name: string; prefix: string } {
  if (Buffer.byteLength(filePath) <= 100) return { name: filePath, prefix: "" };

  const parts = filePath.split("/");
  for (let i = 1; i < parts.length; i += 1) {
    const prefix = parts.slice(0, i).join("/");
    const name = parts.slice(i).join("/");
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
  }
  throw new CliError(`File path "${filePath}" is too long for tar storage.`);
}

export function buildTarArchive(files: SkillTreeInputFile[]): Buffer {
  const normalized = toNormalizedFiles(files);
  const chunks: Buffer[] = [];

  for (const file of normalized) {
    const { name, prefix } = splitTarName(file.path);
    const header = Buffer.alloc(TAR_BLOCK_SIZE);
    header.write(name, 0, 100, "utf8");
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, file.bytes.byteLength);
    writeOctal(header, 136, 12, 0);
    header.fill(" ", 148, 156);
    header.write("0", 156, 1, "ascii");
    header.write("ustar", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    header.write(prefix, 345, 155, "utf8");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
    header[154] = 0;
    header[155] = 0x20;
    chunks.push(header, file.bytes);
    const padding =
      (TAR_BLOCK_SIZE - (file.bytes.byteLength % TAR_BLOCK_SIZE)) %
      TAR_BLOCK_SIZE;
    if (padding) chunks.push(Buffer.alloc(padding));
  }

  chunks.push(Buffer.alloc(TAR_BLOCK_SIZE * 2));
  return Buffer.concat(chunks);
}

function readString(block: Buffer, offset: number, length: number): string {
  const slice = block.subarray(offset, offset + length);
  const zero = slice.indexOf(0);
  return slice.subarray(0, zero >= 0 ? zero : undefined).toString("utf8");
}

function readOctal(block: Buffer, offset: number, length: number): number {
  const raw = readString(block, offset, length).trim();
  if (!raw) return 0;
  if (!/^[0-7]+$/.test(raw)) {
    throw new CliError("Invalid tar size header.");
  }
  return parseInt(raw, 8);
}

function isZeroBlock(block: Buffer): boolean {
  return block.every((byte) => byte === 0);
}

export function ingestTarArchive(bytes: Buffer): SkillTreeInputFile[] {
  const files: SkillTreeInputFile[] = [];
  let offset = 0;
  let totalBytes = 0;

  while (offset + TAR_BLOCK_SIZE <= bytes.byteLength) {
    const header = bytes.subarray(offset, offset + TAR_BLOCK_SIZE);
    offset += TAR_BLOCK_SIZE;
    if (isZeroBlock(header)) break;

    const typeflag = readString(header, 156, 1) || "0";
    if (typeflag !== "0") {
      throw new CliError("Tar archive contains a non-regular file entry.");
    }

    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const filePath = normalizeSkillPath(prefix ? `${prefix}/${name}` : name);
    const size = readOctal(header, 124, 12);
    totalBytes += size;
    if (files.length + 1 > MAX_SKILL_TREE_FILES) {
      throw new CliError(
        `Skill tree exceeds cap of ${MAX_SKILL_TREE_FILES} files.`
      );
    }
    if (totalBytes > MAX_SKILL_TREE_BYTES) {
      throw new CliError(
        `Skill tree is ${totalBytes} bytes, exceeds cap of ${MAX_SKILL_TREE_BYTES} bytes.`
      );
    }
    if (offset + size > bytes.byteLength) {
      throw new CliError("Tar archive is truncated.");
    }

    files.push({
      path: filePath,
      content: bytes.subarray(offset, offset + size),
    });
    offset += size;
    offset += (TAR_BLOCK_SIZE - (size % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
  }

  return toNormalizedFiles(files);
}

export async function prepareSkillUploadFromPath(
  inputPath: string
): Promise<PreparedSkillUpload> {
  const absolute = path.resolve(inputPath);
  const fileStat = await stat(absolute);

  if (!fileStat.isDirectory()) {
    const content = await readFile(absolute, "utf8");
    return {
      content,
      mode: "file",
      fileCount: 1,
    };
  }

  const files = toNormalizedFiles(await collectDirectoryFiles(absolute));
  const skillFile = files.find((file) => file.path === "SKILL.md");
  if (!skillFile) {
    throw new CliError(
      "Skill tree must include exactly one top-level SKILL.md."
    );
  }

  return {
    content: skillFile.bytes.toString("utf8"),
    mode: "tree",
    fileCount: files.length,
    tarBase64: buildTarArchive(files).toString("base64"),
  };
}

export async function writeTarArchiveToDirectory(
  outputDir: string,
  archive: Buffer
): Promise<number> {
  const files = ingestTarArchive(archive);

  for (const file of files) {
    const targetPath = path.join(outputDir, ...file.path.split("/"));
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, file.content);
  }

  return files.length;
}

export function isDirectoryLikeOutput(outputPath: string): boolean {
  return outputPath.endsWith(path.sep) || path.extname(outputPath) === "";
}
