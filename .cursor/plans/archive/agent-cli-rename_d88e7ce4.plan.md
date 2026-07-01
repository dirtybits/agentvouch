---
name: agent-cli-rename
overview: Rename the CLI’s user-facing `author` command group to `agent`, keep `author` as a deprecated alias for one release, and add a direct `agent trust <pubkey>` command on top of the existing agent trust API.
todos:
  - id: primary-agent-command
    content: Make `agent` the primary CLI command group and keep `author` as a deprecated alias using shared subcommand wiring.
    status: completed
  - id: agent-trust-command
    content: Add typed API client support plus a new `agent trust <pubkey>` command and formatter.
    status: completed
  - id: agent-cli-docs
    content: Update CLI help text and public docs/examples to prefer `agent` over `author`.
    status: completed
  - id: verify-agent-cli-rename
    content: Run targeted CLI tests/build and `npm run build` in `web/` to verify the rename.
    status: completed
isProject: false
---

# Rename CLI Author Surface To Agent

## Goal
Make the CLI read as agent-first by promoting `agent` to the primary command group, keeping `author` as a deprecated alias for one release, and adding a direct `agent trust <pubkey>` command.

## Findings
- The current CLI defines an `author` command group in [packages/agentvouch-cli/src/cli.ts](/Users/andysustic/Repos/agent-reputation-oracle/packages/agentvouch-cli/src/cli.ts):

```409:453:packages/agentvouch-cli/src/cli.ts
const author = program
  .command("author")
  .description("Manage author profile actions.");
...
"\nExamples:\n  agentvouch author list\n  agentvouch author list --trusted\n  agentvouch author list --json"
...
"\nExamples:\n  agentvouch author register --keypair ~/.config/solana/id.json --metadata-uri https://example.com/agent.json"
```

- There is already a direct trust API under [web/app/api/agents/[pubkey]/trust/route.ts](/Users/andysustic/Repos/agent-reputation-oracle/web/app/api/agents/[pubkey]/trust/route.ts), so `agent trust <pubkey>` does not require a backend protocol change.
- The CLI API client currently supports `listAuthors()` but does not yet expose a direct `getAgentTrust(pubkey)` helper in [packages/agentvouch-cli/src/lib/http.ts](/Users/andysustic/Repos/agent-reputation-oracle/packages/agentvouch-cli/src/lib/http.ts).
- Formatting is currently centered on `AuthorRecord` list output in [packages/agentvouch-cli/src/lib/format.ts](/Users/andysustic/Repos/agent-reputation-oracle/packages/agentvouch-cli/src/lib/format.ts); there is no formatter yet for the `/api/agents/{pubkey}/trust` envelope.
- Public docs still show `agentvouch author register`, notably in [web/app/docs/page.tsx](/Users/andysustic/Repos/agent-reputation-oracle/web/app/docs/page.tsx) and [web/public/skill.md](/Users/andysustic/Repos/agent-reputation-oracle/web/public/skill.md).

## Plan
- Refactor [packages/agentvouch-cli/src/cli.ts](/Users/andysustic/Repos/agent-reputation-oracle/packages/agentvouch-cli/src/cli.ts) so `agent` becomes the primary top-level command group.
- Register `list` and `register` under `agent`, then expose `author` as a deprecated alias for one release instead of maintaining two separate implementations. The simplest safe shape is to define shared subcommand builders and attach them to both groups.
- Add a new `agent trust <pubkey>` subcommand in [packages/agentvouch-cli/src/cli.ts](/Users/andysustic/Repos/agent-reputation-oracle/packages/agentvouch-cli/src/cli.ts) that calls the existing `/api/agents/{pubkey}/trust` endpoint and prints a compact trust summary plus raw economic context where useful.
- Extend [packages/agentvouch-cli/src/lib/http.ts](/Users/andysustic/Repos/agent-reputation-oracle/packages/agentvouch-cli/src/lib/http.ts) with typed response models for the agent trust envelope and a `getAgentTrust(pubkey)` client method.
- Extend [packages/agentvouch-cli/src/lib/format.ts](/Users/andysustic/Repos/agent-reputation-oracle/packages/agentvouch-cli/src/lib/format.ts) with an `formatAgentTrust(...)` formatter so `agent trust` has stable human-readable output.
- Update docs/help text to make `agent` the primary vocabulary:
  - [packages/agentvouch-cli/src/cli.ts](/Users/andysustic/Repos/agent-reputation-oracle/packages/agentvouch-cli/src/cli.ts) examples/help text
  - [web/app/docs/page.tsx](/Users/andysustic/Repos/agent-reputation-oracle/web/app/docs/page.tsx)
  - [web/public/skill.md](/Users/andysustic/Repos/agent-reputation-oracle/web/public/skill.md)
- Leave API routes, web routes, and data field names unchanged for this pass. In particular, keep `/api/index/authors`, `/author/[pubkey]`, `author_pubkey`, and `author_trust*` as-is to keep the change CLI-scoped.
- Add targeted tests where they carry their weight:
  - [packages/agentvouch-cli/test/http.test.ts](/Users/andysustic/Repos/agent-reputation-oracle/packages/agentvouch-cli/test/http.test.ts) for the new trust client method
  - [packages/agentvouch-cli/test/format.test.ts](/Users/andysustic/Repos/agent-reputation-oracle/packages/agentvouch-cli/test/format.test.ts) for the new trust formatter
- Verify with the CLI package build/tests and a web build because docs/help text in the app will change.

## Scope Notes
- This plan intentionally does **not** rename flags like `--author`, API query params like `?author=`, response fields like `author_reputation`, or product routes like `/author/[pubkey]`. Those are a larger terminology migration and can happen later.
- The alias window should be short and explicit: `agent` is the preferred surface immediately; `author` exists only to avoid a sharp break while the docs and examples settle.

## Verification
- Run the CLI package tests, especially [packages/agentvouch-cli/test/http.test.ts](/Users/andysustic/Repos/agent-reputation-oracle/packages/agentvouch-cli/test/http.test.ts) and [packages/agentvouch-cli/test/format.test.ts](/Users/andysustic/Repos/agent-reputation-oracle/packages/agentvouch-cli/test/format.test.ts).
- Run the CLI build in `packages/agentvouch-cli`.
- Run `npm run build` in `web/` after updating the docs surfaces.