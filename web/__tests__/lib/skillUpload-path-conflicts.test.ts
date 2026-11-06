import { describe, expect, it } from "vitest";
import { parseSkillUploadRequest, SkillUploadError } from "@/lib/skillUpload";

function jsonUpload(files: Array<{ path: string; content: string }>) {
  return new Request("http://localhost/api/skills", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ skill_id: "demo", files }),
  });
}

function multipartUpload(files: Array<{ path: string; content: string }>) {
  const form = new FormData();
  form.set("skill_id", "demo");
  for (const file of files) {
    form.append("files", new File([file.content], file.path));
  }
  return new Request("http://localhost/api/skills", {
    method: "POST",
    body: form,
  });
}

const CONFLICTING = [
  { path: "SKILL.md", content: "# Skill" },
  { path: "docs", content: "a file named docs" },
  { path: "docs/a.md", content: "a file inside docs/" },
];

describe("skill upload path conflicts", () => {
  it.each([
    ["JSON", jsonUpload],
    ["multipart", multipartUpload],
  ])(
    "rejects a %s upload where a path is also a folder, with a 400",
    async (_kind, build) => {
      const error = await parseSkillUploadRequest(build(CONFLICTING)).catch(
        (caught: unknown) => caught
      );
      expect(error).toBeInstanceOf(SkillUploadError);
      expect((error as SkillUploadError).status).toBe(400);
      expect((error as Error).message).toBe(
        'Skill tree path "docs" is both a file and a folder (docs/a.md)'
      );
    }
  );

  it("still accepts a normal multi-file upload", async () => {
    const parsed = await parseSkillUploadRequest(
      jsonUpload([
        { path: "SKILL.md", content: "# Skill" },
        { path: "docs.md", content: "docs" },
        { path: "docs/a.md", content: "nested" },
      ])
    );
    expect(parsed.files.map((file) => file.path).sort()).toEqual([
      "SKILL.md",
      "docs.md",
      "docs/a.md",
    ]);
  });
});
