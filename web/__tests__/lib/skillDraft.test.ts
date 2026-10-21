import { describe, expect, it } from "vitest";

import {
  MAX_SKILL_DESCRIPTION_LENGTH,
  deriveDraftMetadataFromContent,
  normalizeSkillDescription,
  normalizeSkillTags,
  parseFrontmatter,
  slugify,
} from "@/lib/skillDraft";

describe("skillDraft helpers", () => {
  it("parses the full H1 title and description", () => {
    const parsed = parseFrontmatter(
      "# Lorem Ipsem\n\nLorem ipsum is placeholder text.\n\n## More"
    );

    expect(parsed.name).toBe("Lorem Ipsem");
    expect(parsed.description).toBe("Lorem ipsum is placeholder text.");
  });

  it("keeps autofilled metadata in sync while content changes", () => {
    const draft = deriveDraftMetadataFromContent({
      content:
        "# Lorem Ipsem\n\nLorem ipsum is placeholder text commonly used in publishing.",
      currentName: "L",
      currentSkillId: "l",
      currentDescription: "",
      nameManuallyEdited: false,
      skillIdManuallyEdited: false,
      descriptionManuallyEdited: false,
    });

    expect(draft.name).toBe("Lorem Ipsem");
    expect(draft.skillId).toBe(slugify("Lorem Ipsem"));
    expect(draft.description).toBe(
      "Lorem ipsum is placeholder text commonly used in publishing."
    );
  });

  it("truncates auto-derived descriptions to the database limit", () => {
    const longDescription = "a".repeat(MAX_SKILL_DESCRIPTION_LENGTH + 50);
    const draft = deriveDraftMetadataFromContent({
      content: `# Generated Name\n\n${longDescription}`,
      currentName: "",
      currentSkillId: "",
      currentDescription: "",
      nameManuallyEdited: false,
      skillIdManuallyEdited: false,
      descriptionManuallyEdited: false,
    });

    expect(draft.description).toBe(normalizeSkillDescription(longDescription));
    expect(draft.description.length).toBe(MAX_SKILL_DESCRIPTION_LENGTH);
  });

  it("preserves manually edited metadata", () => {
    const draft = deriveDraftMetadataFromContent({
      content: "# Generated Name\n\nGenerated description",
      currentName: "Custom Name",
      currentSkillId: "custom-skill-id",
      currentDescription: "Custom description",
      nameManuallyEdited: true,
      skillIdManuallyEdited: true,
      descriptionManuallyEdited: true,
    });

    expect(draft.name).toBe("Custom Name");
    expect(draft.skillId).toBe("custom-skill-id");
    expect(draft.description).toBe("Custom description");
  });
});

describe("normalizeSkillTags", () => {
  it("normalizes valid string tags", () => {
    expect(normalizeSkillTags(["Agent", "A.I.", "  cli  "])).toEqual([
      "agent",
      "a-i",
      "cli",
    ]);
  });

  it("caps the number of tags and length of each tag", () => {
    const many = Array.from({ length: 10 }, (_, i) => `tag${i}`);
    expect(normalizeSkillTags(many)).toHaveLength(5);
    expect(normalizeSkillTags(["x".repeat(50)]).length).toBe(1);
    expect(normalizeSkillTags(["x".repeat(50)])[0].length).toBeLessThanOrEqual(
      32
    );
  });

  it("dedupes case-insensitively and skips reserved/mirror-only tags", () => {
    expect(normalizeSkillTags(["a", "A", "A!", "mirror"])).toEqual(["a"]);
  });

  it("drops empty and whitespace-only tags", () => {
    expect(normalizeSkillTags(["", "   ", "----"])).toEqual([]);
  });

  it("fails closed by dropping non-string elements instead of coercing them", () => {
    // Ground-truth: String() of these inputs produces junk ("object-object",
    // "true", "null", "1-2", "undefined") that would otherwise be stored as tags.
    expect(
      normalizeSkillTags([{ x: 1 }, [1, 2], true, 1, null, undefined, {}])
    ).toEqual([]);
    expect(normalizeSkillTags([{ a: [1] }, 123.45, false, ""])).toEqual([]);
  });

  it("keeps valid string tags when mixed with invalid non-string values", () => {
    expect(normalizeSkillTags(["good", 123, null, { x: 1 }, "bad!"])).toEqual([
      "good",
      "bad",
    ]);
  });

  it("returns an empty array for a non-array payload", () => {
    expect(normalizeSkillTags("not-a-list")).toEqual([]);
    expect(normalizeSkillTags(null)).toEqual([]);
    expect(normalizeSkillTags(undefined)).toEqual([]);
    expect(normalizeSkillTags("hello")).toEqual([]);
  });
});
