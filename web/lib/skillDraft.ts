export const MAX_SKILL_NAME_LENGTH = 64;
export const MAX_SKILL_DESCRIPTION_LENGTH = 256;
export const MAX_SKILL_CONTACT_LENGTH = 128;
// Cap raw skill content (markdown SKILL.md). Generous for docs; bounds DB/IPFS abuse.
export const MAX_SKILL_CONTENT_BYTES = 256 * 1024;
// Some skills bundle large reference doc sets (e.g. a few hundred small
// markdown files) alongside their instructions; 512 keeps those listable while
// still bounding pathological trees.
export const MAX_SKILL_TREE_FILES = 512;
// 8MB tree budget accommodates skills that bundle binary assets (e.g. font
// families) alongside their instructions. Off-chain only: the full tree lives in
// blob storage; on-chain listings carry just metadata + skill_uri.
export const MAX_SKILL_TREE_BYTES = 8 * 1024 * 1024;
// Whole-request ceiling: max tree (~8MB) as base64 (~1.33x) + multipart overhead.
export const MAX_SKILL_UPLOAD_BYTES = 12 * 1024 * 1024;
export const MAX_SKILL_FILE_BYTES = 1024 * 1024;

function trimToLength(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

export function parseFrontmatter(content: string): {
  name: string;
  description: string;
  body: string;
} {
  const lines = content.split("\n");

  let name = "";
  let description = "";
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("# ") && !name) {
      name = trimmed.slice(2).trim();
      continue;
    }

    if (name && !description && !trimmed.startsWith("#")) {
      description = trimmed;
      break;
    }
  }

  return { name, description, body: content };
}

export function slugify(text: string, trimEdges = true): string {
  let slug = text
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .slice(0, MAX_SKILL_NAME_LENGTH);
  if (trimEdges) slug = slug.replace(/^-|-$/g, "");
  return slug;
}

export function finalizeSlug(text: string): string {
  return slugify(text, true);
}

export function normalizeSkillName(text: string): string {
  return trimToLength(text, MAX_SKILL_NAME_LENGTH);
}

export function normalizeSkillDescription(text: string): string {
  return trimToLength(text, MAX_SKILL_DESCRIPTION_LENGTH);
}

export function normalizeSkillContact(text: string): string {
  return trimToLength(text, MAX_SKILL_CONTACT_LENGTH);
}

export function deriveDraftMetadataFromContent(params: {
  content: string;
  currentName: string;
  currentSkillId: string;
  currentDescription: string;
  nameManuallyEdited: boolean;
  skillIdManuallyEdited: boolean;
  descriptionManuallyEdited: boolean;
}) {
  const parsed = parseFrontmatter(params.content);

  return {
    name:
      parsed.name && !params.nameManuallyEdited
        ? normalizeSkillName(parsed.name)
        : params.currentName,
    skillId:
      parsed.name && !params.skillIdManuallyEdited
        ? slugify(normalizeSkillName(parsed.name))
        : params.currentSkillId,
    description:
      parsed.description && !params.descriptionManuallyEdited
        ? normalizeSkillDescription(parsed.description)
        : params.currentDescription,
  };
}
