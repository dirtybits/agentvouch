import { describe, expect, it } from "vitest";
import { sanitizeSyncedRepoUrl } from "@/lib/mirror/connectedRepos";

describe("sanitizeSyncedRepoUrl", () => {
  it("accepts a well-formed github.com https URL", () => {
    const url = "https://github.com/dirtybits/agentvouch";
    expect(sanitizeSyncedRepoUrl(url)).toBe(url);
  });

  it("accepts a URL with a repo path and branch fragment", () => {
    const url = "https://github.com/owner/repo/tree/main/skills";
    expect(sanitizeSyncedRepoUrl(url)).toBe(url);
  });

  it("rejects a javascript: URI", () => {
    expect(sanitizeSyncedRepoUrl("javascript:alert(1)")).toBe(null);
  });

  it("rejects a data: URI", () => {
    expect(
      sanitizeSyncedRepoUrl("data:text/html,<script>alert(1)</script>")
    ).toBe(null);
  });

  it("rejects an http:// (non-TLS) github URL", () => {
    expect(sanitizeSyncedRepoUrl("http://github.com/owner/repo")).toBe(null);
  });

  it("rejects a non-github https URL", () => {
    expect(sanitizeSyncedRepoUrl("https://evil.com/owner/repo")).toBe(null);
  });

  it("rejects a URL that starts with https://github.com. (look-alike)", () => {
    expect(
      sanitizeSyncedRepoUrl("https://github.com.evil.com/owner/repo")
    ).toBe(null);
  });

  it("returns null for null input", () => {
    expect(sanitizeSyncedRepoUrl(null)).toBe(null);
  });

  it("returns null for undefined input", () => {
    expect(sanitizeSyncedRepoUrl(undefined)).toBe(null);
  });

  it("returns null for empty string", () => {
    expect(sanitizeSyncedRepoUrl("")).toBe(null);
  });
});
