// Mirror / connect sync engine. Reconciles skills discovered in a GitHub repo
// against AgentVouch listings:
//   - not listed yet            → create (version 1)
//   - listed, tree hash changed → publish a new version
//   - listed, tree hash same    → skip (no work)
//
// Two attribution modes share this engine:
//   - github (community mirror): third-party OSS repos (Anthropic, OpenAI),
//     attributed to a synthetic GitHub identity, license-gated, "Mirror"-labeled.
//   - wallet (connected repo): a wallet's OWN repo (see lib/mirror/connectedRepos),
//     attributed to that wallet, license gate bypassed (owner-authorized), tags
//     preserved on update, and any existing PAID/on-chain listing left untouched.
//
// All writes go straight to the DB + blob storage using the same helpers as
// POST /api/skills and POST /api/skills/[id]/versions — bypassing those HTTP
// routes deliberately (a synthetic GitHub identity has no wallet to sign, and a
// connected sync runs unattended after the wallet authorized the connection).
// Change detection compares the upstream tree hash against the latest stored
// skill_versions.tree_hash, so no per-skill bookkeeping is needed.

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
import { verifyAuthorTrust } from "@/lib/trust";
import {
  normalizeSkillName,
  normalizeSkillDescription,
  normalizeSkillContact,
} from "@/lib/skillDraft";
import { getMirrorSources, type MirrorSource } from "@/lib/mirror/sources";
import {
  classifyLicense,
  discoverSkills,
  fetchRepoTree,
  fetchSkillFiles,
  humanizeSkillName,
  parseFrontmatter,
  resolveRepoRef,
  type LicenseClassification,
} from "@/lib/mirror/github";
import {
  listActiveConnectedRepos,
  updateConnectedRepoSyncState,
  type ConnectedRepo,
} from "@/lib/mirror/connectedRepos";

export type SyncAction = "create" | "update" | "unchanged" | "skip" | "error";

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
  /** Restrict community mirror to specific source keys (e.g. ["anthropic"]). */
  sourceKeys?: string[];
  /** Skip AI summary/scan generation. */
  skipReview?: boolean;
  /** Limit to a single skill id (across the selected sources). */
  onlySkillId?: string;
  /** Progress logger. */
  log?: (message: string) => void;
};

export type SyncResult = {
  outcomes: SkillOutcome[];
  counts: Record<SyncAction, number>;
};

// Attribution decides whose identity a listing belongs to.
type Attribution =
  | {
      kind: "github";
      githubId: string;
      handle: string;
      displayName: string;
      mirrorSourceKey: string;
    }
  | { kind: "wallet"; walletPubkey: string };

function idKeyFor(attr: Attribution): string {
  return attr.kind === "github"
    ? `github:${attr.githubId}`
    : `wallet:${attr.walletPubkey}`;
}

// Everything the engine needs to sync one repo under one attribution.
type SyncContext = {
  label: string;
  owner: string;
  repo: string;
  branch: string;
  includePathPrefixes: string[];
  attribution: Attribution;
  baseTags: string[];
  /** Enforce the permissive-OSS license allowlist (community only). */
  licenseGate: boolean;
  /** Leave existing paid / on-chain listings untouched (connected only). */
  skipPaidOnReconcile: boolean;
  /** Overwrite tags from the repo on update (community) vs preserve (connected). */
  updateTagsOnSync: boolean;
};

function communityContext(source: MirrorSource): SyncContext {
  return {
    label: source.key,
    owner: source.owner,
    repo: source.repo,
    branch: source.branch,
    includePathPrefixes: source.includePathPrefixes,
    attribution: {
      kind: "github",
      githubId: source.githubId,
      handle: source.handle,
      displayName: source.displayName,
      mirrorSourceKey: source.key,
    },
    baseTags: source.tags,
    licenseGate: true,
    skipPaidOnReconcile: false,
    updateTagsOnSync: true,
  };
}

function connectedContext(repo: ConnectedRepo): SyncContext {
  return {
    label: `connect:${repo.github_owner}/${repo.github_repo}`,
    owner: repo.github_owner,
    repo: repo.github_repo,
    branch: repo.branch,
    includePathPrefixes: repo.include_paths ?? [],
    attribution: { kind: "wallet", walletPubkey: repo.owner_wallet },
    baseTags: [],
    licenseGate: false,
    skipPaidOnReconcile: true,
    updateTagsOnSync: false,
  };
}

function emptyCounts(): Record<SyncAction, number> {
  return { create: 0, update: 0, unchanged: 0, skip: 0, error: 0 };
}

function toResult(outcomes: SkillOutcome[]): SyncResult {
  const counts = emptyCounts();
  for (const o of outcomes) counts[o.action] += 1;
  return { outcomes, counts };
}

type ExistingListing = {
  id: string;
  current_version: number;
  price_usdc_micros: string | null;
  on_chain_address: string | null;
};

async function findExistingListing(
  identityKey: string,
  skillId: string
): Promise<ExistingListing | null> {
  const rows = await sql()<ExistingListing>`
    SELECT id, current_version, price_usdc_micros, on_chain_address
    FROM skills
    WHERE publisher_identity_key = ${identityKey} AND skill_id = ${skillId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

function isPaidOrOnChain(existing: ExistingListing): boolean {
  if (existing.on_chain_address) return true;
  if (existing.price_usdc_micros) {
    try {
      return BigInt(existing.price_usdc_micros) > 0n;
    } catch {
      return false;
    }
  }
  return false;
}

async function markExistingMirrorListing(
  sourceKey: string,
  skillDbId: string
): Promise<void> {
  await sql()`
    UPDATE skills
    SET mirror_source_key = ${sourceKey},
        tags = array_remove(COALESCE(tags, ARRAY[]::text[]), 'mirror'),
        updated_at = NOW()
    WHERE id = ${skillDbId}::uuid
      AND (
        mirror_source_key IS DISTINCT FROM ${sourceKey}
        OR 'mirror' = ANY(COALESCE(tags, ARRAY[]::text[]))
      )
  `;
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
  skillId: string;
  name: string;
  description: string;
  contact: string;
  tags: string[];
  content: string;
};

function buildMeta(
  ctx: SyncContext,
  dir: string,
  skillId: string,
  files: SkillTreeInputFile[],
  license: LicenseClassification
): SkillMeta {
  const skillMd = files.find((f) => f.path === "SKILL.md");
  const content = skillMd
    ? Buffer.isBuffer(skillMd.content)
      ? skillMd.content.toString("utf8")
      : String(skillMd.content)
    : "";
  const fm = parseFrontmatter(content);
  const tags = Array.from(
    new Set([
      ...ctx.baseTags,
      ...(license.permissive && license.tag ? [license.tag] : []),
    ])
  ).filter((tag) => tag !== "mirror");
  // Upstream `name` is usually the slug; humanize it for display. Honor a
  // frontmatter name only when it already reads as a title (has a space or caps).
  const rawName = fm.name.trim();
  const displayName =
    rawName && /[ A-Z]/.test(rawName) ? rawName : humanizeSkillName(skillId);
  return {
    skillId,
    name: normalizeSkillName(displayName),
    description: normalizeSkillDescription(fm.description || ""),
    contact: normalizeSkillContact(
      `https://github.com/${ctx.owner}/${ctx.repo}/tree/${ctx.branch}/${dir}`
    ),
    tags,
    content,
  };
}

type AttributionColumns = {
  authorPubkey: string | null;
  authorKind: string;
  authorExternalId: string | null;
  authorHandle: string | null;
  authorDisplayName: string | null;
  publisherTier: string;
  mirrorSourceKey: string | null;
};

async function attributionColumns(
  attr: Attribution
): Promise<AttributionColumns> {
  if (attr.kind === "github") {
    return {
      authorPubkey: null,
      authorKind: "github",
      authorExternalId: attr.githubId,
      authorHandle: attr.handle,
      authorDisplayName: attr.displayName,
      publisherTier: "unverified",
      mirrorSourceKey: attr.mirrorSourceKey,
    };
  }
  let tier = "unverified";
  try {
    const trust = await verifyAuthorTrust(attr.walletPubkey);
    tier = trust.isRegistered ? "registered" : "unverified";
  } catch {
    // default unverified
  }
  return {
    authorPubkey: attr.walletPubkey,
    authorKind: "wallet",
    authorExternalId: null,
    authorHandle: null,
    authorDisplayName: null,
    publisherTier: tier,
    mirrorSourceKey: null,
  };
}

async function createListing(
  ctx: SyncContext,
  meta: SkillMeta,
  files: SkillTreeInputFile[],
  skipReview: boolean
): Promise<string> {
  const cols = await attributionColumns(ctx.attribution);
  const idKey = idKeyFor(ctx.attribution);
  const skillDbId = randomUUID();
  const { publicAuthorSlug, publicSlug } = await buildUniquePublicSkillRoute(
    sql(),
    {
      id: skillDbId,
      skill_id: meta.skillId,
      author_handle: cols.authorHandle,
      author_pubkey: cols.authorPubkey,
      publisher_identity_key: idKey,
    }
  );

  const tree = await putSkillTree(files);
  const pin = await pinSkillContent(meta.content, meta.skillId, 1);
  const chainContext = getConfiguredSolanaChainContext();
  const changelog =
    ctx.attribution.kind === "github"
      ? `Mirrored from ${ctx.owner}/${ctx.repo}`
      : `Synced from ${ctx.owner}/${ctx.repo}`;

  await sql()`
    WITH inserted_skill AS (
      INSERT INTO skills (
        id, skill_id, public_slug, public_author_slug,
        author_pubkey, author_kind, author_external_id, author_handle,
        author_display_name, publisher_identity_key, publisher_tier,
        mirror_source_key,
        name, description, tags, current_version, ipfs_cid, contact,
        chain_context, price_usdc_micros, currency_mint
      ) VALUES (
        ${skillDbId}::uuid, ${meta.skillId}, ${publicSlug}, ${publicAuthorSlug},
        ${cols.authorPubkey}, ${cols.authorKind}, ${cols.authorExternalId}, ${
    cols.authorHandle
  },
        ${cols.authorDisplayName}, ${idKey}, ${cols.publisherTier},
        ${cols.mirrorSourceKey},
        ${meta.name}, ${meta.description || null}, ${meta.tags}::text[], 1,
        ${pin.success ? pin.cid : null}, ${meta.contact || null},
        ${chainContext}, ${null}, ${null}
      )
      RETURNING id
    )
    INSERT INTO skill_versions (
      skill_id, version, content, ipfs_cid, changelog,
      files, tree_hash, storage_backend, has_executable
    )
    SELECT
      id, 1, ${meta.content},
      ${pin.success ? pin.cid : null},
      ${changelog},
      ${JSON.stringify(tree.manifest)}::jsonb, ${tree.treeHash},
      ${tree.backend}, ${tree.hasExecutable}
    FROM inserted_skill
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
  ctx: SyncContext,
  meta: SkillMeta,
  existing: ExistingListing,
  files: SkillTreeInputFile[],
  skipReview: boolean
): Promise<number> {
  const newVersion = existing.current_version + 1;
  const tree = await putSkillTree(files);
  const pin = await pinSkillContent(meta.content, meta.skillId, newVersion);
  const ipfsCid = pin.success ? pin.cid : null;
  const filesJson = JSON.stringify(tree.manifest);
  const changelog = `Synced from ${ctx.owner}/${ctx.repo}`;

  // Single-statement, optimistic-concurrency update: locked_skill matches only
  // when current_version is unchanged, so overlapping syncs throw and retry
  // cleanly instead of drifting version/CID. Community syncs refresh tags +
  // mirror_source_key; connected syncs preserve the author's tags/provenance.
  const rows = ctx.updateTagsOnSync
    ? await sql()<{ version: number }>`
        WITH locked_skill AS (
          SELECT id FROM skills
          WHERE id = ${existing.id}::uuid
            AND current_version = ${existing.current_version}
          FOR UPDATE
        ),
        inserted_version AS (
          INSERT INTO skill_versions (
            skill_id, version, content, ipfs_cid, changelog,
            files, tree_hash, storage_backend, has_executable
          )
          SELECT id, ${newVersion}, ${meta.content}, ${ipfsCid}, ${changelog},
            ${filesJson}::jsonb, ${tree.treeHash}, ${tree.backend}, ${
        tree.hasExecutable
      }
          FROM locked_skill
          RETURNING skill_id, version
        ),
        updated_skill AS (
          UPDATE skills s
          SET current_version = inserted_version.version,
              name = ${meta.name},
              description = ${meta.description || null},
              tags = ${meta.tags}::text[],
              contact = ${meta.contact || null},
              ipfs_cid = ${ipfsCid},
              mirror_source_key = ${
                ctx.attribution.kind === "github"
                  ? ctx.attribution.mirrorSourceKey
                  : null
              },
              updated_at = NOW()
          FROM inserted_version
          WHERE s.id = inserted_version.skill_id
          RETURNING s.current_version
        )
        SELECT current_version AS version FROM updated_skill
      `
    : await sql()<{ version: number }>`
        WITH locked_skill AS (
          SELECT id FROM skills
          WHERE id = ${existing.id}::uuid
            AND current_version = ${existing.current_version}
          FOR UPDATE
        ),
        inserted_version AS (
          INSERT INTO skill_versions (
            skill_id, version, content, ipfs_cid, changelog,
            files, tree_hash, storage_backend, has_executable
          )
          SELECT id, ${newVersion}, ${meta.content}, ${ipfsCid}, ${changelog},
            ${filesJson}::jsonb, ${tree.treeHash}, ${tree.backend}, ${
        tree.hasExecutable
      }
          FROM locked_skill
          RETURNING skill_id, version
        ),
        updated_skill AS (
          UPDATE skills s
          SET current_version = inserted_version.version,
              name = ${meta.name},
              description = ${meta.description || null},
              contact = ${meta.contact || null},
              ipfs_cid = ${ipfsCid},
              updated_at = NOW()
          FROM inserted_version
          WHERE s.id = inserted_version.skill_id
          RETURNING s.current_version
        )
        SELECT current_version AS version FROM updated_skill
      `;

  if (rows[0]?.version !== newVersion) {
    throw new Error(
      `Unable to publish synced version for ${existing.id}; listing changed concurrently`
    );
  }

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

async function reconcileSkill(
  ctx: SyncContext,
  skill: { skillId: string; dir: string; filePaths: string[] },
  commitSha: string,
  opts: SyncOptions
): Promise<SkillOutcome> {
  const outcome: SkillOutcome = {
    source: ctx.label,
    skillId: skill.skillId,
    action: "skip",
  };
  try {
    const files = await fetchSkillFiles(
      { owner: ctx.owner, repo: ctx.repo, branch: ctx.branch },
      skill,
      commitSha
    );
    const license = classifyLicense(files);
    outcome.license = license.tag;
    if (ctx.licenseGate && !license.permissive) {
      outcome.detail = `non-permissive license (${license.tag ?? "none"})`;
      return outcome;
    }

    const tree = prepareSkillTree(files);
    outcome.treeBytes = tree.manifest.reduce((s, f) => s + f.size, 0);
    const meta = buildMeta(ctx, skill.dir, skill.skillId, files, license);
    outcome.name = meta.name;

    const idKey = idKeyFor(ctx.attribution);
    const existing = await findExistingListing(idKey, skill.skillId);

    if (!existing) {
      if (opts.apply) {
        outcome.route = await createListing(
          ctx,
          meta,
          files,
          !!opts.skipReview
        );
        outcome.version = 1;
      }
      outcome.action = "create";
      return outcome;
    }

    if (ctx.skipPaidOnReconcile && isPaidOrOnChain(existing)) {
      outcome.action = "skip";
      outcome.detail = "paid/on-chain listing — not auto-synced";
      outcome.version = existing.current_version;
      return outcome;
    }

    if (opts.apply && ctx.attribution.kind === "github") {
      await markExistingMirrorListing(
        ctx.attribution.mirrorSourceKey,
        existing.id
      );
    }

    const prevHash = await latestTreeHash(existing.id);
    if (prevHash === tree.treeHash) {
      outcome.action = "unchanged";
      outcome.version = existing.current_version;
      return outcome;
    }

    outcome.version = opts.apply
      ? await publishNewVersion(ctx, meta, existing, files, !!opts.skipReview)
      : existing.current_version + 1;
    outcome.action = "update";
    return outcome;
  } catch (error) {
    const message = (error as Error).message;
    // Tree cap violations are deterministic, expected exclusions — not failures.
    if (/exceeds cap of/i.test(message)) {
      outcome.action = "skip";
      outcome.detail = `exceeds marketplace cap: ${message}`;
    } else {
      outcome.action = "error";
      outcome.detail = message;
    }
    return outcome;
  }
}

async function syncSource(
  ctx: SyncContext,
  opts: SyncOptions
): Promise<{ outcomes: SkillOutcome[]; commitSha: string | null }> {
  const log = opts.log ?? (() => {});
  const outcomes: SkillOutcome[] = [];
  let commitSha: string | null = null;
  try {
    const ref = await resolveRepoRef({
      owner: ctx.owner,
      repo: ctx.repo,
      branch: ctx.branch,
    });
    commitSha = ref.commitSha;
    const tree = await fetchRepoTree(
      { owner: ctx.owner, repo: ctx.repo, branch: ctx.branch },
      commitSha
    );
    const discovered = discoverSkills(tree, {
      includePathPrefixes: ctx.includePathPrefixes,
    });
    log(
      `  [${ctx.label}] pinned ${commitSha.slice(0, 12)} · ${
        discovered.length
      } skill(s)`
    );
    const mark: Record<SyncAction, string> = {
      create: "+",
      update: "^",
      unchanged: "=",
      skip: "-",
      error: "!",
    };
    for (const skill of discovered) {
      if (opts.onlySkillId && skill.skillId !== opts.onlySkillId) continue;
      const outcome = await reconcileSkill(ctx, skill, commitSha, opts);
      outcomes.push(outcome);
      log(
        `  ${mark[outcome.action]} ${skill.skillId}${
          outcome.detail ? ` (${outcome.detail})` : ""
        }`
      );
    }
  } catch (error) {
    log(`  ! ${ctx.label}: ${(error as Error).message}`);
    outcomes.push({
      source: ctx.label,
      skillId: "(repo)",
      action: "error",
      detail: (error as Error).message,
    });
  }
  return { outcomes, commitSha };
}

/** Sync the hardcoded community mirror sources (Anthropic, OpenAI). */
export async function syncMirrorSkills(opts: SyncOptions): Promise<SyncResult> {
  const log = opts.log ?? (() => {});
  const sources = getMirrorSources(opts.sourceKeys);
  const outcomes: SkillOutcome[] = [];
  for (const source of sources) {
    log(
      `\n[${source.key}] ${source.owner}/${source.repo}@${source.branch} as github:${source.handle}`
    );
    const { outcomes: sourceOutcomes } = await syncSource(
      communityContext(source),
      opts
    );
    outcomes.push(...sourceOutcomes);
  }
  return toResult(outcomes);
}

/** Sync one wallet-owned connected repo (attributed to the owner's wallet). */
export async function syncConnectedRepo(
  repo: ConnectedRepo,
  opts: SyncOptions
): Promise<SkillOutcome[]> {
  const log = opts.log ?? (() => {});
  log(
    `\n[connect] ${repo.github_owner}/${repo.github_repo}@${
      repo.branch
    } as wallet:${repo.owner_wallet.slice(0, 8)}…`
  );
  const { outcomes, commitSha } = await syncSource(
    connectedContext(repo),
    opts
  );
  if (opts.apply) {
    const errored = outcomes.find((o) => o.action === "error");
    await updateConnectedRepoSyncState(repo.id, {
      lastCommitSha: commitSha,
      status: errored ? "error" : "ok",
      detail: errored?.detail ?? null,
    }).catch(() => {});
  }
  return outcomes;
}

/** Sync every active connected repo (used by the daily cron). */
export async function syncConnectedRepos(
  opts: SyncOptions
): Promise<SyncResult> {
  const repos = await listActiveConnectedRepos();
  const outcomes: SkillOutcome[] = [];
  for (const repo of repos) {
    outcomes.push(...(await syncConnectedRepo(repo, opts)));
  }
  return toResult(outcomes);
}
