import { describe, expect, it } from "vitest";
import { checkNodeVersion } from "../src/preflight.js";

describe("checkNodeVersion", () => {
  it("passes when running version equals the minimum", () => {
    expect(checkNodeVersion("20.18.0", ">=20.18.0")).toBeNull();
  });

  it("passes when running version is newer", () => {
    expect(checkNodeVersion("22.21.0", ">=20.18.0")).toBeNull();
    expect(checkNodeVersion("20.19.5", ">=20.18.0")).toBeNull();
  });

  it("fails with an actionable message on an older patch", () => {
    const msg = checkNodeVersion("20.17.0", ">=20.18.0");
    expect(msg).toContain("requires Node.js >=20.18.0");
    expect(msg).toContain("v20.17.0");
    expect(msg).toMatch(/nvm install 20|nodejs\.org/);
  });

  it("fails on an older major", () => {
    expect(checkNodeVersion("18.20.0", ">=20.18.0")).toContain(
      "requires Node.js >=20.18.0"
    );
  });

  it("never blocks when the engines range is missing or unparseable", () => {
    expect(checkNodeVersion("20.17.0", undefined)).toBeNull();
    expect(checkNodeVersion("20.17.0", "weird")).toBeNull();
    expect(checkNodeVersion("not-a-version", ">=20.18.0")).toBeNull();
  });
});
