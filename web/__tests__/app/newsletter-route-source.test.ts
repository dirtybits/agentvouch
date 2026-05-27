import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("newsletter route source", () => {
  it("redirects the owned newsletter URL to Substack and preserves query params", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/newsletter/route.ts"),
      "utf8"
    );

    expect(source).toContain("https://agentvouch.substack.com/");
    expect(source).toContain("request.nextUrl.searchParams.forEach");
    expect(source).toContain("target.searchParams.append");
    expect(source).toContain("NextResponse.redirect(target, 307)");
  });
});
