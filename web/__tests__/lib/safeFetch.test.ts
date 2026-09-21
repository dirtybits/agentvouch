import { describe, expect, it } from "vitest";
import { resolveSafeFetchUrl } from "@/lib/safeFetch";

// Behavioral tests for the SSRF guard used before server-side fetches of
// author-controlled URLs (chain-only skill `skill_uri`). URL normalization
// expectations below were verified against Node's WHATWG URL (2026-09-19).

describe("resolveSafeFetchUrl", () => {
  it("allows public https URLs and normalizes to href", () => {
    const result = resolveSafeFetchUrl(
      "https://agentvouch.xyz/smoke/v02fresh.md"
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe("https://agentvouch.xyz/smoke/v02fresh.md");
    }
  });

  it("allows public http URLs", () => {
    const result = resolveSafeFetchUrl("http://example.com/a");
    expect(result.ok).toBe(true);
  });

  it("trims surrounding whitespace and tolerates scheme case", () => {
    const trimmed = resolveSafeFetchUrl("  https://example.com/x  ");
    expect(trimmed.ok).toBe(true);
    const schemeCase = resolveSafeFetchUrl("HTTP://EXAMPLE.COM/a");
    expect(schemeCase.ok).toBe(true);
    if (schemeCase.ok) {
      expect(schemeCase.url).toBe("http://example.com/a");
    }
  });

  it("rejects missing, empty, and unparseable inputs", () => {
    expect(resolveSafeFetchUrl(undefined).ok).toBe(false);
    expect(resolveSafeFetchUrl(null).ok).toBe(false);
    expect(resolveSafeFetchUrl("").ok).toBe(false);
    expect(resolveSafeFetchUrl("   ").ok).toBe(false);
    const notAUrl = resolveSafeFetchUrl("not a url");
    expect(notAUrl.ok).toBe(false);
    if (!notAUrl.ok) expect(notAUrl.reason).toBe("not a URL");
  });

  it("rejects non-http(s) protocols", () => {
    for (const uri of [
      "ipfs://QmTest",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "gopher://127.0.0.1/",
    ]) {
      const result = resolveSafeFetchUrl(uri);
      expect(result.ok, uri).toBe(false);
      if (!result.ok) expect(result.reason).toContain("protocol");
    }
  });

  it("rejects localhost hostnames", () => {
    for (const uri of [
      "http://localhost/",
      "http://foo.localhost/secret",
      "http://localhost./secret",
      "http://foo.localhost./secret",
    ]) {
      const result = resolveSafeFetchUrl(uri);
      expect(result.ok, uri).toBe(false);
      if (!result.ok) expect(result.reason).toBe("loopback hostname");
    }
  });

  it("rejects loopback IPv4 in every numeric spelling WHATWG URL normalizes", () => {
    for (const uri of [
      "http://127.0.0.1:8080/secret",
      "http://2130706433/",
      "http://0x7f.1/",
      "http://127.1/",
      "http://0177.0.0.1/",
    ]) {
      const result = resolveSafeFetchUrl(uri);
      expect(result.ok, uri).toBe(false);
      if (!result.ok) expect(result.reason).toContain("IPv4");
    }
  });

  it("rejects cloud metadata and link-local IPv4", () => {
    const result = resolveSafeFetchUrl(
      "http://169.254.169.254/latest/meta-data/"
    );
    expect(result.ok).toBe(false);
  });

  it("rejects private, CGNAT, and special-purpose IPv4 ranges", () => {
    for (const uri of [
      "http://10.0.0.5/",
      "http://192.168.1.1/",
      "http://172.16.0.1/",
      "http://172.31.255.255/",
      "http://100.64.0.1/",
      "http://0.0.0.0/",
      "http://224.0.0.1/",
      "http://240.0.0.1/",
      "http://255.255.255.255/",
      "http://192.0.2.1/",
      "http://198.18.0.1/",
    ]) {
      const result = resolveSafeFetchUrl(uri);
      expect(result.ok, uri).toBe(false);
      if (!result.ok) expect(result.reason).toContain("IPv4");
    }
  });

  it("allows IPv4 addresses just outside blocked ranges", () => {
    for (const uri of [
      "http://172.32.0.1/",
      "http://100.128.0.1/",
      "http://8.8.8.8/",
    ]) {
      const result = resolveSafeFetchUrl(uri);
      expect(result.ok, uri).toBe(true);
    }
  });

  it("rejects IPv6 loopback, unspecified, link-local, ULA, and multicast", () => {
    for (const uri of [
      "http://[::1]/",
      "http://[::]/",
      "http://[fe80::1]/",
      "http://[fc00::1]/",
      "http://[fd00::1]/",
      "http://[ff02::1]/",
      "http://[2001:db8::1]/",
    ]) {
      const result = resolveSafeFetchUrl(uri);
      expect(result.ok, uri).toBe(false);
      if (!result.ok)
        expect(result.reason).toBe("private/reserved IPv6 address");
    }
  });

  it("rejects IPv4-mapped IPv6 addresses pointing at blocked IPv4 ranges", () => {
    for (const uri of [
      "http://[::ffff:127.0.0.1]/",
      "http://[0:0:0:0:0:ffff:ac10:1]/",
      "http://[::ffff:a9fe:a9fe]/",
    ]) {
      const result = resolveSafeFetchUrl(uri);
      expect(result.ok, uri).toBe(false);
    }
  });

  it("allows public IPv6 addresses", () => {
    const result = resolveSafeFetchUrl(
      "http://[2606:4700:4700::1111]/dns-query"
    );
    expect(result.ok).toBe(true);
  });

  it("blocks unparseable IPv6 literals (fails closed)", () => {
    const result = resolveSafeFetchUrl("http://[1:2:3:4:5:6:7:8:9]/");
    // URL parsing accepts any bracketed host, so the guard must decide.
    expect(result.ok).toBe(false);
  });
});
