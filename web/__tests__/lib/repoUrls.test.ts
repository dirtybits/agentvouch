import { describe, expect, it } from "vitest";
import { sanitizeSyncedRepoUrl } from "@/lib/repoUrls";

describe("sanitizeSyncedRepoUrl", () => {
  it("retains canonical GitHub HTTPS repository URLs", () => {
    expect(
      sanitizeSyncedRepoUrl("https://github.com/dirtybits/agentvouch")
    ).toBe("https://github.com/dirtybits/agentvouch");
  });

  it("rejects missing and non-GitHub URL values before they reach an href", () => {
    for (const value of [
      undefined,
      null,
      "",
      "http://github.com/dirtybits/agentvouch",
      "https://github.com.evil.example/dirtybits/agentvouch",
      "https://github.com@evil.example/dirtybits/agentvouch",
      "//github.com/dirtybits/agentvouch",
      "javascript:alert(1)",
    ]) {
      expect(sanitizeSyncedRepoUrl(value)).toBeNull();
    }
  });
});
