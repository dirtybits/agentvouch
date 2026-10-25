import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// The sweep must stay read-only. Its one query is built (and tested) in
// lib/treeHashAudit.ts; these checks guard the I/O wiring around it.
describe("tree-hash sweep script source", () => {
  const source = readFileSync(
    join(process.cwd(), "scripts", "tree-hash-sweep.ts"),
    "utf8"
  );
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("reads rows only through the shared SELECT-only query builder", () => {
    expect(code).toContain("buildSweepVersionQuery(");
    expect(code).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/
    );
  });

  it("never runs schema setup or imports the app database module", () => {
    expect(code).not.toContain("initializeDatabase");
    expect(code).not.toContain('"@/lib/db"');
  });

  it("never writes to Blob storage", () => {
    expect(code).not.toContain('"@vercel/blob"');
    expect(code).not.toMatch(/\b(put|del|copy)\s*\(/);
  });

  it("does not call the public download routes, which record download events", () => {
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toContain("/api/skills/");
  });

  it("prints the target host and honors EXPECTED_DATABASE_HOST", () => {
    expect(code).toContain("Database host:");
    expect(code).toContain("EXPECTED_DATABASE_HOST");
  });
});
