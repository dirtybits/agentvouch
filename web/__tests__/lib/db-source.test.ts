import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

describe("db schema bootstrap source", () => {
  it("does not use text NULs when backfilling skill tree hashes", () => {
    const source = readFileSync(join(process.cwd(), "lib/db.ts"), "utf8");

    expect(source).not.toContain("chr(0)");
    expect(source).toContain("decode('00', 'hex')");
  });

  it("stores security scans by content tree hash", () => {
    const source = readFileSync(join(process.cwd(), "lib/db.ts"), "utf8");

    expect(source).toContain("CREATE TABLE IF NOT EXISTS skill_scans");
    expect(source).toContain("PRIMARY KEY (tree_hash, rubric_version, model)");
    expect(source).toContain("scan_source VARCHAR(32)");
    expect(source).toContain("generated_by_model BOOLEAN");
    expect(source).toContain("idx_skill_versions_tree_hash");
  });

  it("tracks AI scan budget reservations durably", () => {
    const source = readFileSync(join(process.cwd(), "lib/db.ts"), "utf8");

    expect(source).toContain("CREATE TABLE IF NOT EXISTS ai_scan_budget_counters");
    expect(source).toContain("PRIMARY KEY (bucket, period_start)");
  });
});
