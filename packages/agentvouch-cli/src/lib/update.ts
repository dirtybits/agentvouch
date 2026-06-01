import path from "node:path";
import { CliError } from "./errors.js";
import { AgentVouchApiClient } from "./http.js";
import { installSkill } from "./install.js";
import {
  getInstallMetadataPath,
  readInstalledSkillMetadata,
} from "./metadata.js";

export interface UpdateSkillInput {
  file: string;
  id?: string;
  keypairPath?: string;
  dryRun?: boolean;
  baseUrl: string;
  rpcUrl: string;
}

export interface UpdateSkillResult {
  ok: true;
  action: "noop" | "update" | "adopt";
  skillId: string;
  outputPath: string;
  metadataPath: string;
  installedVersion: number | null;
  latestVersion: number;
  listingAddress: string | null;
  listingChanged: boolean;
  requiresPurchase: boolean;
  dryRun: boolean;
  mode?: string;
  purchaseTx?: string;
}

export async function updateSkill(
  input: UpdateSkillInput
): Promise<UpdateSkillResult> {
  const outputPath = path.resolve(input.file);
  const metadataPath = getInstallMetadataPath(outputPath);
  const metadata = await readInstalledSkillMetadata(outputPath);

  if (metadata && input.id && input.id !== metadata.skill_id) {
    throw new CliError(
      `Local install metadata points to ${metadata.skill_id}, but --id was ${input.id}.`
    );
  }

  const skillId = metadata?.skill_id ?? input.id;
  if (!skillId) {
    throw new CliError(
      `No install metadata found for ${outputPath}. Re-run with --id <repo-skill-uuid> to adopt a legacy install.`
    );
  }

  if ((metadata?.source ?? "repo") === "chain" || skillId.startsWith("chain-")) {
    throw new CliError(
      "Version-aware updates are only supported for repo-backed skills."
    );
  }

  const api = new AgentVouchApiClient(input.baseUrl);
  const check = await api.checkSkillUpdate(skillId, {
    installedVersion: metadata?.installed_version,
    source: metadata?.source ?? "repo",
    listing: metadata?.on_chain_address ?? null,
  });

  const needsRefresh =
    check.status !== "up_to_date" || check.listing_changed || !metadata;

  if (!needsRefresh) {
    return {
      ok: true,
      action: "noop",
      skillId,
      outputPath,
      metadataPath,
      installedVersion: check.installed_version,
      latestVersion: check.latest_version,
      listingAddress: check.on_chain_address,
      listingChanged: check.listing_changed,
      requiresPurchase: check.requires_purchase,
      dryRun: !!input.dryRun,
    };
  }

  if (input.dryRun) {
    return {
      ok: true,
      action: metadata ? "update" : "adopt",
      skillId,
      outputPath,
      metadataPath,
      installedVersion: check.installed_version,
      latestVersion: check.latest_version,
      listingAddress: check.on_chain_address,
      listingChanged: check.listing_changed,
      requiresPurchase: check.requires_purchase,
      dryRun: true,
    };
  }

  const installResult = await installSkill({
    id: skillId,
    out: outputPath,
    force: true,
    dryRun: false,
    tree: metadata?.installed_format === "tree",
    keypairPath: input.keypairPath,
    baseUrl: input.baseUrl,
    rpcUrl: input.rpcUrl,
  });

  return {
    ok: true,
    action: metadata ? "update" : "adopt",
    skillId,
    outputPath,
    metadataPath: installResult.metadataPath,
    installedVersion: check.installed_version,
    latestVersion: check.latest_version,
    listingAddress: check.on_chain_address,
    listingChanged: check.listing_changed,
    requiresPurchase: check.requires_purchase,
    dryRun: false,
    mode: installResult.mode,
    // installSkill yields string | null; UpdateResult.purchaseTx is optional
    // string. Normalize the "no purchase" case (null -> undefined).
    purchaseTx: installResult.purchaseTx ?? undefined,
  };
}
