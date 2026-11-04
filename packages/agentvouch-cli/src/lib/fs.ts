import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CliError } from "./errors.js";

export async function readUtf8File(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

export async function assertWritableOutputPath(
  filePath: string,
  force = false
): Promise<void> {
  if (force) {
    return;
  }

  try {
    await access(filePath);
    throw new CliError(
      `Refusing to overwrite existing file at ${filePath}. Re-run with --force to replace it.`
    );
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

export async function writeUtf8File(
  filePath: string,
  contents: string
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

/** Write bytes exactly as given (no text decoding or encoding). */
export async function writeBytesFile(
  filePath: string,
  contents: Uint8Array
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}
