import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliError } from "../src/lib/errors.js";
import type { SkillRecord } from "../src/lib/http.js";
import {
  getInstallMetadataPath,
  readInstalledSkillMetadata,
  writeInstalledSkillMetadata,
  buildInstalledSkillMetadata,
} from "../src/lib/metadata.js";

describe("getInstallMetadataPath", () => {
  it("appends the .agentvouch.json metadata sidecar name", () => {
    expect(getInstallMetadataPath("SKILL.md")).toBe("SKILL.md.agentvouch.json");
    expect(getInstallMetadataPath("/home/user/skills/agent/SKILL.md")).toBe(
      "/home/user/skills/agent/SKILL.md.agentvouch.json"
    );
  });
});

function makeSkill(): SkillRecord {
  return {
    id: "595f5534-07ae-4839-a45a-b6858ab731fe",
    skill_id: "calendar-agent",
    author_pubkey: "11111111111111111111111111111111",
    name: "Calendar Agent",
    description: "A free test skill",
    on_chain_address: null,
    total_installs: 1,
    source: "repo",
    current_version: 3,
    tree_hash: null,
    price_lamports: 1000000,
    price_usdc_micros: "1000000",
    currency_mint: null,
  };
}

describe("buildInstalledSkillMetadata", () => {
  it("maps a repo-backed record, preserving source, version, and price fields", () => {
    const meta = buildInstalledSkillMetadata("595f5534", makeSkill(), {});
    expect(meta.schema_version).toBe(1);
    expect(meta.installed_with).toBe("agentvouch-cli");
    expect(meta.skill_id).toBe("595f5534");
    expect(meta.source).toBe("repo");
    expect(meta.installed_version).toBe(3);
    expect(meta.installed_format).toBe("file");
    expect(meta.skill_slug).toBe("calendar-agent");
    expect(meta.on_chain_address).toBe(null);
    expect(meta.historical_sol_price_base_units).toBe(1000000);
    expect(meta.price_usdc_micros).toBe("1000000");
    expect(meta.installed_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
  });

  it("honors the installed_format option and defaults to file when omitted", () => {
    const file = buildInstalledSkillMetadata("id", makeSkill(), {});
    expect(file.installed_format).toBe("file");
    const tree = buildInstalledSkillMetadata("id", makeSkill(), {
      installedFormat: "tree",
    });
    expect(tree.installed_format).toBe("tree");
  });

  it("reports a chain source and fills defaults for missing version/price fields", () => {
    const chainSkill = makeSkill();
    chainSkill.source = "chain";
    chainSkill.on_chain_address = "ACMEskillAddressOnChainProgram";
    chainSkill.current_version = undefined;
    chainSkill.price_lamports = undefined;
    const meta = buildInstalledSkillMetadata("chain-id", chainSkill, {});
    expect(meta.source).toBe("chain");
    expect(meta.installed_version).toBe(1);
    expect(meta.historical_sol_price_base_units).toBe(0);
    expect(meta.on_chain_address).toBe("ACMEskillAddressOnChainProgram");
  });
});

describe("writeInstalledSkillMetadata / readInstalledSkillMetadata", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "agentvouch-cli-metad-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it("round-trips the built metadata back through the sidecar file", async () => {
    const meta = buildInstalledSkillMetadata("skill-id", makeSkill(), {});
    const skillFile = path.join(tempDir, "SKILL.md");
    const metaPath = await writeInstalledSkillMetadata(skillFile, meta);
    expect(metaPath).toBe(`${skillFile}.agentvouch.json`);

    const raw = await readFile(metaPath, "utf8");
    expect(raw).toBe(`${JSON.stringify(meta, null, 2)}\n`);
    const read = await readInstalledSkillMetadata(skillFile);
    expect(read).toMatchObject({
      skill_id: "skill-id",
      installed_version: 3,
      source: "repo",
      skill_slug: "calendar-agent",
    });
  });

  it("returns null when the sidecar file does not exist yet", async () => {
    const skillFile = path.join(tempDir, "SKILL.md");
    await writeFile(skillFile, "# skill\n");
    expect(await readInstalledSkillMetadata(skillFile)).toBeNull();
  });

  it("throws CliError when the sidecar file is not valid JSON", async () => {
    const skillFile = path.join(tempDir, "SKILL.md");
    await writeFile(`${skillFile}.agentvouch.json`, "{ not json");
    await expect(readInstalledSkillMetadata(skillFile)).rejects.toThrowError(
      /Reinstall the skill or rerun update with --id/
    );
  });

  it("throws CliError when the sidecar JSON is not install metadata", async () => {
    const skillFile = path.join(tempDir, "SKILL.md");
    await writeFile(
      `${skillFile}.agentvouch.json`,
      JSON.stringify({ schema_version: 1, note: "not metadata" })
    );
    await expect(readInstalledSkillMetadata(skillFile)).rejects.toThrowError(
      /Install metadata at/
    );
  });

  it("rejects an object whose schema_version or source is invalid", async () => {
    const skillFile = path.join(tempDir, "SKILL.md");
    const validBase = {
      schema_version: 1,
      installed_with: "agentvouch-cli",
      skill_id: "x",
      installed_version: 1,
      skill_slug: "x",
      author_pubkey: null,
      installed_at: "2026-01-01T00:00:00.000Z",
      on_chain_address: null,
    };
    await writeFile(
      `${skillFile}.agentvouch.json`,
      JSON.stringify({ ...validBase, schema_version: 2, source: "repo" })
    );
    await expect(readInstalledSkillMetadata(skillFile)).rejects.toThrowError(
      /Install metadata at/
    );

    await writeFile(
      `${skillFile}.agentvouch.json`,
      JSON.stringify({
        ...validBase,
        source: "unknown-source",
        schema_version: 1,
      })
    );
    await expect(readInstalledSkillMetadata(skillFile)).rejects.toThrowError(
      /Install metadata at/
    );
  });

  it("accepts a legacy file that still uses the price_lamports alias", async () => {
    const skillFile = path.join(tempDir, "SKILL.md");
    await writeFile(
      `${skillFile}.agentvouch.json`,
      JSON.stringify({
        schema_version: 1,
        installed_with: "agentvouch-cli",
        skill_id: "legacy",
        source: "repo",
        installed_version: 1,
        skill_slug: "legacy",
        author_pubkey: null,
        price_lamports: 500000,
        installed_at: "2026-01-01T00:00:00.000Z",
        on_chain_address: null,
      })
    );
    const meta = await readInstalledSkillMetadata(skillFile);
    expect(meta).not.toBeNull();
    if (!meta) throw new Error("expected metadata to be present");
    expect(meta.skill_id).toBe("legacy");
    const stored =
      (meta as any).price_lamports ??
      (meta as any).historical_sol_price_base_units;
    expect(stored).toBe(500000);
  });
});
