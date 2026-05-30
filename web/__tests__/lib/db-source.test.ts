import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

describe("db schema bootstrap source", () => {
  it("does not use text NULs when backfilling skill tree hashes", () => {
    const source = readFileSync(join(process.cwd(), "lib/db.ts"), "utf8");

    expect(source).not.toContain("chr(0)");
    expect(source).toContain("decode('00', 'hex')");
  });
});
