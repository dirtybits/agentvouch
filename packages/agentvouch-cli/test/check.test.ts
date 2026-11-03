import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCheckRequest,
  CHECK_BLOCKED_EXIT_CODE,
  checkSkill,
  parseCheckFailOn,
  shouldBlockInstall,
} from "../src/lib/check.js";
import { CliError } from "../src/lib/errors.js";
import { AgentVouchApiClient } from "../src/lib/http.js";

describe("parseCheckFailOn", () => {
  it("accepts the documented levels case-insensitively", () => {
    expect(parseCheckFailOn("review")).toBe("review");
    expect(parseCheckFailOn(" AVOID ")).toBe("avoid");
    expect(parseCheckFailOn("none")).toBe("none");
  });

  it("rejects unknown levels", () => {
    expect(() => parseCheckFailOn("block")).toThrow(/--fail-on/);
  });
});

describe("shouldBlockInstall", () => {
  it("blocks at or above the threshold", () => {
    expect(shouldBlockInstall("avoid", "avoid")).toBe(true);
    expect(shouldBlockInstall("review", "avoid")).toBe(false);
    expect(shouldBlockInstall("review", "review")).toBe(true);
    expect(shouldBlockInstall("allow", "review")).toBe(false);
  });

  it("never blocks when --fail-on none", () => {
    expect(shouldBlockInstall("avoid", "none")).toBe(false);
    expect(shouldBlockInstall("garbage", "none")).toBe(false);
  });

  it("fails closed on an unknown verdict", () => {
    expect(shouldBlockInstall(undefined, "avoid")).toBe(true);
    expect(shouldBlockInstall("safe", "avoid")).toBe(true);
  });
});

describe("buildCheckRequest", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "agentvouch-check-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("requires exactly one target", async () => {
    await expect(buildCheckRequest({})).rejects.toBeInstanceOf(CliError);
    await expect(buildCheckRequest({ skill: "a", hash: "b" })).rejects.toThrow(
      /exactly one/
    );
  });

  it("maps --skill and --hash to the API fields", async () => {
    await expect(buildCheckRequest({ skill: " cal " })).resolves.toEqual({
      body: { skill: "cal" },
      source: "registry",
    });
    await expect(buildCheckRequest({ hash: "abc" })).resolves.toEqual({
      body: { tree_hash: "abc" },
      source: "tree_hash",
    });
  });

  it("sends a single local file as SKILL.md", async () => {
    const file = path.join(dir, "whatever.md");
    await writeFile(file, "# Skill\n");
    const { body, source } = await buildCheckRequest({ target: file });
    expect(source).toBe("local-file");
    expect(body).toEqual({
      files: [{ path: "SKILL.md", content: "# Skill\n" }],
    });
  });

  it("collects a folder with publish skip rules", async () => {
    await writeFile(path.join(dir, "SKILL.md"), "# Skill\n");
    await mkdir(path.join(dir, "scripts"));
    await writeFile(path.join(dir, "scripts", "run.sh"), "echo hi\n");
    await mkdir(path.join(dir, "node_modules"));
    await writeFile(path.join(dir, "node_modules", "x.js"), "ignored");
    await writeFile(path.join(dir, ".DS_Store"), "ignored");

    const { body, source } = await buildCheckRequest({ target: dir });
    expect(source).toBe("local-tree");
    const files = "files" in body ? body.files : [];
    expect(files).toHaveLength(2);
    expect(files).toEqual(
      expect.arrayContaining([
        { path: "SKILL.md", content: "# Skill\n" },
        { path: "scripts/run.sh", content: "echo hi\n" },
      ])
    );
  });

  it("rejects a folder without SKILL.md", async () => {
    await writeFile(path.join(dir, "README.md"), "x");
    await expect(buildCheckRequest({ target: dir })).rejects.toThrow(
      /SKILL\.md/
    );
  });

  it("explains a missing path", async () => {
    await expect(
      buildCheckRequest({ target: path.join(dir, "nope") })
    ).rejects.toThrow(/--skill/);
  });
});

describe("checkSkill", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockCheckResponse(body: unknown, status = 200) {
    return vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(body), { status }));
  }

  it("posts to /api/check and returns the verdict", async () => {
    const fetchSpy = mockCheckResponse({
      recommended_action: "review",
      tree_hash: "h1",
      signals: [
        {
          id: "author-bond",
          label: "Author bond",
          scope: "author",
          status: "warn",
          detail: "none",
        },
      ],
    });

    const result = await checkSkill(
      new AgentVouchApiClient("https://agentvouch.xyz"),
      { skill: "cal", failOn: "avoid" }
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://agentvouch.xyz/api/check",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ skill: "cal" }),
      })
    );
    expect(result).toMatchObject({
      recommended_action: "review",
      tree_hash: "h1",
      blocked: false,
      source: "registry",
    });
    expect(result.signals).toHaveLength(1);
  });

  it("throws a CliError with the blocked exit code", async () => {
    mockCheckResponse({ recommended_action: "avoid", tree_hash: null });
    const error = await checkSkill(
      new AgentVouchApiClient("https://agentvouch.xyz"),
      { skill: "bad", failOn: "avoid" }
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).exitCode).toBe(CHECK_BLOCKED_EXIT_CODE);
    expect((error as CliError).data).toMatchObject({ blocked: true });
  });

  it("surfaces API errors as exit code 1", async () => {
    mockCheckResponse({ error: "tree_hash not found" }, 404);
    const error = await checkSkill(
      new AgentVouchApiClient("https://agentvouch.xyz"),
      { hash: "zzz", failOn: "avoid" }
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).exitCode).toBe(1);
    expect((error as CliError).message).toMatch(/tree_hash not found/);
  });
});
