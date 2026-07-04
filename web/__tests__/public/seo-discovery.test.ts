import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { buildLlmsTxt } from "@/lib/llms";

const PUBLIC_DIR = path.join(process.cwd(), "public");

const CURRENT_PROGRAM_ID = "AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg";
const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const CAIP2_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

// Legacy v0.1 program ID. The migration doc's verification command flags
// this string as a regression marker; if it ever reappears in a public
// surface we want a failing test before search engines pick it up.
const LEGACY_PROGRAM_ID_FRAGMENT = "ELmVnLSN";

function read(rel: string): string {
  return fs.readFileSync(path.join(PUBLIC_DIR, rel), "utf8");
}

describe(".well-known/agentvouch.json", () => {
  const raw = read(".well-known/agentvouch.json");
  const parsed = JSON.parse(raw) as Record<string, unknown> & {
    program_id?: string;
    chain_context?: string;
    docs?: Record<string, string>;
    discovery?: Record<string, string>;
    cli?: Record<string, string>;
  };

  it("advertises the current v0.2.0 program id", () => {
    expect(parsed.program_id).toBe(CURRENT_PROGRAM_ID);
  });

  it("advertises the canonical devnet CAIP-2 chain context", () => {
    expect(parsed.chain_context).toBe(CAIP2_DEVNET);
  });

  it("points discovery and docs at agentvouch.xyz", () => {
    // All advertised URLs must live on the canonical public base.
    const allUrls = [
      parsed.base_url,
      ...Object.values(parsed.docs ?? {}),
      ...Object.values(parsed.discovery ?? {}),
    ].filter(Boolean);
    expect(allUrls.length).toBeGreaterThan(0);
    for (const url of allUrls) {
      expect(url).not.toMatch(/\s/);
      expect(url).toMatch(/^https:\/\/agentvouch\.xyz(?:\/|$)/);
    }
  });

  it("describes AgentVouch as a trust layer and skills marketplace", () => {
    expect(parsed.positioning).toMatch(/trust layer/i);
    expect(parsed.positioning).toMatch(/skills marketplace/i);
  });

  it("advertises the beta CLI without implying mainnet readiness", () => {
    expect(parsed.cli?.install).toBe("npm install -g @agentvouch/cli@beta");
    expect(parsed.cli?.no_install).toBe("npx @agentvouch/cli@beta --help");
    expect(parsed.cli?.node).toBe(">=20.18.0");
    expect(parsed.cli?.status).toMatch(/devnet beta/i);
    expect(parsed.cli?.status).toMatch(/not mainnet-ready/i);
  });
});

describe("skill.md (LLM-facing)", () => {
  const md = read("skill.md");

  it("does not reference the legacy v0.1 program id", () => {
    // If this ever fires, an LLM ingesting skill.md will tell agents to
    // talk to a dead program. Treat as a release blocker.
    expect(md).not.toContain(LEGACY_PROGRAM_ID_FRAGMENT);
  });

  it("describes the conditional purchase split rather than an unconditional 60/40", () => {
    // Permissionless paid purchases route 100% to author proceeds when no
    // external vouch stake exists; the 60/40 split is conditional. We
    // assert the conditional framing is present.
    expect(md).toMatch(/external vouch stake/i);
    expect(md).toMatch(/100%|full payment.*author/i);
  });

  it("does not advertise the retired competition", () => {
    // Best Skill Competition (March 11-18, 2026) had no participants and
    // was retired in Milestone 15. Any future surface that re-introduces
    // it should ship via a new milestone, not by reviving stale copy.
    expect(md).not.toMatch(/Best Skill Competition/i);
    expect(md).not.toMatch(/1\.75 SOL/);
  });

  it("references the current devnet USDC mint where USDC is named", () => {
    // The mint can move on a future cluster rotation, but if skill.md
    // mentions a USDC mint it must match the canonical devnet mint
    // until that explicit migration happens.
    const mentionsAnyMint = /mint/i.test(md);
    if (mentionsAnyMint) {
      expect(md).toContain(DEVNET_USDC_MINT);
    }
  });
});

describe("llms.txt (generated route)", () => {
  // Served dynamically from app/llms.txt/route.ts via buildLlmsTxt(), so the
  // Primary docs list stays in sync with CONTENT_PAGES instead of drifting.
  const txt = buildLlmsTxt();

  it("does not reference the legacy v0.1 program id", () => {
    expect(txt).not.toContain(LEGACY_PROGRAM_ID_FRAGMENT);
  });

  it("does not advertise the retired competition", () => {
    expect(txt).not.toMatch(/Best Skill Competition/i);
  });

  it("leads with trust layer and skills marketplace positioning", () => {
    expect(txt).toMatch(/trust layer/i);
    expect(txt).toMatch(/skills marketplace/i);
    expect(txt).toMatch(/discover skills/i);
  });

  it("advertises the pillar page and docs generated from CONTENT_PAGES", () => {
    expect(txt).toContain("/agent-reputation-system");
    expect(txt).toContain("/docs/glossary");
    expect(txt).toContain("/docs/ai-agent-reputation-score");
  });

  it("documents the beta CLI install flow and safety caveats", () => {
    expect(txt).toContain("npm install -g @agentvouch/cli@beta");
    expect(txt).toContain("npx @agentvouch/cli@beta --help");
    expect(txt).toMatch(/Node\.js >=20\.18\.0/);
    expect(txt).toMatch(/devnet-backed AgentVouch system/i);
    expect(txt).toMatch(/not treat it as mainnet-ready/i);
    expect(txt).toMatch(/supply-chain safety buffer/i);
    expect(txt).toContain("npm config delete before");
  });
});

describe("llms-full.txt", () => {
  const txt = read("llms-full.txt");

  it("documents the beta CLI install flow, commands, and safety caveats", () => {
    expect(txt).toContain("npm install -g @agentvouch/cli@beta");
    expect(txt).toContain("npx @agentvouch/cli@beta --help");
    expect(txt).toContain("agentvouch skill list --sort trusted");
    expect(txt).toContain("agentvouch skill inspect {id} --json");
    expect(txt).toContain("agentvouch skill install {id} --out ./SKILL.md");
    expect(txt).toContain("agentvouch skills update --file ./SKILL.md");
    expect(txt).toMatch(/Node\.js >=20\.18\.0/);
    expect(txt).toMatch(/devnet-backed AgentVouch system/i);
    expect(txt).toMatch(/not a mainnet-readiness signal/i);
    expect(txt).toMatch(/supply-chain safety buffer/i);
    expect(txt).toContain("npm config delete before");
  });
});
