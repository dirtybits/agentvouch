import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("settings page source", () => {
  it("sends signed API-key list auth in a header rather than a GET body", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/settings/page.tsx"),
      "utf8"
    );

    const start = source.indexOf("const loadKeys");
    const end = source.indexOf("const loadIdentity");
    const loadKeysSource = source.slice(start, end);

    expect(loadKeysSource).toContain(
      'headers: { "X-AgentVouch-Auth": JSON.stringify(auth) }'
    );
    expect(loadKeysSource).toContain('signApiKeyAuth("list-keys")');
    expect(loadKeysSource).not.toContain("body:");
  });

  it("binds fresh nonces and exact API-key objects before signing", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/settings/page.tsx"),
      "utf8"
    );

    expect(source).toContain("buildApiKeyAuthMessage");
    expect(source).toContain("crypto.randomUUID()");
    expect(source).toContain("audience: window.location.origin");
    expect(source).toContain('signApiKeyAuth("create-key", { keyName })');
    expect(source).toContain("body: JSON.stringify({ auth, name: keyName })");
    expect(source).toContain('signApiKeyAuth("revoke-key", { keyId })');
  });

  it("lets wallet owners edit usernames and link GitHub profiles", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/settings/page.tsx"),
      "utf8"
    );

    expect(source).toContain("Profile Identity");
    expect(source).toContain("/api/agents/${walletAddress}/identity");
    expect(source).toContain("saveUsername");
    expect(source).toContain("linkGithub");
    expect(source).toContain("/api/auth/github/start?returnTo=");
    expect(source).toContain("/api/auth/github/linked-wallets");
    expect(source).toContain("Link to this wallet");
    expect(source).toContain("Linked wallets");
    expect(source).toContain("switching wallets and signing again");
    expect(source).toContain(
      "Verified by GitHub OAuth and this wallet signature"
    );
  });
});
