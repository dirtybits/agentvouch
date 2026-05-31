import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

describe("SkillFileTree source", () => {
  it("renders a nested directory tree instead of flat file groups", () => {
    const source = readFileSync(
      join(process.cwd(), "components/SkillFileTree.tsx"),
      "utf8"
    );

    expect(source).toContain("type TreeDirectoryNode");
    expect(source).toContain("buildTree(files, getSkillTreeRootName(skillName))");
    expect(source).toContain("aria-expanded");
    expect(source).toContain("renderNode(child, depth + 1)");
    expect(source).not.toContain("function fileGroup");
  });

  it("names the root directory from the skill title slug", () => {
    const source = readFileSync(
      join(process.cwd(), "components/SkillFileTree.tsx"),
      "utf8"
    );

    expect(source).toContain("finalizeSlug(skillName)");
    expect(source).toContain("getSkillTreeRootName(skillName)");
    expect(source).not.toContain('name: "my-skill"');
  });
});
