---
name: Milestone 2 - Fresh Program Identity And AgentVouch Rename
overview: Create the fresh v0.2.0 program identity and move future-facing program naming from reputation_oracle to agentvouch.
todos:
  - id: create-m2-plan
    content: Create the Milestone 2 working plan file
    status: completed
  - id: generate-v02-keypair
    content: Generate fresh v0.2.0 AgentVouch program keypair and record pubkey
    status: completed
  - id: rename-anchor-identity
    content: Rename Anchor program identity from reputation_oracle to agentvouch
    status: completed
  - id: update-program-references
    content: Update scripts, docs, tests, web hooks, and package references for the new program identity
    status: completed
  - id: regenerate-or-document-client
    content: Run anchor build and regenerate/sync IDL client artifacts or document blocker
    status: completed
  - id: verify-m2
    content: Run identity/build/search verification and summarize remaining rename blockers
    status: completed
isProject: false
---

# Milestone 2 - Fresh Program Identity And AgentVouch Rename

## Goal

Create a fresh `v0.2.0` program identity and make future-facing program naming `agentvouch`.

## Scope

- Generate a fresh `v0.2.0` deploy keypair.
- Rename Anchor program identity from `reputation_oracle` to `agentvouch`.
- Prefer `agentvouch` for IDL, generated client, and future-facing docs.
- Keep legacy references only where they explicitly describe `v0.1.0` scaffolding.
- Keep external GitHub/Vercel/project renames out of this milestone.

## Decisions

- Program name: `agentvouch`.
- Anchor crate/lib/module name: `agentvouch`.
- Keypair path: `target/deploy/agentvouch-keypair.json` for Anchor compatibility.
- Archived/copy reference path: `target/deploy/agentvouch_v02-keypair.json` if a durable versioned copy is needed outside Anchor.
- Generated web IDL: `web/agentvouch.json`.
- Generated web client: `web/generated/agentvouch`.

## Verification

```bash
solana-keygen pubkey target/deploy/agentvouch-keypair.json
rg "reputation_oracle|reputation-oracle|REPUTATION_ORACLE|reputationOracle|reputation_oracle.json" Anchor.toml programs web packages docs .cursor/plans
NO_DNA=1 anchor build
npm --workspace web run build
```

## Completion Notes

- Generated `target/deploy/agentvouch-keypair.json`.
- Mirrored a versioned local copy at `target/deploy/agentvouch_v02-keypair.json`.
- New `v0.2.0` program pubkey: `CVpe18yvJ4nJxHivqu8G85TSKn8YVZcWaVE3z8afrQnW`.
- `NO_DNA=1 anchor build` passed and produced `target/idl/agentvouch.json` plus `target/types/agentvouch.ts`.
- `env -u CARGO_TARGET_DIR cargo build-sbf --manifest-path programs/agentvouch/Cargo.toml` produced `target/deploy/agentvouch.so`.
- Synced `target/idl/agentvouch.json` to `web/agentvouch.json`.
- Regenerated Codama client at `web/generated/agentvouch`.
- Build warnings remain from existing ambiguous glob re-exports in `programs/agentvouch/src/instructions/mod.rs`.
- `solana-keygen pubkey target/deploy/agentvouch-keypair.json` returned the expected pubkey.
- Stale-reference search found no old program identity references in active code paths; remaining old names are legacy `v0.1.0` notes or search-pattern text.
- `npm run build` completed successfully, including the Next.js build and CLI workspace build. The build logged a non-fatal devnet RPC warmup DNS warning during static generation.
