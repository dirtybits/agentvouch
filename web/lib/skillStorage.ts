import { createHash } from "crypto";
import path from "path";
import { get, put } from "@vercel/blob";
import {
  MAX_SKILL_CONTENT_BYTES,
  MAX_SKILL_FILE_BYTES,
  MAX_SKILL_TREE_BYTES,
  MAX_SKILL_TREE_FILES,
} from "@/lib/skillDraft";

export type SkillStorageBackend = "blob" | "inline";

export interface SkillTreeInputFile {
  path: string;
  content: string | Uint8Array | Buffer;
}

export interface SkillFileManifestEntry {
  path: string;
  size: number;
  sha256: string;
  contentType: string;
  executable: boolean;
}

export interface SkillTreeStoreResult {
  backend: SkillStorageBackend;
  treeHash: string;
  manifest: SkillFileManifestEntry[];
  hasExecutable: boolean;
  archiveBytes: Buffer;
}

export interface StoredSkillVersionRef extends Record<string, unknown> {
  content: string;
  files: SkillFileManifestEntry[] | null;
  tree_hash: string | null;
  storage_backend: string | null;
}

const TAR_BLOCK_SIZE = 512;
const BLOB_ARCHIVE_PREFIX = "skills";
const EXECUTABLE_EXTENSIONS = new Set([
  ".bat",
  ".bash",
  ".c",
  ".cc",
  ".cmd",
  ".cjs",
  ".cpp",
  ".cs",
  ".go",
  ".h",
  ".hpp",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".mjs",
  ".php",
  ".pl",
  ".ps1",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".swift",
  ".ts",
  ".tsx",
  ".zsh",
]);

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function toBuffer(content: string | Uint8Array | Buffer): Buffer {
  if (Buffer.isBuffer(content)) return content;
  if (typeof content === "string") return Buffer.from(content, "utf8");
  return Buffer.from(content);
}

export function getBlobArchivePath(treeHash: string): string {
  return `${BLOB_ARCHIVE_PREFIX}/${treeHash}.tar`;
}

export function normalizeSkillPath(input: string): string {
  const raw = input.replace(/\\/g, "/").trim();
  if (!raw) throw new Error("File path is required");
  if (raw.startsWith("/") || /^[a-zA-Z]:\//.test(raw)) {
    throw new Error(`Invalid skill file path "${input}": absolute paths are not allowed`);
  }

  const parts = raw.split("/");
  if (parts.some((part) => part === ".." || part === "" || part === ".")) {
    throw new Error(`Invalid skill file path "${input}": path traversal is not allowed`);
  }

  const normalized = path.posix.normalize(raw);
  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error(`Invalid skill file path "${input}": path traversal is not allowed`);
  }
  return normalized;
}

function contentTypeForPath(filePath: string): string {
  const ext = path.posix.extname(filePath).toLowerCase();
  if (filePath === "SKILL.md" || ext === ".md") return "text/markdown; charset=utf-8";
  if ([".json", ".map"].includes(ext)) return "application/json; charset=utf-8";
  if ([".txt", ".log", ".env", ".csv"].includes(ext)) return "text/plain; charset=utf-8";
  if ([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"].includes(ext)) {
    return "text/plain; charset=utf-8";
  }
  if ([".sh", ".bash", ".zsh", ".py", ".rb", ".rs", ".go"].includes(ext)) {
    return "text/plain; charset=utf-8";
  }
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) {
    return "application/octet-stream";
  }
  return "application/octet-stream";
}

function isExecutablePath(filePath: string, content: Buffer): boolean {
  const ext = path.posix.extname(filePath).toLowerCase();
  return (
    filePath.startsWith("scripts/") ||
    EXECUTABLE_EXTENSIONS.has(ext) ||
    content.subarray(0, 2).toString("utf8") === "#!"
  );
}

export function normalizeSkillTreeFiles(
  files: SkillTreeInputFile[]
): Array<SkillTreeInputFile & { path: string; bytes: Buffer }> {
  if (files.length === 0) {
    throw new Error("Skill tree must include SKILL.md");
  }
  if (files.length > MAX_SKILL_TREE_FILES) {
    throw new Error(`Skill tree has ${files.length} files, exceeds cap of ${MAX_SKILL_TREE_FILES}`);
  }

  const seen = new Set<string>();
  let totalBytes = 0;
  const normalized = files.map((file) => {
    const filePath = normalizeSkillPath(file.path);
    if (seen.has(filePath)) throw new Error(`Duplicate skill file path "${filePath}"`);
    seen.add(filePath);

    const bytes = toBuffer(file.content);
    const fileCap =
      filePath === "SKILL.md" ? MAX_SKILL_CONTENT_BYTES : MAX_SKILL_FILE_BYTES;
    if (bytes.byteLength > fileCap) {
      throw new Error(`File "${filePath}" is ${bytes.byteLength} bytes, exceeds cap of ${fileCap} bytes`);
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_SKILL_TREE_BYTES) {
      throw new Error(`Skill tree is ${totalBytes} bytes, exceeds cap of ${MAX_SKILL_TREE_BYTES} bytes`);
    }
    return { ...file, path: filePath, bytes };
  });

  if (!seen.has("SKILL.md")) {
    throw new Error("Skill tree must include exactly one top-level SKILL.md");
  }

  return normalized.sort((a, b) => a.path.localeCompare(b.path));
}

export function buildSkillManifest(
  files: Array<{ path: string; bytes: Buffer }>
): SkillFileManifestEntry[] {
  return files.map((file) => ({
    path: file.path,
    size: file.bytes.byteLength,
    sha256: sha256(file.bytes),
    contentType: contentTypeForPath(file.path),
    executable: isExecutablePath(file.path, file.bytes),
  }));
}

export function computeTreeHash(
  filesOrManifest: Array<{ path: string; bytes?: Buffer; sha256?: string }>
): string {
  const entries = filesOrManifest
    .map((file) => {
      const digest = file.sha256 ?? (file.bytes ? sha256(file.bytes) : null);
      if (!digest) throw new Error(`Missing digest for "${file.path}"`);
      return `${file.path}\0${digest}`;
    })
    .sort();
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

function writeOctal(target: Buffer, offset: number, length: number, value: number) {
  const octal = value.toString(8).padStart(length - 1, "0");
  target.write(octal.slice(-length + 1), offset, length - 1, "ascii");
  target[offset + length - 1] = 0;
}

function splitTarName(filePath: string): { name: string; prefix: string } {
  const pathBytes = Buffer.byteLength(filePath);
  if (pathBytes <= 100) return { name: filePath, prefix: "" };

  const parts = filePath.split("/");
  for (let i = 1; i < parts.length; i += 1) {
    const prefix = parts.slice(0, i).join("/");
    const name = parts.slice(i).join("/");
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
  }
  throw new Error(`File path "${filePath}" is too long for tar storage`);
}

export function buildTarArchive(
  files: Array<{ path: string; bytes: Buffer }>
): Buffer {
  const chunks: Buffer[] = [];
  for (const file of files) {
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
    const padding = (TAR_BLOCK_SIZE - (file.bytes.byteLength % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
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
  if (!/^[0-7]+$/.test(raw)) throw new Error("Invalid tar size header");
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
      throw new Error("Tar archive contains a non-regular file entry");
    }

    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const filePath = normalizeSkillPath(prefix ? `${prefix}/${name}` : name);
    const size = readOctal(header, 124, 12);
    if (size > MAX_SKILL_FILE_BYTES && filePath !== "SKILL.md") {
      throw new Error(`File "${filePath}" is ${size} bytes, exceeds cap of ${MAX_SKILL_FILE_BYTES} bytes`);
    }
    if (filePath === "SKILL.md" && size > MAX_SKILL_CONTENT_BYTES) {
      throw new Error(`File "SKILL.md" is ${size} bytes, exceeds cap of ${MAX_SKILL_CONTENT_BYTES} bytes`);
    }
    totalBytes += size;
    if (files.length + 1 > MAX_SKILL_TREE_FILES) {
      throw new Error(`Skill tree exceeds cap of ${MAX_SKILL_TREE_FILES} files`);
    }
    if (totalBytes > MAX_SKILL_TREE_BYTES) {
      throw new Error(`Skill tree is ${totalBytes} bytes, exceeds cap of ${MAX_SKILL_TREE_BYTES} bytes`);
    }
    if (offset + size > bytes.byteLength) {
      throw new Error("Tar archive is truncated");
    }

    files.push({ path: filePath, content: bytes.subarray(offset, offset + size) });
    offset += size;
    offset += (TAR_BLOCK_SIZE - (size % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
  }

  return files;
}

export function prepareSkillTree(files: SkillTreeInputFile[]): SkillTreeStoreResult {
  const normalized = normalizeSkillTreeFiles(files);
  const manifest = buildSkillManifest(normalized);
  const treeHash = computeTreeHash(manifest);
  const archiveBytes = buildTarArchive(normalized);
  return {
    backend: "blob",
    treeHash,
    manifest,
    hasExecutable: manifest.some((file) => file.executable),
    archiveBytes,
  };
}

export async function putSkillTree(
  files: SkillTreeInputFile[]
): Promise<SkillTreeStoreResult> {
  const tree = prepareSkillTree(files);
  await put(getBlobArchivePath(tree.treeHash), tree.archiveBytes, {
    access: "private",
    allowOverwrite: true,
    contentType: "application/x-tar",
  });
  return tree;
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export async function buildArchiveForVersion(
  version: StoredSkillVersionRef
): Promise<Buffer> {
  if (version.storage_backend === "blob" && version.tree_hash) {
    const blob = await get(getBlobArchivePath(version.tree_hash), {
      access: "private",
    });
    if (!blob || blob.statusCode === 304 || !blob.stream) {
      throw new Error("Stored skill archive was not found");
    }
    return readStream(blob.stream);
  }

  const tree = prepareSkillTree([{ path: "SKILL.md", content: version.content }]);
  return tree.archiveBytes;
}

export async function getFileForVersion(
  version: StoredSkillVersionRef,
  requestedPath: string
): Promise<{ path: string; bytes: Buffer; contentType: string }> {
  const filePath = normalizeSkillPath(requestedPath || "SKILL.md");
  if (filePath === "SKILL.md" && version.storage_backend !== "blob") {
    return {
      path: filePath,
      bytes: Buffer.from(version.content, "utf8"),
      contentType: "text/markdown; charset=utf-8",
    };
  }

  const archive = await buildArchiveForVersion(version);
  const files = normalizeSkillTreeFiles(ingestTarArchive(archive));
  const match = files.find((file) => file.path === filePath);
  if (!match) throw new Error(`Skill file not found: ${filePath}`);
  return {
    path: filePath,
    bytes: match.bytes,
    contentType: contentTypeForPath(filePath),
  };
}
