import { Buffer } from "buffer";
import {
  ingestTarArchive,
  normalizeSkillTreeFiles,
  type SkillTreeInputFile,
} from "@/lib/skillStorage";
import { MAX_SKILL_UPLOAD_BYTES } from "@/lib/skillDraft";

type JsonRecord = Record<string, unknown>;

export interface ParsedSkillUpload {
  body: JsonRecord;
  files: SkillTreeInputFile[];
  skillContent: string;
}

export class SkillUploadError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

function assertUploadContentLength(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) return;

  const bytes = Number(contentLength);
  if (Number.isFinite(bytes) && bytes > MAX_SKILL_UPLOAD_BYTES) {
    throw new SkillUploadError("Upload exceeds size limit", 413);
  }
}

function assertWholePayloadBase64Size(value: string) {
  if (value.length > MAX_SKILL_UPLOAD_BYTES) {
    throw new SkillUploadError("Upload exceeds size limit", 413);
  }
}

function parseJsonField(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return JSON.parse(value);
}

function getStringField(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
}

function decodeBase64(value: string): Buffer {
  return Buffer.from(value, "base64");
}

function decodeJsonFiles(value: unknown): SkillTreeInputFile[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("files entries must be objects");
    }
    const item = entry as {
      path?: unknown;
      content?: unknown;
      encoding?: unknown;
    };
    if (typeof item.path !== "string" || typeof item.content !== "string") {
      throw new Error("files entries require string path and content");
    }
    return {
      path: item.path,
      content:
        item.encoding === "base64" ? decodeBase64(item.content) : item.content,
    };
  });
}

async function fileToInput(file: File): Promise<SkillTreeInputFile> {
  return {
    path: file.name,
    content: Buffer.from(await file.arrayBuffer()),
  };
}

async function parseMultipart(request: Request): Promise<ParsedSkillUpload> {
  const form = await request.formData();
  const body: JsonRecord = {};
  for (const key of [
    "skill_id",
    "name",
    "description",
    "contact",
    "chain_context",
    "price_usdc_micros",
    "currency_mint",
    "content",
    "changelog",
  ]) {
    const value = getStringField(form, key);
    if (value !== undefined) body[key] = value;
  }
  const auth = parseJsonField(form.get("auth"));
  if (auth !== undefined) body.auth = auth;
  const tags = parseJsonField(form.get("tags"));
  if (tags !== undefined) body.tags = tags;

  let files = await Promise.all(
    form
      .getAll("files")
      .filter((value): value is File => value instanceof File)
      .map(fileToInput)
  );

  const archive = form.get("archive");
  if (archive instanceof File) {
    files = ingestTarArchive(Buffer.from(await archive.arrayBuffer()));
  }

  const tarBase64 = getStringField(form, "tar_base64");
  if (tarBase64) {
    assertWholePayloadBase64Size(tarBase64);
    files = ingestTarArchive(decodeBase64(tarBase64));
  }

  if (files.length === 0 && typeof body.content === "string") {
    files = [{ path: "SKILL.md", content: body.content }];
  }

  const normalized = normalizeSkillTreeFiles(files);
  const skillFile = normalized.find((file) => file.path === "SKILL.md");
  if (!skillFile) throw new Error("Skill tree must include SKILL.md");
  return {
    body,
    files: normalized,
    skillContent: skillFile.bytes.toString("utf8"),
  };
}

async function parseJson(request: Request): Promise<ParsedSkillUpload> {
  const body = (await request.json()) as JsonRecord;
  let files =
    decodeJsonFiles(body.files) ??
    (typeof body.content === "string"
      ? [{ path: "SKILL.md", content: body.content }]
      : []);

  if (typeof body.files_base64_json === "string") {
    assertWholePayloadBase64Size(body.files_base64_json);
    files = decodeJsonFiles(
      JSON.parse(decodeBase64(body.files_base64_json).toString("utf8"))
    ) ?? files;
  }

  if (typeof body.tar_base64 === "string") {
    assertWholePayloadBase64Size(body.tar_base64);
    files = ingestTarArchive(decodeBase64(body.tar_base64));
  }

  const normalized = normalizeSkillTreeFiles(files);
  const skillFile = normalized.find((file) => file.path === "SKILL.md");
  if (!skillFile) throw new Error("Skill tree must include SKILL.md");
  return {
    body,
    files: normalized,
    skillContent: skillFile.bytes.toString("utf8"),
  };
}

export async function parseSkillUploadRequest(
  request: Request
): Promise<ParsedSkillUpload> {
  // Content-Length can be absent for chunked bodies; tree/file caps and platform
  // body limits remain the backstop. This catches honest clients and common abuse
  // before request.formData()/request.json() buffers the body.
  assertUploadContentLength(request);
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    return parseMultipart(request);
  }
  return parseJson(request);
}
