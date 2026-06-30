import { cache } from "react";
import { initializeDatabase, sql, type SqlQuery } from "@/lib/db";
import {
  CHAIN_SKILL_PREFIX,
  buildPublicAuthorSlugBase,
  buildPublicSkillSlug,
  buildPublicSkillSlugBase,
  getPublicSkillPath,
  isUuidLike,
} from "@/lib/skillUrls";

export type SkillRouteRecord = {
  id: string;
  skill_id: string;
  public_slug: string | null;
  public_author_slug: string | null;
};

export function getCanonicalSkillPath(skill: SkillRouteRecord): string {
  return getPublicSkillPath(skill);
}

export async function buildUniquePublicSkillRoute(
  db: SqlQuery,
  input: {
    id: string;
    skill_id: string;
    author_handle?: string | null;
    author_pubkey?: string | null;
    publisher_identity_key?: string | null;
  }
): Promise<{ publicAuthorSlug: string; publicSlug: string }> {
  const publicAuthorSlug = buildPublicAuthorSlugBase(input);
  const skillBase = buildPublicSkillSlugBase(input.skill_id);
  const baseRows = await db<{ id: string }>`
    SELECT id
    FROM skills
    WHERE public_author_slug = ${publicAuthorSlug}
      AND public_slug = ${skillBase}
    LIMIT 1
  `;

  if (baseRows.length === 0) {
    return { publicAuthorSlug, publicSlug: skillBase };
  }

  const suffixed = buildPublicSkillSlug({
    id: input.id,
    skill_id: input.skill_id,
    existingRouteTaken: true,
  });
  const suffixRows = await db<{ id: string }>`
    SELECT id
    FROM skills
    WHERE public_author_slug = ${publicAuthorSlug}
      AND public_slug = ${suffixed}
    LIMIT 1
  `;

  return {
    publicAuthorSlug,
    publicSlug:
      suffixRows.length === 0
        ? suffixed
        : `${skillBase}-${input.id.replace(/-/g, "").slice(0, 12)}`,
  };
}

// Wrapped in React cache() so generateMetadata and the page body dedupe this
// resolve within a single request instead of each issuing the same DB query.
export const resolveSkillRoutePath = cache(
  async (
    rawAuthorSlug: string,
    rawSkillSlug: string
  ): Promise<SkillRouteRecord | null> => {
    await initializeDatabase();
    const authorSlug = decodeURIComponent(rawAuthorSlug);
    const skillSlug = decodeURIComponent(rawSkillSlug);
    const rows = await sql()<SkillRouteRecord>`
      SELECT id, skill_id, public_slug, public_author_slug
      FROM skills
      WHERE public_author_slug = ${authorSlug}
        AND public_slug = ${skillSlug}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }
);

// Route params for the most recent skills, consumed by the skill page's
// generateStaticParams to prerender popular pages at build. Returns [] on any
// failure so a build/DB hiccup degrades to all-on-demand ISR rather than
// failing the build. Note: the [id] route segment is the AUTHOR slug and
// [skill] is the skill slug (mirrors resolveSkillRoutePath's argument order).
export async function listStaticSkillRouteParams(
  limit = 200
): Promise<{ id: string; skill: string }[]> {
  try {
    await initializeDatabase();
    const rows = await sql()<{
      public_author_slug: string;
      public_slug: string;
    }>`
      SELECT public_author_slug, public_slug
      FROM skills
      WHERE public_author_slug IS NOT NULL
        AND public_slug IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({ id: r.public_author_slug, skill: r.public_slug }));
  } catch {
    return [];
  }
}

export async function resolveSkillRouteParam(
  rawParam: string
): Promise<SkillRouteRecord | null> {
  const param = decodeURIComponent(rawParam);
  if (param.startsWith(CHAIN_SKILL_PREFIX)) {
    return {
      id: param,
      skill_id: param.slice(CHAIN_SKILL_PREFIX.length),
      public_slug: param,
      public_author_slug: CHAIN_SKILL_PREFIX.replace(/-$/, ""),
    };
  }

  await initializeDatabase();
  const db = sql();
  if (isUuidLike(param)) {
    const rows = await db<SkillRouteRecord>`
      SELECT id, skill_id, public_slug, public_author_slug
      FROM skills
      WHERE id = ${param}::uuid
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  const slugRows = await db<SkillRouteRecord>`
    SELECT id, skill_id, public_slug, public_author_slug
    FROM skills
    WHERE public_slug = ${param}
    ORDER BY created_at ASC, id ASC
    LIMIT 2
  `;
  if (slugRows.length === 1) return slugRows[0];

  const fallbackRows = await db<SkillRouteRecord>`
    SELECT id, skill_id, public_slug, public_author_slug
    FROM skills
    WHERE skill_id = ${param}
    ORDER BY created_at ASC, id ASC
    LIMIT 2
  `;
  if (fallbackRows.length === 1) return fallbackRows[0];
  return null;
}
