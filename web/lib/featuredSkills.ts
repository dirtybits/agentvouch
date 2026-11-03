/**
 * Homepage "Featured skills" selection.
 *
 * Devnet smoke and checkout fixtures (for example "Agent Skills Tree Smoke"
 * or "Kora Paid Test Alpha") are real listings and stay visible in the
 * marketplace, but they should not be the first thing a new visitor sees.
 */

const FIXTURE_TAGS = new Set(["smoke", "test", "fixture"]);
const FIXTURE_WORD = /(^|[^a-z0-9])(smoke|fixture)([^a-z0-9]|$)/i;

export interface FeaturedSkillCandidate {
  skill_id?: string | null;
  name?: string | null;
  tags?: readonly string[] | null;
}

export function isTestFixtureSkill(skill: FeaturedSkillCandidate): boolean {
  if (
    Array.isArray(skill.tags) &&
    skill.tags.some((tag) => FIXTURE_TAGS.has(String(tag).trim().toLowerCase()))
  ) {
    return true;
  }
  return [skill.skill_id, skill.name].some(
    (value) => typeof value === "string" && FIXTURE_WORD.test(value)
  );
}

/** Keep the input order; drop fixtures; never backfill with fixtures. */
export function selectFeaturedSkills<T extends FeaturedSkillCandidate>(
  skills: readonly T[],
  limit: number
): T[] {
  return skills.filter((skill) => !isTestFixtureSkill(skill)).slice(0, limit);
}

/** How many ranked skills to load so fixtures can be skipped. */
export const FEATURED_SKILL_LIMIT = 3;
export const FEATURED_SKILL_CANDIDATE_POOL = 12;
