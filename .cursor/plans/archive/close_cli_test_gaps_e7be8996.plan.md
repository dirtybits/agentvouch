---
name: Close CLI Test Gaps
overview: "Close the high-leverage test gaps from the recent CLI review: add unit coverage for the `vouch` command, lock in the `agent` primary / `author` deprecated structure, pin the `agent register` output label, pin the docs/skill.md rename, and cover the `formatAgentTrust` empty-fields branch. Enable this by refactoring `cli.ts` into a `buildProgram()` factory plus a thin `src/bin.ts` entry so the command tree and action-local formatters are in-process testable."
todos:
  - id: refactor-build-program
    content: Refactor cli.ts to export buildProgram(), add src/bin.ts with the parseAsync call, and update package.json bin + tsup entry to use src/bin.ts alongside src/cli.ts
    status: completed
  - id: extract-action-formatters
    content: Move the inline register and vouch action formatters into exported formatRegisterAgentResult and formatCreateVouchResult helpers in src/lib/format.ts and rewire both actions
    status: completed
  - id: gap5-vouch-tests
    content: Add packages/agentvouch-cli/test/vouch.test.ts covering vouch command tree, help text, parseAmountSol validator, and formatCreateVouchResult branches
    status: completed
  - id: gap1-structure-test
    content: Add packages/agentvouch-cli/test/structure.test.ts asserting agent is primary, author is deprecated, and list/register/trust exist on both groups with the right help-text deprecation notices
    status: completed
  - id: gap2-register-output-test
    content: "Extend format.test.ts with formatRegisterAgentResult cases pinning agent: label and tx-omitted branch"
    status: completed
  - id: gap3-docs-skill-pins
    content: Extend web/__tests__/app/docs-page-source.test.ts with an agent-vocabulary assertion and add web/__tests__/public/skill-md-source.test.ts pinning the public skill.md rename
    status: completed
  - id: gap6-agent-trust-empty-fields
    content: Append a formatAgentTrust empty-fields case to format.test.ts asserting null author_trust + missing identity fall back cleanly
    status: completed
  - id: verify-tests-and-smoke
    content: Run npm run build:cli, npm run test:cli, npm run test:web, and re-run node scripts/smoke-flow-surface.mjs against the new bin.js to confirm no regressions; update the smoke script cliPath to dist/bin.js if needed
    status: completed
isProject: false
---

## Prerequisite refactor (enables Gaps 1, 2, 5)

### 1. Split bin entry from command wiring

Refactor [packages/agentvouch-cli/src/cli.ts](packages/agentvouch-cli/src/cli.ts):

- Replace the top-level `const program = new Command()...` + subcommand attachments + trailing `await program.parseAsync(process.argv)` with a single exported factory:

```ts
export function buildProgram(): Command {
  const program = new Command()
    .name("agentvouch")
    .description("Headless CLI for AgentVouch skill install and publish flows.")
    .version(cliPackage.version);
  // ... all .command(...) wiring as today ...
  return program;
}
```

- Remove the trailing `await program.parseAsync(process.argv);` from `cli.ts` entirely.

Add [packages/agentvouch-cli/src/bin.ts](packages/agentvouch-cli/src/bin.ts):

```ts
#!/usr/bin/env node
import { buildProgram } from "./cli.js";

await buildProgram().parseAsync(process.argv);
```

Update [packages/agentvouch-cli/package.json](packages/agentvouch-cli/package.json):

- `"bin": { "agentvouch": "./dist/bin.js" }`
- `"build": "tsup src/bin.ts src/cli.ts --format esm --dts --sourcemap --clean --out-dir dist"` (two entrypoints so both files ship; `cli.js` is consumed by `bin.js`).

### 2. Extract inline action formatters

Move the two anonymous `(result) => [...]` formatters out of `cli.ts` action bodies into exported helpers in [packages/agentvouch-cli/src/lib/format.ts](packages/agentvouch-cli/src/lib/format.ts):

```ts
export interface RegisterAgentResult {
  agentProfile: string;
  alreadyRegistered: boolean;
  tx?: string;
}
export function formatRegisterAgentResult(r: RegisterAgentResult): string[] {
  return [
    `agent: ${r.agentProfile}`,
    `already_registered: ${r.alreadyRegistered ? "yes" : "no"}`,
    ...(r.tx ? [`tx: ${r.tx}`] : []),
  ];
}

export interface CreateVouchResult {
  vouch: string;
  alreadyExists: boolean;
  lamports?: number;
  tx?: string;
}
export function formatCreateVouchResult(r: CreateVouchResult): string[] {
  return [
    `vouch: ${r.vouch}`,
    `already_exists: ${r.alreadyExists ? "yes" : "no"}`,
    ...(r.lamports ? [`lamports: ${r.lamports}`] : []),
    ...(r.tx ? [`tx: ${r.tx}`] : []),
  ];
}
```

Rewire the two action bodies in `cli.ts` to reference these exports.

## Gap 5 — CLI vouch coverage

Add [packages/agentvouch-cli/test/vouch.test.ts](packages/agentvouch-cli/test/vouch.test.ts):

- `buildProgram()` exposes a `vouch` top-level command with a `create` subcommand.
- `vouch create --help` text contains the `--author`, `--amount-sol`, `--keypair` required options and the example line.
- `--amount-sol` rejects `0` and negatives via the `parseAmountSol` validator. Export `parseAmountSol` from `cli.ts` (or move to a small `src/lib/parse.ts`) and assert it throws on `0`, `-1`, and `NaN`.
- `formatCreateVouchResult` covers both the no-tx `alreadyExists: true` case and the successful-vouch case with `lamports` + `tx` present.

Note: `solana.vouch()` BN conversion is already covered in [packages/agentvouch-cli/test/solana.test.ts](packages/agentvouch-cli/test/solana.test.ts), so this focuses on the CLI wiring, not re-testing the on-chain path.

## Gap 1 — agent/author structure lock-in

Add [packages/agentvouch-cli/test/structure.test.ts](packages/agentvouch-cli/test/structure.test.ts):

```ts
import { describe, expect, it } from "vitest";
import { buildProgram } from "../src/cli.js";

describe("CLI command structure", () => {
  const program = buildProgram();

  it("exposes agent as primary and author as deprecated alias", () => {
    const names = program.commands.map((c) => c.name());
    expect(names).toEqual(
      expect.arrayContaining(["skill", "skills", "agent", "author", "vouch"])
    );
    const author = program.commands.find((c) => c.name() === "author")!;
    expect(author.description()).toMatch(/deprecated/i);
  });

  it("registers list, register, trust on both agent and author", () => {
    for (const groupName of ["agent", "author"] as const) {
      const group = program.commands.find((c) => c.name() === groupName)!;
      const subs = group.commands.map((c) => c.name());
      expect(subs).toEqual(expect.arrayContaining(["list", "register", "trust"]));
    }
  });

  it("marks only the author variant help as deprecated", () => {
    const author = program.commands.find((c) => c.name() === "author")!;
    const agent = program.commands.find((c) => c.name() === "agent")!;
    const authorTrust = author.commands.find((c) => c.name() === "trust")!;
    const agentTrust = agent.commands.find((c) => c.name() === "trust")!;
    expect(authorTrust.helpInformation()).toContain(
      "Deprecated alias: use `agent trust`"
    );
    expect(agentTrust.helpInformation()).not.toMatch(/Deprecated alias/);
  });
});
```

## Gap 2 — agent register output label pin

Append to [packages/agentvouch-cli/test/format.test.ts](packages/agentvouch-cli/test/format.test.ts):

```ts
describe("formatRegisterAgentResult", () => {
  it("emits agent: label (not author:)", () => {
    const lines = formatRegisterAgentResult({
      agentProfile: "PDA111",
      alreadyRegistered: false,
      tx: "tx111",
    });
    expect(lines).toContain("agent: PDA111");
    expect(lines).not.toContain("author: PDA111");
    expect(lines).toContain("already_registered: no");
    expect(lines).toContain("tx: tx111");
  });

  it("omits tx when none is returned", () => {
    const lines = formatRegisterAgentResult({
      agentProfile: "PDA111",
      alreadyRegistered: true,
    });
    expect(lines).toContain("already_registered: yes");
    expect(lines.some((l) => l.startsWith("tx:"))).toBe(false);
  });
});
```

## Gap 3 — docs + skill.md rename pin

Extend [web/__tests__/app/docs-page-source.test.ts](web/__tests__/app/docs-page-source.test.ts) with a new `it("prefers agent vocabulary", ...)` block:

```ts
it("prefers agent vocabulary in the publish flow", () => {
  const source = fs.readFileSync("app/docs/page.tsx", "utf8");
  expect(source).toContain("agent register");
  expect(source).toContain("Agent Publish");
  expect(source).not.toMatch(/\bauthor register\b/);
});
```

Add [web/__tests__/public/skill-md-source.test.ts](web/__tests__/public/skill-md-source.test.ts):

```ts
import fs from "fs";
import { describe, expect, it } from "vitest";

describe("public skill.md", () => {
  const md = fs.readFileSync("public/skill.md", "utf8");

  it("uses agent vocabulary for the register command", () => {
    expect(md).toContain("agentvouch agent register");
    expect(md).not.toMatch(/agentvouch author register/);
  });

  it("describes vouching against agents, not authors", () => {
    expect(md).toContain("Vouch for another agent");
  });
});
```

## Gap 6 — formatAgentTrust empty-fields branch

Append one case to the existing `describe("formatAgentTrust", ...)` in [packages/agentvouch-cli/test/format.test.ts](packages/agentvouch-cli/test/format.test.ts):

```ts
it("falls back cleanly when author_trust and identity are missing", () => {
  const lines = formatAgentTrust(
    buildAgentTrust({
      author_trust: null,
      author_identity: null,
      author_disputes: undefined,
    })
  );
  // display name falls back to canonical_agent_id or pubkey
  expect(lines[0]).not.toBe("Calendar Agent");
  expect(lines).toContain("author_bond_lamports: 0");
  expect(lines).toContain("total_stake_at_risk: 0");
  expect(lines).toContain("author_dispute_count: 0");
});
```

## Out of scope

- Gap 4 (smoke-script guard unit test). The script is a root `.mjs` file with no existing test harness; covering it requires either spawning `node` in tests or extracting `ensureCliBuilt` into a module. Low-leverage relative to the refactor cost. Skip unless requested.
- Broader cleanup of `--author` / `author_reputation` output labels (part of the planned agent-first output pass that is tracked separately).
- Full publish-readiness pass (tracked in [.cursor/plans/publish_agentvouch_cli_37d3a2f1.plan.md](.cursor/plans/publish_agentvouch_cli_37d3a2f1.plan.md)).

## Verification

- `npm run build:cli` succeeds with the new two-entry tsup config; `dist/bin.js` and `dist/cli.js` both produced.
- `node packages/agentvouch-cli/dist/bin.js --help` behaves identically to today.
- `node packages/agentvouch-cli/dist/bin.js agent trust --help` and `... author trust --help` show the expected primary vs deprecated text.
- `npm run test:cli` passes and reports the three new suites (structure, vouch, format additions).
- `npm run test:web` passes and includes the new `public/skill-md-source.test.ts` suite.
- `node scripts/smoke-flow-surface.mjs` still succeeds against the new `bin.js` path (it invokes via `bin` resolution, not the raw file path — verify after rebuild).

## Risk notes

- The `tsup` change emits two entry files. If tree-shaking differs between a single and multi-entry build, spot-check `dist/bin.js` imports `./cli.js` correctly (tsup handles this; verify once after first build).
- If `scripts/smoke-flow-surface.mjs` still references `packages/agentvouch-cli/dist/cli.js` directly for `execFileAsync`, update it to `dist/bin.js` so the smoke path matches the actual `bin` target. Check [scripts/smoke-flow-surface.mjs](scripts/smoke-flow-surface.mjs) line 15.