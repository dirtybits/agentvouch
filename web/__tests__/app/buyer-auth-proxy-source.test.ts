import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "proxy.ts"), "utf8");

describe("buyer auth proxy wiring", () => {
  it("keeps Clerk development previews on the direct Frontend API path", () => {
    expect(source).toContain("const buyerAuthMiddleware = clerkMiddleware();");
    expect(source).not.toContain("frontendApiProxy");
  });
});
