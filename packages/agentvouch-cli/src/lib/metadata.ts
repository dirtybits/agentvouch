import { CliError } from "./errors.js";
import { readUtf8File, writeUtf8File } from "./fs.js";
import type { SkillRecord } from "./http.js";

export const INSTALL_METADATA_SCHEMA_VERSION = 1;

export interface InstalledSkillMetadata {
  schema_version: number;
  installed_with: "agentvouch-cli";
  skill_id: string;
  source: "repo" | "chain";
  installed_version: number;
  on_chain_address: string | null;
  skill_slug: string;
  author_pubkey: string;
  historical_sol_price_base_units?: number;
  price_usdc_micros?: string | null;
  currency_mint?: string | null;
  installed_at: string;
}

export function getInstallMetadataPath(skillFilePath: string): string {
  return `${skillFilePath}.agentvouch.json`;
}

export function buildInstalledSkillMetadata(
  installedSkillId: string,
  skill: SkillRecord
): InstalledSkillMetadata {
  return {
    schema_version: INSTALL_METADATA_SCHEMA_VERSION,
    installed_with: "agentvouch-cli",
    skill_id: installedSkillId,
    source: skill.source === "chain" ? "chain" : "repo",
    installed_version: skill.current_version ?? 1,
    on_chain_address: skill.on_chain_address ?? null,
    skill_slug: skill.skill_id,
    author_pubkey: skill.author_pubkey,
    historical_sol_price_base_units: skill.price_lamports ?? 0,
    price_usdc_micros: skill.price_usdc_micros ?? null,
    currency_mint: skill.currency_mint ?? null,
    installed_at: new Date().toISOString(),
  };
}

function isInstalledSkillMetadata(
  value: unknown
): value is InstalledSkillMetadata {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<InstalledSkillMetadata>;
  return (
    candidate.schema_version === INSTALL_METADATA_SCHEMA_VERSION &&
    candidate.installed_with === "agentvouch-cli" &&
    typeof candidate.skill_id === "string" &&
    (candidate.source === "repo" || candidate.source === "chain") &&
    typeof candidate.installed_version === "number" &&
    typeof candidate.skill_slug === "string" &&
    typeof candidate.author_pubkey === "string" &&
    (typeof candidate.historical_sol_price_base_units === "number" ||
      typeof (candidate as { price_lamports?: unknown }).price_lamports ===
        "number" ||
      candidate.historical_sol_price_base_units === undefined) &&
    typeof candidate.installed_at === "string" &&
    (typeof candidate.price_usdc_micros === "string" ||
      candidate.price_usdc_micros === null ||
      candidate.price_usdc_micros === undefined) &&
    (typeof candidate.currency_mint === "string" ||
      candidate.currency_mint === null ||
      candidate.currency_mint === undefined) &&
    (typeof candidate.on_chain_address === "string" ||
      candidate.on_chain_address === null)
  );
}

export async function writeInstalledSkillMetadata(
  skillFilePath: string,
  metadata: InstalledSkillMetadata
): Promise<string> {
  const metadataPath = getInstallMetadataPath(skillFilePath);
  await writeUtf8File(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  return metadataPath;
}

export async function readInstalledSkillMetadata(
  skillFilePath: string
): Promise<InstalledSkillMetadata | null> {
  const metadataPath = getInstallMetadataPath(skillFilePath);

  try {
    const raw = await readUtf8File(metadataPath);
    const parsed = JSON.parse(raw) as unknown;
    if (!isInstalledSkillMetadata(parsed)) {
      throw new CliError(
        `Install metadata at ${metadataPath} is invalid. Reinstall the skill or rerun update with --id to rewrite it.`
      );
    }
    return parsed;
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError) {
      throw new CliError(
        `Install metadata at ${metadataPath} is not valid JSON. Reinstall the skill or rerun update with --id to rewrite it.`
      );
    }
    throw error;
  }
}
