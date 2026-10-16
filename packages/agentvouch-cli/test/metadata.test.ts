import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildInstalledSkillMetadata,
  getInstallMetadataPath,
  readInstalledSkillMetadata,
  writeInstalledSkillMetadata,
  type InstalledSkillMetadata,
} from "../src/lib/metadata.js";
import type { SkillRecord } from "../src/lib/http.js";

let tempDir = "";

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    tempDir = "";
  }
});

async function setTempDir(): Promise<void> {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "agentvouch-meta-"));
}

// Writes a raw metadata JSON object directly to <skillPath>.agentvouch.json.
// Raw writes sidestep the InstalledSkillMetadata literal-union constraints
// (e.g. source: "unknown") while still modeling what the validator reads off disk.
async function writeRawMetadata(
  skillPath: string,
  obj: Record<string, unknown>
): Promise<void> {
  await writeFile(`${skillPath}.agentvouch.json`, JSON.stringify(obj, null, 2));
}

function baseSkill(): SkillRecord {
  return {
    id: "595f5534-07ae-4839-a45a-b6858ab731fe",
    skill_id: "calendar-agent",
    author_pubkey: "5QcQJk7fZ6f8u3x4Q5vQ2p2rQ9rT1vU2wX3yZ4aBcDeF",
    name: "Calendar Agent",
    description: "Manages events.",
    on_chain_address: "MockListingProgramAddress",
    price_lamports: 25000000,
    price_usdc_micros: null,
    currency_mint: null,
    current_version: 3,
    source: "chain",
    tree_hash: "tree-hash",
    total_installs: 12,
  };
}

const validMeta: InstalledSkillMetadata = {
  schema_version: 1,
  installed_with: "agentvouch-cli",
  skill_id: "abc",
  source: "repo",
  installed_version: 1,
  installed_format: "file",
  on_chain_address: null,
  skill_slug: "calendar-agent",
  author_pubkey: null,
  author_kind: null,
  author_handle: null,
  publisher_tier: null,
  tree_hash: null,
  historical_sol_price_base_units: 0,
  price_usdc_micros: null,
  currency_mint: null,
  installed_at: "2024-01-01T00:00:00.000Z",
};

describe("getInstallMetadataPath", () => {
  it("appends the .agentvouch.json suffix to the skill file path", () => {
    expect(getInstallMetadataPath("/skills/SKILL.md")).toBe(
      "/skills/SKILL.md.agentvouch.json"
    );
    expect(getInstallMetadataPath("calendar-agent/SKILL.md")).toBe(
      "calendar-agent/SKILL.md.agentvouch.json"
    );
    expect(getInstallMetadataPath("SKILL.md")).toBe("SKILL.md.agentvouch.json");
  });
});

describe("buildInstalledSkillMetadata", () => {
  it("maps chain-sourced skills with their price and identity fields", () => {
    const meta = buildInstalledSkillMetadata(
      "595f5534-07ae-4839-a45a-b6858ab731fe",
      baseSkill()
    );

    expect(meta).toMatchObject({
      schema_version: 1,
      installed_with: "agentvouch-cli",
      skill_id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      source: "chain",
      installed_version: 3,
      installed_format: "file",
      on_chain_address: "MockListingProgramAddress",
      skill_slug: "calendar-agent",
      author_pubkey: "5QcQJk7fZ6f8u3x4Q5vQ2p2rQ9rT1vU2wX3yZ4aBcDeF",
      historical_sol_price_base_units: 25000000,
      tree_hash: "tree-hash",
    });
  });

  it("records repo-sourced skills and defaults missing price fields", () => {
    const repoSkill: SkillRecord = {
      ...baseSkill(),
      source: "repo",
      on_chain_address: null,
      price_lamports: undefined,
      price_usdc_micros: "10000",
      currency_mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      current_version: undefined,
      tree_hash: undefined,
    };
    const meta = buildInstalledSkillMetadata("abc", repoSkill);

    expect(meta.source).toBe("repo");
    expect(meta.installed_version).toBe(1);
    expect(meta.on_chain_address).toBeNull();
    expect(meta.historical_sol_price_base_units).toBe(0);
    expect(meta.price_usdc_micros).toBe("10000");
    expect(meta.currency_mint).toBe(
      "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
    );
  });

  it("records tree installs and preserves explicit optional identity fields", () => {
    const meta = buildInstalledSkillMetadata(
      "abc",
      {
        ...baseSkill(),
        source: "repo",
        author_kind: "github",
        author_handle: "dirtybits",
        publisher_tier: "registered",
      } as SkillRecord,
      { installedFormat: "tree" }
    );

    expect(meta.installed_format).toBe("tree");
    expect(meta.author_kind).toBe("github");
    expect(meta.author_handle).toBe("dirtybits");
    expect(meta.publisher_tier).toBe("registered");
  });
});

describe("writeInstalledSkillMetadata", () => {
  it("writes pretty JSON with a trailing newline to the derived path", async () => {
    await setTempDir();
    const skillPath = path.join(tempDir, "SKILL.md");
    const written = await writeInstalledSkillMetadata(skillPath, validMeta);

    expect(written).toBe(`${skillPath}.agentvouch.json`);
    const raw = await readFile(written, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(raw) as InstalledSkillMetadata;
    expect(parsed.skill_id).toBe("abc");
    expect(parsed.schema_version).toBe(1);
  });
});

describe("readInstalledSkillMetadata", () => {
  it("returns null when the metadata file does not exist", async () => {
    await setTempDir();
    expect(
      await readInstalledSkillMetadata(path.join(tempDir, "SKILL.md"))
    ).toBeNull();
  });

  it("returns the parsed metadata for a valid file", async () => {
    await setTempDir();
    const skillPath = path.join(tempDir, "SKILL.md");
    await writeInstalledSkillMetadata(skillPath, validMeta);

    const loaded = await readInstalledSkillMetadata(skillPath);
    expect(loaded).not.toBeNull();
    expect(loaded?.skill_id).toBe("abc");
    expect(loaded?.installed_with).toBe("agentvouch-cli");
    expect(loaded?.installed_version).toBe(1);
  });

  it("accepts a legacy file that stores price only under the price_lamports alias", async () => {
    await setTempDir();
    const skillPath = path.join(tempDir, "SKILL.md");
    await writeRawMetadata(skillPath, {
      ...validMeta,
      skill_id: "abc",
      price_lamports: 25000000,
      historical_sol_price_base_units: undefined,
    });

    const loaded = await readInstalledSkillMetadata(skillPath);
    expect(loaded).not.toBeNull();
    expect(loaded?.skill_id).toBe("abc");
  });

  it("rejects malformed JSON with a not-valid-JSON message", async () => {
    await setTempDir();
    const skillPath = path.join(tempDir, "SKILL.md");
    await writeFile(`${skillPath}.agentvouch.json`, "{ not valid json");

    await expect(readInstalledSkillMetadata(skillPath)).rejects.toThrow(
      "is not valid JSON"
    );
  });

  it("rejects metadata with the wrong schema version", async () => {
    await setTempDir();
    const skillPath = path.join(tempDir, "SKILL.md");
    await writeRawMetadata(skillPath, { ...validMeta, schema_version: 2 });

    await expect(readInstalledSkillMetadata(skillPath)).rejects.toThrow(
      "Install metadata"
    );
  });

  it("rejects metadata with a non-agentvouch installed_with", async () => {
    await setTempDir();
    const skillPath = path.join(tempDir, "SKILL.md");
    await writeRawMetadata(skillPath, {
      ...validMeta,
      installed_with: "other-tool",
    });

    await expect(readInstalledSkillMetadata(skillPath)).rejects.toThrow(
      "Install metadata"
    );
  });

  it("rejects metadata with a missing or non-string skill_id", async () => {
    await setTempDir();
    const skillPath = path.join(tempDir, "SKILL.md");
    await writeRawMetadata(skillPath, { ...validMeta, skill_id: null });

    await expect(readInstalledSkillMetadata(skillPath)).rejects.toThrow(
      "Install metadata"
    );
  });

  it("rejects metadata with an unrecognized source", async () => {
    await setTempDir();
    const skillPath = path.join(tempDir, "SKILL.md");
    await writeRawMetadata(skillPath, { ...validMeta, source: "unknown" });

    await expect(readInstalledSkillMetadata(skillPath)).rejects.toThrow(
      "Install metadata"
    );
  });

  it("rejects metadata missing the installed_at field", async () => {
    await setTempDir();
    const skillPath = path.join(tempDir, "SKILL.md");
    const { installed_at: _ignored, ...rest } = validMeta;
    await writeRawMetadata(skillPath, rest);

    await expect(readInstalledSkillMetadata(skillPath)).rejects.toThrow(
      "Install metadata"
    );
  });

  it("rejects a non-object JSON body instead of returning null", async () => {
    await setTempDir();
    const skillPath = path.join(tempDir, "SKILL.md");
    await writeFile(`${skillPath}.agentvouch.json`, "not-an-object");

    await expect(readInstalledSkillMetadata(skillPath)).rejects.toThrow(
      "Install metadata"
    );
  });
});
