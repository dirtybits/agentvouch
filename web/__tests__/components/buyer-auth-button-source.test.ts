import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "components/BuyerAuthButton.tsx"),
  "utf8"
);

describe("buyer auth navigation control", () => {
  it("stays hidden behind the public flag and exposes sign-in/sign-out state", () => {
    expect(source).toContain("isBuyerAuthUiEnabled()");
    expect(source).toContain("useAuth()");
    expect(source).toContain("if (!isSignedIn)");
    expect(source).toContain('href="/sign-in"');
    expect(source).toContain("<UserButton");
  });
});
