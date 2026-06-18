// Mirror sync engine. For each configured source it discovers permissively
// licensed skills and reconciles them against AgentVouch listings:
//   - not listed yet            → create (version 1)
//   - listed, tree hash changed → publish a new version
//   - listed, tree hash same    → skip (no work)
//
// All writes go straight to the DB + blob storage using the same helpers as
// POST /api/skills and POST /api/skills/[id]/versions. We bypass those HTTP
// routes deliberately: they require a wallet signature from the skill author,
// which a synthetic GitHub mirror identity (e.g. github:76263028) cannot
// provide. Change detection compares the upstream tree hash against the latest
// stored skill_versions.tree_hash, so no extra bookkeeping table is needed.

import { randomUUID } from "crypto";
import { sql } from "@/lib/db";
import {
  prepareSkillTree,
  putSkillTree,
  type SkillTreeInputFile,
} from "@/lib/skillStorage";
import { pinSkillContent } from "@/lib/ipfs";
import { buildUniquePublicSkillRoute } from "@/lib/skillRouteResolver";
import { getConfiguredSolanaChainContext } from "@/lib/chains";
import { runReviewSafe } from "@/lib/ai/review";
import {
  normalizeSkillName,
  normalizeSkillDescription,
  normalizeSkillContact,
} from "@/lib/skillDraft";
import {
  getMirrorSources,
  publisherIdentityKey,
  sourceRepoUrl,
  type MirrorSource,
} from "@/lib/mirror/sources";
import {
  classifyLicense,
  discoverSkills,
  fetchRepoTree,
  fetchSkillFiles,
  humanizeSkillName,
  parseFrontmatter,
} from "@/lib/mirror/github";

export type SyncAction =
  | "create"
  | "update"
  | "unchanged"
  | "skip"
  | "error";

export type SkillOutcome = {
  source: string;
  skillId: string;
  action: SyncAction;
  detail?: string;
  name?: string;
  version?: number;
  license?: string | null;
  treeBytes?: number;
  route?: string;
};

export type SyncOptions = {
  /** When false, no DB/blob writes occur (dry run). */
  apply: boolean;
  /** Restrict to specific source keys (e.g. ["anthropic"]). */
  sourceKeys?: string[];
  /** Skip AI summary/scan generation. */
  skipReview?: boolean;
  /** Progress logger. */
  log?: (message: string) => void;
};

export type SyncResult = {
  outcomes: SkillOutcome[];
  counts: Record<SyncAction, number>;
};

function emptyCounts(): Record<SyncAction, number> {
  return { create: 0, update: 0, unchanged: 0, skip: 0, error: 0 };
}

async function findExistingListing(
  identityKey: string,
  skillId: string
): Promise<{ id: string; current_version: number } | null> {
  const rows = await sql()<{ id: string; current_version: number }>`
    SELECT id, current_version FROM skills
    WHERE publisher_identity_key = ${identityKey} AND skill_id = ${skillId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function latestTreeHash(skillDbId: string): Promise<string | null> {
  const rows = await sql()<{ tree_hash: string | null }>`
    SELECT tree_hash FROM skill_versions
    WHERE skill_id = ${skillDbId}::uuid
    ORDER BY version DESC
    LIMIT 1
  `;
  return rows[0]?.tree_hash ?? null;
}

type SkillMeta = {
  source: MirrorSource;
  skillId: string;
  name: string;
  description: string;
  contact: string;
  tags: string[];
  content: string;
};

function buildMeta(
  source: MirrorSource,
  dir: string,
  skillId: string,
  files: SkillTreeInputFile[],
  licenseTag: string | null
): SkillMeta {
  const skillMd = files.find((f) => f.path === "SKILL.md");
  const content = skillMd
    ? Buffer.isBuffer(skillMd.content)
      ? skillMd.content.toString("utf8")
      : String(skillMd.content)
    : "";
  const fm = parseFrontmatter(content);
  const tags = Array.from(
    new Set([...source.tags, ...(licenseTag ? [licenseTag] : [])])
  );
  // Upstream `name` is usually the slug; humanize it for display. Honor a
  // frontmatter name only when it already reads as a title (has a space or caps).
  const rawName = fm.name.trim();
  const displayName =
    rawName && /[ A-Z]/.test(rawName) ? rawName : humanizeSkillName(skillId);
  return {
    source,
    skillId,
    name: normalizeSkillName(displayName),
    description: normalizeSkillDescription(fm.description || ""),
    contact: normalizeSkillContact(
      `${sourceRepoUrl(source)}/tree/${source.branch}/${dir}`
    ),
    tags,
    content,
  };
}

async function createListing(
  meta: SkillMeta,
  files: SkillTreeInputFile[],
  skipReview: boolean
): Promise<string> {
  const idKey = publisherIdentityKey(meta.source);
  const skillDbId = randomUUID();
  const { publicAuthorSlug, publicSlug } = await buildUniquePublicSkillRoute(
    sql(),
    {
      id: skillDbId,
      skill_id: meta.skillId,
      author_handle: meta.source.handle,
      author_pubkey: null,
      publisher_identity_key: idKey,
    }
  );

  const tree = await putSkillTree(files);
  const pin = await pinSkillContent(meta.content, meta.skillId, 1);
  const chainContext = getConfiguredSolanaChainContext();

  await sql()`
    INSERT INTO skills (
      id, skill_id, public_slug, public_author_slug,
      author_pubkey, author_kind, author_external_id, author_handle,
      author_display_name, publisher_identity_key, publisher_tier,
      name, description, tags, current_version, ipfs_cid, contact,
      chain_context, price_usdc_micros, currency_mint
    ) VALUES (
      ${skillDbId}::uuid, ${meta.skillId}, ${publicSlug}, ${publicAuthorSlug},
      ${null}, ${"github"}, ${meta.source.githubId}, ${meta.source.handle},
      ${meta.source.displayName}, ${idKey}, ${"unverified"},
      ${meta.name}, ${meta.description || null}, ${meta.tags}::text[], 1,
      ${pin.success ? pin.cid : null}, ${meta.contact || null},
      ${chainContext}, ${null}, ${null}
    )
  `;

  await sql()`
    INSERT INTO skill_versions (
      skill_id, version, content, ipfs_cid, changelog,
      files, tree_hash, storage_backend, has_executable
    ) VALUES (
      ${skillDbId}::uuid, 1, ${meta.content},
      ${pin.success ? pin.cid : null},
      ${`Mirrored from ${meta.source.owner}/${meta.source.repo}`},
      ${JSON.stringify(tree.manifest)}::jsonb, ${tree.treeHash},
      ${tree.backend}, ${tree.hasExecutable}
    )
  `;

  if (!skipReview) {
    await runReviewSafe({
      skillId: skillDbId,
      content: meta.content,
      treeHash: tree.treeHash,
      files: tree.filesWithBytes,
      expectedVersion: 1,
    });
  }

  return `${publicAuthorSlug}/${publicSlug}`;
}

async function publishNewVersion(
  meta: SkillMeta,
  existing: { id: string; current_version: number },
  files: SkillTreeInputFile[],
  skipReview: boolean
): Promise<number> {
  const newVersion = existing.current_version + 1;
  const tree = await putSkillTree(files);
  const pin = await pinSkillContent(meta.content, meta.skillId, newVersion);

  await sql()`
    INSERT INTO skill_versions (
      skill_id, version, content, ipfs_cid, changelog,
      files, tree_hash, storage_backend, has_executable
    ) VALUES (
      ${existing.id}::uuid, ${newVersion}, ${meta.content},
      ${pin.success ? pin.cid : null},
      ${`Synced from ${meta.source.owner}/${meta.source.repo}`},
      ${JSON.stringify(tree.manifest)}::jsonb, ${tree.treeHash},
      ${tree.backend}, ${tree.hasExecutable}
    )
  `;

  // Refresh listing metadata from upstream alongside the version bump.
  await sql()`
    UPDATE skills
    SET current_version = ${newVersion},
        name = ${meta.name},
        description = ${meta.description || null},
        tags = ${meta.tags}::text[],
        contact = ${meta.contact || null},
        ipfs_cid = ${pin.success ? pin.cid : null},
        updated_at = NOW()
    WHERE id = ${existing.id}::uuid
  `;

  if (!skipReview) {
    await runReviewSafe({
      skillId: existing.id,
      content: meta.content,
      treeHash: tree.treeHash,
      files: tree.filesWithBytes,
      expectedVersion: newVersion,
    });
  }

  return newVersion;
}

export async function syncMirrorSkills(
  opts: SyncOptions
): Promise<SyncResult> {
  const log = opts.log ?? (() => {});
  const sources = getMirrorSources(opts.sourceKeys);
  const outcomes: SkillOutcome[] = [];

  for (const source of sources) {
    log(
      `\n[${source.key}] ${source.owner}/${source.repo}@${source.branch}` +
        ` as github:${source.handle}`
    );
    let discovered;
    try {
      const tree = await fetchRepoTree(source);
      discovered = discoverSkills(tree, source);
    } catch (error) {
      log(`  ! tree fetch failed: ${(error as Error).message}`);
      outcomes.push({
        source: source.key,
        skillId: "(repo)",
        action: "error",
        detail: (error as Error).message,
      });
      continue;
    }
    log(`  discovered ${discovered.length} skill dir(s)`);

    const idKey = publisherIdentityKey(source);

    for (const skill of discovered) {
      const outcome: SkillOutcome = {
        source: source.key,
        skillId: skill.skillId,
        action: "skip",
      };
      try {
        const files = await fetchSkillFiles(source, skill);
        const license = classifyLicense(files);
        outcome.license = license.tag;
        if (!license.permissive) {
          outcome.action = "skip";
          outcome.detail = `non-permissive license (${license.tag ?? "none"})`;
          outcomes.push(outcome);
          log(`  - ${skill.skillId}: skip (${outcome.detail})`);
          continue;
        }

        // Validates against tree caps and yields the canonical tree hash.
        const tree = prepareSkillTree(files);
        outcome.treeBytes = tree.manifest.reduce((s, f) => s + f.size, 0);
        const meta = buildMeta(source, skill.dir, skill.skillId, files, license.tag);
        outcome.name = meta.name;

        const existing = await findExistingListing(idKey, skill.skillId);
        if (!existing) {
          if (opts.apply) {
            outcome.route = await createListing(meta, files, !!opts.skipReview);
            outcome.version = 1;
          }
          outcome.action = "create";
          log(`  + ${skill.skillId}: create${opts.apply ? " ✓" : ""}`);
        } else {
          const prevHash = await latestTreeHash(existing.id);
          if (prevHash === tree.treeHash) {
            outcome.action = "unchanged";
            outcome.version = existing.current_version;
            log(`  = ${skill.skillId}: unchanged (v${existing.current_version})`);
          } else {
            if (opts.apply) {
              outcome.version = await publishNewVersion(
                meta,
                existing,
                files,
                !!opts.skipReview
              );
            } else {
              outcome.version = existing.current_version + 1;
            }
            outcome.action = "update";
            log(
              `  ^ ${skill.skillId}: update → v${outcome.version}${
                opts.apply ? " ✓" : ""
              }`
            );
          }
        }
      } catch (error) {
        const message = (error as Error).message;
        // Tree cap violations (too many files / too large) are deterministic,
        // expected exclusions — not failures. Treat them as skips so the daily
        // cron stays clean instead of reporting an error every run.
        if (/exceeds cap of/i.test(message)) {
          outcome.action = "skip";
          outcome.detail = `exceeds marketplace cap: ${message}`;
          log(`  - ${skill.skillId}: skip (${message})`);
        } else {
          outcome.action = "error";
          outcome.detail = message;
          log(`  ! ${skill.skillId}: error ${message}`);
        }
      }
      outcomes.push(outcome);
    }
  }

  const counts = emptyCounts();
  for (const o of outcomes) counts[o.action] += 1;
  return { outcomes, counts };
}
