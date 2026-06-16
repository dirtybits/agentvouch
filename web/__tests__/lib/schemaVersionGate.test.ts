import { describe, expect, it, vi } from "vitest";
import {
  computeSchemaFingerprint,
  runSchemaDdlOnce,
  type SqlQuery,
} from "@/lib/db";

function mockDb(selectResult: { version: string }[] | Error) {
  const executed: string[] = [];
  const db = (async (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    executed.push(text);
    if (text.includes("SELECT version FROM db_schema_version")) {
      if (selectResult instanceof Error) throw selectResult;
      return selectResult;
    }
    return [];
  }) as unknown as SqlQuery;
  return { db, executed };
}

describe("schema version gate", () => {
  it("changes the fingerprint when DDL source or extras change", () => {
    const a = computeSchemaFingerprint("CREATE TABLE a");
    expect(computeSchemaFingerprint("CREATE TABLE a")).toBe(a);
    expect(computeSchemaFingerprint("CREATE TABLE b")).not.toBe(a);
    expect(computeSchemaFingerprint("CREATE TABLE a", ["devnet"])).not.toBe(a);
    expect(computeSchemaFingerprint("CREATE TABLE a", ["devnet"])).not.toBe(
      computeSchemaFingerprint("CREATE TABLE a", ["mainnet"])
    );
  });

  it("skips the DDL when the stored fingerprint matches", async () => {
    const { db, executed } = mockDb([{ version: "fp-1" }]);
    const run = vi.fn();

    await runSchemaDdlOnce(db, "core", "fp-1", run);

    expect(run).not.toHaveBeenCalled();
    expect(executed).toHaveLength(1);
  });

  it("runs the DDL and records the fingerprint on mismatch", async () => {
    const { db, executed } = mockDb([{ version: "fp-old" }]);
    const run = vi.fn();

    await runSchemaDdlOnce(db, "core", "fp-new", run);

    expect(run).toHaveBeenCalledOnce();
    expect(
      executed.some((text) => text.includes("INSERT INTO db_schema_version"))
    ).toBe(true);
  });

  it("falls back to the full DDL when the version table does not exist", async () => {
    const { db } = mockDb(
      new Error('relation "db_schema_version" does not exist')
    );
    const run = vi.fn();

    await runSchemaDdlOnce(db, "core", "fp-1", run);

    expect(run).toHaveBeenCalledOnce();
  });
});
