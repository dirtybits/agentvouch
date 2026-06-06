import { finalizeSlug } from "@/lib/skillDraft";

export const CHAIN_SKILL_PREFIX = "chain-";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PublicSkillUrlFields = {
  id: string;
  skill_id?: string | null;
  public_slug?: string | null;
  public_author_slug?: string | null;
  author_handle?: string | null;
  author_pubkey?: string | null;
  publisher_identity_key?: string | null;
};

export function isUuidLike(value: string): boolean {
  return UUID_RE.test(value);
}

export function buildPublicSkillSlugBase(skillId: string): string {
  return finalizeSlug(skillId) || "skill";
}

export function buildPublicSkillSlug(input: {
  id: string;
  skill_id: string;
  existingRouteTaken?: boolean;
}): string {
  const base = buildPublicSkillSlugBase(input.skill_id);
  return input.existingRouteTaken
    ? `${base}-${input.id.replace(/-/g, "").slice(0, 8)}`
    : base;
}

export function buildPublicAuthorSlugBase(
  input: Pick<
    PublicSkillUrlFields,
    "id" | "author_handle" | "author_pubkey" | "publisher_identity_key"
  >
): string {
  if (input.author_handle) {
    return finalizeSlug(input.author_handle) || `publisher-${input.id.slice(0, 8)}`;
  }
  if (input.author_pubkey) {
    return `wallet-${input.author_pubkey.slice(0, 8).toLowerCase()}`;
  }
  if (input.publisher_identity_key) {
    const [kind, identifier] = input.publisher_identity_key.split(":", 2);
    const slug = finalizeSlug(identifier || kind || "");
    if (slug) return `${finalizeSlug(kind || "publisher")}-${slug}`.slice(0, 96);
  }
  return `publisher-${input.id.replace(/-/g, "").slice(0, 8)}`;
}

export function getPublicSkillSlug(skill: PublicSkillUrlFields): string {
  if (skill.public_slug) return skill.public_slug;
  if (skill.id.startsWith(CHAIN_SKILL_PREFIX)) return skill.id;
  if (skill.skill_id) return buildPublicSkillSlugBase(skill.skill_id);
  return skill.id;
}

export function getPublicSkillAuthorSlug(skill: PublicSkillUrlFields): string {
  if (skill.public_author_slug) return skill.public_author_slug;
  return buildPublicAuthorSlugBase(skill);
}

export function getPublicSkillPath(skill: PublicSkillUrlFields): string {
  if (skill.id.startsWith(CHAIN_SKILL_PREFIX)) {
    return `/skills/${encodeURIComponent(skill.id)}`;
  }
  return `/skills/${encodeURIComponent(
    getPublicSkillAuthorSlug(skill)
  )}/${encodeURIComponent(getPublicSkillSlug(skill))}`;
}
